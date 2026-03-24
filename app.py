from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List
from ayon_extractor import AyonDataExtractor

app = FastAPI(title="Ayon Production Dashboard")
app.mount("/static", StaticFiles(directory="static"), name="static")

extractor = AyonDataExtractor()

# Pydantic model to accept lists of projects from the frontend
class ProjectListPayload(BaseModel):
    projects: List[str]

@app.get("/")
def serve_dashboard():
    return FileResponse("static/index.html")

@app.get("/api/projects")
def get_projects():
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