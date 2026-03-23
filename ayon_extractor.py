import os
from collections import defaultdict
from ayon_api.server_api import ServerAPI

class AYON_UTILS:
    _conn = None

    @classmethod
    def conn(cls):
        if cls._conn is None:
            token = "bd9250c1b5174617835771d77ebbce44"  
            cls._conn = ServerAPI(base_url="http://ayon:5000/", token=token)
            print("AYON connection created")
        return cls._conn

class AyonDataExtractor:
    def __init__(self):
        self.api = AYON_UTILS.conn()
        
    def get_active_projects(self) -> list:
        return self.api.get_project_names(active=True)

    def get_artist_metrics(self, project_names: list) -> dict:
        artist_data = defaultdict(lambda: {"total_publishes": 0, "projects": set(), "publishes": []})
        
        for proj in project_names:
            versions_gen = self.api.get_versions(
                project_name=proj,
                fields=["id", "version", "author", "createdAt", "taskId", "status"]
            )
            for v in versions_gen:
                author = v.get("author")
                if not author:
                    continue
                    
                artist_data[author]["total_publishes"] += 1
                artist_data[author]["projects"].add(proj)
                # Store specific publish data for the UI Modal
                artist_data[author]["publishes"].append({
                    "version": f"v{v.get('version', 1):03d}",
                    "date": v.get("createdAt"),
                    "status": v.get("status", "N/A"),
                    "project": proj
                })
                
        for data in artist_data.values():
            data["projects"] = list(data["projects"])
            # Sort publishes newest first
            data["publishes"].sort(key=lambda x: x["date"] or "", reverse=True)
            
        return dict(artist_data)

    def get_shot_and_asset_tracking(self, project_name: str) -> dict:
        folders_gen = self.api.get_folders(
            project_name=project_name,
            fields=["id", "name", "folderType", "path"] 
        )
        
        # Added 'attrib' for endDate and 'updatedAt' for publish timing
        tasks_gen = self.api.get_tasks(
            project_name=project_name,
            fields=["id", "name", "taskType", "status", "folderId", "assignees", "attrib", "updatedAt"] 
        )
        
        dashboard_payload = {
            f["id"]: {
                "asset_id": f["id"],
                "name": f["name"], 
                "path": f["path"], 
                "type": f["folderType"], 
                "tasks": []
            } for f in folders_gen
        }
        
        for task in tasks_gen:
            folder_id = task.get("folderId")
            if folder_id in dashboard_payload:
                attrib = task.get("attrib", {})
                dashboard_payload[folder_id]["tasks"].append({
                    "task_id": task["id"],
                    "task_name": task["name"],
                    "task_type": task["taskType"],
                    "status": task["status"],
                    "assignees": task.get("assignees", []),
                    "end_date": attrib.get("endDate"), # Targeted delivery date
                    "updated_at": task.get("updatedAt") # Proxy for actual completion date
                })
                
        return dashboard_payload