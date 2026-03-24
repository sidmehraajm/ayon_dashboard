import os
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from ayon_api.server_api import ServerAPI

class AYON_UTILS:
    _conn = None

    @classmethod
    def conn(cls):
        if cls._conn is None:
            token = "bd9250c1b5174617835771d77ebbce44"  # Local Server Token
            cls._conn = ServerAPI(base_url="http://ayon:5000/", token=token)
            print("AYON connection created")
        return cls._conn

class AyonDataExtractor:
    def __init__(self):
        self.api = AYON_UTILS.conn()
        
    def get_active_projects(self) -> list:
        return self.api.get_project_names(active=True)

    def _get_task_lookup(self, project_name: str) -> dict:
        """Helper to map task IDs to their full Asset path and Folder ID."""
        folders = {f["id"]: {"name": f["name"], "path": f["path"]} 
                   for f in self.api.get_folders(project_name, fields=["id", "name", "path"])}
        
        tasks = {}
        for t in self.api.get_tasks(project_name, fields=["id", "name", "folderId"]):
            folder_info = folders.get(t.get("folderId"), {"name": "Unknown", "path": "Unknown"})
            tasks[t["id"]] = {
                "task_name": t["name"],
                "asset_path": folder_info["path"],
                "folder_id": t.get("folderId")
            }
        return tasks

    def get_artist_metrics(self, project_names: list) -> dict:
            artist_data = defaultdict(lambda: {"total_publishes": 0, "projects": set(), "publishes": []})
            project_statuses = set() # Store official project statuses
            
            for proj in project_names:
                # 1. Fetch the official Project schema from Ayon to get ALL statuses
                project_info = self.api.get_project(proj)
                if project_info and "statuses" in project_info:
                    for s in project_info["statuses"]:
                        if "name" in s:
                            project_statuses.add(s["name"])

                task_lookup = self._get_task_lookup(proj)
                versions_gen = self.api.get_versions(proj, fields=["id", "version", "author", "createdAt", "taskId", "status"])
                
                for v in versions_gen:
                    author = v.get("author")
                    if not author: continue
                    
                    # Fallback: Just in case a version has a status not in the project schema
                    if v.get("status"):
                        project_statuses.add(v["status"])
                        
                    task_info = task_lookup.get(v.get("taskId"), {"task_name": "Unknown", "asset_path": "Unknown", "folder_id": None})
                    
                    artist_data[author]["total_publishes"] += 1
                    artist_data[author]["projects"].add(proj)
                    artist_data[author]["publishes"].append({
                        "version": f"v{v.get('version', 1):03d}",
                        "date": v.get("createdAt"),
                        "status": v.get("status", "N/A"),
                        "project": proj,
                        "asset_path": task_info["asset_path"],
                        "task": task_info["task_name"],
                        "folder_id": task_info["folder_id"],
                        "task_id": v.get("taskId")
                    })
                    
            for data in artist_data.values():
                data["projects"] = list(data["projects"])
                data["publishes"].sort(key=lambda x: x["date"] or "", reverse=True)
                
            # Return BOTH the artist data and the official project statuses
            return {
                "artists": dict(artist_data),
                "all_statuses": sorted(list(project_statuses))
            }

    def get_daily_report(self, project_names: list) -> dict:
        """Finds all publishes and approvals within the last 24 hours."""
        yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        report = {}
        
        for proj in project_names:
            task_lookup = self._get_task_lookup(proj)
            versions_gen = self.api.get_versions(proj, fields=["id", "version", "author", "createdAt", "taskId", "status"])
            
            daily_publishes = []
            for v in versions_gen:
                created_at = v.get("createdAt")
                if created_at and created_at >= yesterday:
                    task_info = task_lookup.get(v.get("taskId"), {"task_name": "Unknown", "asset_path": "Unknown", "folder_id": None})
                    daily_publishes.append({
                        "author": v.get("author", "Unknown"),
                        "asset_path": task_info["asset_path"],
                        "task": task_info["task_name"],
                        "version": f"v{v.get('version', 1):03d}",
                        "status": v.get("status", "N/A"),
                        "date": created_at,
                        "folder_id": task_info["folder_id"],
                        "task_id": v.get("taskId")
                    })
            
            if daily_publishes:
                report[proj] = {
                    "total_publishes": len(daily_publishes),
                    "publishes": sorted(daily_publishes, key=lambda x: x["date"], reverse=True)
                }
                
        return report

    def get_shot_and_asset_tracking(self, project_name: str) -> dict:
        folders_gen = self.api.get_folders(project_name, fields=["id", "name", "folderType", "path"])
        tasks_gen = self.api.get_tasks(project_name, fields=["id", "name", "taskType", "status", "folderId", "assignees", "attrib", "updatedAt"])
        
        dashboard_payload = {
            f["id"]: {
                "asset_id": f["id"], "name": f["name"], "path": f["path"], "type": f["folderType"], "tasks": []
            } for f in folders_gen
        }
        
        for task in tasks_gen:
            folder_id = task.get("folderId")
            if folder_id in dashboard_payload:
                attrib = task.get("attrib", {})
                dashboard_payload[folder_id]["tasks"].append({
                    "task_id": task["id"], "task_name": task["name"], "task_type": task["taskType"],
                    "status": task["status"], "assignees": task.get("assignees", []),
                    "end_date": attrib.get("endDate"), "updated_at": task.get("updatedAt")
                })
                
        return dashboard_payload