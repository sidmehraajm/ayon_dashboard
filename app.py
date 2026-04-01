import re
import mimetypes
from pathlib import Path
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from typing import List, Optional
from ayon_extractor import AyonDataExtractor

app = FastAPI(title="Ayon Production Dashboard")
app.mount("/static", StaticFiles(directory="static"), name="static")

extractor = AyonDataExtractor()

# --- Pydantic Models ---

# Model to accept lists of projects from the frontend
class ProjectListPayload(BaseModel):
    projects: List[str]

# Models for the Bulk Update functionality
class TaskUpdate(BaseModel):
    task_id: str
    status: Optional[str] = None
    end_date: Optional[str] = None

class BulkUpdatePayload(BaseModel):
    project_name: str
    updates: List[TaskUpdate]

# --- API Routes ---

@app.get("/")
def serve_dashboard():
    """Serves the main frontend UI."""
    return FileResponse("static/index.html")

@app.get("/api/projects")
def get_projects():
    """Returns a list of all active projects."""
    return extractor.get_active_projects()

@app.get("/api/metrics/tracking/{project_name}")
def get_tracking(project_name: str):
    """Returns the relational Folder -> Task data for a single project."""
    return extractor.get_shot_and_asset_tracking(project_name)

@app.post("/api/metrics/artists")
def get_artist_metrics(payload: ProjectListPayload):
    """Accepts multiple projects to aggregate artist data."""
    return extractor.get_artist_metrics(payload.projects)

@app.post("/api/metrics/daily")
def get_daily_report(payload: ProjectListPayload):
    """Endpoint for the Daily Report Module."""
    return extractor.get_daily_report(payload.projects)

@app.post("/api/metrics/bulk_update")
def bulk_update(payload: BulkUpdatePayload):
    """Endpoint to handle bulk task modifications in a single transaction."""
    # We use model_dump() here to convert the Pydantic objects to standard dictionaries for the extractor
    return extractor.bulk_update_tasks(payload.project_name, [u.model_dump() for u in payload.updates])

@app.get("/api/metrics/lifecycle/{project_name}/{folder_id}")
def get_lifecycle(project_name: str, folder_id: str):
    """Returns chronologically ordered publish history for an asset."""
    return extractor.get_asset_lifecycle(project_name, folder_id)

class TaskPropertiesPayload(BaseModel):
    project_name: str
    task_id: str
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    status: Optional[str] = None
    assignees: Optional[List[str]] = None

@app.post("/api/metrics/planner/update")
def planner_update_properties(payload: TaskPropertiesPayload):
    """Endpoint called when user drags/resizes a Gantt bar or uses the properties modal."""
    return extractor.update_task_properties(
        payload.project_name, 
        payload.task_id,
        start_date=payload.start_date,
        end_date=payload.end_date,
        status=payload.status,
        assignees=payload.assignees
    )

@app.get("/api/projects/{project_name}/users")
def get_project_users(project_name: str):
    """Returns a list of all artists/users for the project."""
    return extractor.get_project_users(project_name)


# ── Bug 3 fix: dedicated, un-cached statuses endpoint ────────────────────────
@app.get("/api/projects/{project_name}/statuses")
def get_project_statuses(project_name: str):
    """
    Returns ALL statuses from the project anatomy schema.
    Not cached — always reflects the live studio configuration so that the
    bulk-edit dropdown is never limited to only the statuses currently in use.
    """
    return extractor.get_project_statuses(project_name)


# ── Reviewer: resolve latest-version media path ──────────────────────────────
@app.get("/api/review/media/{project_name}/{task_id}")
def get_review_media(project_name: str, task_id: str):
    """Returns the file path + version metadata for the task's latest .mp4 publish."""
    return extractor.get_task_latest_version_media(project_name, task_id)


# ── Reviewer: HTTP 206 Range proxy for network-drive video files ─────────────
@app.get("/api/review/stream")
async def stream_video(path: str, request: Request):
    """
    Streams a video file from a local/network path using HTTP 206 partial content,
    which is required for the HTML5 <video> element to support scrubbing.
    """
    file_path = Path(path)
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail=f"Media file not found: {path}")

    file_size = file_path.stat().st_size
    content_type = mimetypes.guess_type(str(file_path))[0] or "video/mp4"
    range_header = request.headers.get("Range")

    if not range_header:
        # No Range header — serve the whole file (initial metadata probe)
        return FileResponse(str(file_path), media_type=content_type)

    m = re.match(r"bytes=(\d+)-(\d*)", range_header)
    if not m:
        raise HTTPException(status_code=416, detail="Malformed Range header")

    start = int(m.group(1))
    end = int(m.group(2)) if m.group(2) else file_size - 1
    end = min(end, file_size - 1)

    if start > end or start >= file_size:
        raise HTTPException(status_code=416, detail="Range not satisfiable")

    chunk_size = 256 * 1024  # 256 KB

    def _iter_file():
        with open(file_path, "rb") as fh:
            fh.seek(start)
            remaining = end - start + 1
            while remaining > 0:
                data = fh.read(min(chunk_size, remaining))
                if not data:
                    break
                remaining -= len(data)
                yield data

    return StreamingResponse(
        _iter_file(),
        status_code=206,
        media_type=content_type,
        headers={
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(end - start + 1),
        },
    )


# ── Reviewer: receive annotation frame + note, post to Ayon activity feed ────
@app.post("/api/review/annotate")
async def post_annotation(
    project_name: str = Form(...),
    task_id: str = Form(...),
    note: str = Form(""),
    frame_time: str = Form("0:00"),
    image: UploadFile = File(...),
):
    """
    Accepts a multipart POST containing:
      - project_name / task_id  — target entity
      - note                    — free-text correction note
      - frame_time              — timecode captured at freeze (Bug 2 fix ensures accuracy)
      - image                   — composite PNG (video frame + canvas drawings)

    Uploads the PNG to Ayon to obtain a file_id, then posts a comment activity
    with the image embedded via Markdown so it renders in the Ayon web feed.
    """
    image_bytes = await image.read()
    result = extractor.post_review_annotation(
        project_name, task_id, image_bytes, note, frame_time
    )
    if result.get("status") == "error":
        raise HTTPException(status_code=500, detail=result.get("detail", "Annotation post failed"))
    return result