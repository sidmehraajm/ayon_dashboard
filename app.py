from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
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