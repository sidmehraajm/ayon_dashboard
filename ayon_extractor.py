import os
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv
from cachetools import cached, TTLCache
from typing import List, Optional, Dict, Any
from ayon_api.server_api import ServerAPI
import logging

logger = logging.getLogger("ayon_extractor")

load_dotenv()

# Pre-initialize caching schemas with 5-minute TTL
project_cache = TTLCache(maxsize=10, ttl=300)
tracking_cache = TTLCache(maxsize=50, ttl=300)

class AYON_UTILS:
    _conn = None

    @classmethod
    def conn(cls):
        if cls._conn is None:
            token = os.getenv("AYON_API_TOKEN")
            url = os.getenv("AYON_SERVER_URL", "http://ayon:5000/")
            if not token:
                print("WARNING: AYON_API_TOKEN is missing!")
            cls._conn = ServerAPI(base_url=url, token=token)
            print("AYON connection created")
        return cls._conn

class AyonDataExtractor:
    def __init__(self):
        self.api = AYON_UTILS.conn()
        
    @cached(cache=project_cache)
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
        
        def _process_project(proj):
            local_statuses = set()
            local_publishes = []
            
            project_info = self.api.get_project(proj)
            if project_info and "statuses" in project_info:
                for s in project_info["statuses"]:
                    if "name" in s:
                        local_statuses.add(s["name"])

            task_lookup = self._get_task_lookup(proj)
            versions_gen = self.api.get_versions(proj, fields=["id", "version", "author", "createdAt", "taskId", "status"])
            
            for v in versions_gen:
                author = v.get("author")
                if not author: continue
                
                if v.get("status"):
                    local_statuses.add(v["status"])
                    
                task_info = task_lookup.get(v.get("taskId"), {"task_name": "Unknown", "asset_path": "Unknown", "folder_id": None})
                
                local_publishes.append({
                    "author": author,
                    "version": f"v{v.get('version', 1):03d}",
                    "date": v.get("createdAt"),
                    "status": v.get("status", "N/A"),
                    "project": proj,
                    "asset_path": task_info["asset_path"],
                    "task": task_info["task_name"],
                    "folder_id": task_info["folder_id"],
                    "task_id": v.get("taskId")
                })
            return local_statuses, local_publishes

        with ThreadPoolExecutor(max_workers=10) as executor:
            futures = [executor.submit(_process_project, p) for p in project_names]
            for future in as_completed(futures):
                try:
                    statuses, publishes = future.result()
                    project_statuses.update(statuses)
                    for pub in publishes:
                        author = pub["author"]
                        artist_data[author]["total_publishes"] += 1
                        artist_data[author]["projects"].add(pub["project"])
                        artist_data[author]["publishes"].append({
                            "version": pub["version"], "date": pub["date"],
                            "status": pub["status"], "project": pub["project"],
                            "asset_path": pub["asset_path"], "task": pub["task"],
                            "folder_id": pub["folder_id"], "task_id": pub["task_id"]
                        })
                except Exception as e:
                    print(f"Error processing project: {e}")
                    
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
        
        def _process_daily(proj):
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
            return proj, daily_publishes

        with ThreadPoolExecutor(max_workers=10) as executor:
            futures = [executor.submit(_process_daily, p) for p in project_names]
            for future in as_completed(futures):
                try:
                    proj, daily_publishes = future.result()
                    if daily_publishes:
                        report[proj] = {
                            "total_publishes": len(daily_publishes),
                            "publishes": sorted(daily_publishes, key=lambda x: x["date"], reverse=True)
                        }
                except Exception as e:
                    print(f"Error processing daily report: {e}")
                
        return report

    @cached(cache=tracking_cache)
    def get_shot_and_asset_tracking(self, project_name: str) -> dict:
            """
            Extracts Folders and Tasks, keeping them relational.
            Excludes empty container folders and fetches the official project statuses.
            """
            # 1. Fetch the official Project schema from Ayon to get ALL statuses
            project_info = self.api.get_project(project_name)
            project_statuses = set()
            if project_info and "statuses" in project_info:
                for s in project_info["statuses"]:
                    if "name" in s:
                        project_statuses.add(s["name"])

            # 2. Fetch folders, but ONLY folders that actually contain tasks (Filters out structural folders)
            folders_gen = self.api.get_folders(
                project_name=project_name, 
                fields=["id", "name", "folderType", "path"],
                has_tasks=True 
            )
            
            tasks_gen = self.api.get_tasks(
                project_name=project_name, 
                fields=["id", "name", "taskType", "status", "folderId", "assignees", "attrib", "updatedAt"]
            )
            
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
                        "start_date": attrib.get("startDate"), "end_date": attrib.get("endDate"),
                        "updated_at": task.get("updatedAt"), "folder_id": folder_id
                    })
                    
            # Return both the nested data AND the official project statuses
            return {
                "tracking_data": dashboard_payload,
                "all_statuses": sorted(list(project_statuses))
            }

    def get_asset_lifecycle(self, project_name: str, folder_id: str) -> dict:
        """
        Fetches the chronological publish trail for a specific folder/asset.
        Maps tasks to their respective versions, authors, and timestamps.
        Synthesizes assignment and creation events into the stream.
        """
        try:
            timeline = []
            
            # 1. Get tasks belonging ONLY to this folder_id
            tasks_gen = self.api.get_tasks(
                project_name, folder_ids=[folder_id], 
                fields=["id", "name", "taskType", "assignees", "createdAt", "updatedAt", "status"]
            )
            tasks = {}
            earliest_task_date = None
            
            for t in tasks_gen:
                tasks[t["id"]] = t
                assignees = t.get("assignees", [])
                created = t.get("createdAt")
                updated = t.get("updatedAt")
                
                if created:
                    if not earliest_task_date or created < earliest_task_date:
                        earliest_task_date = created
                        
                    assign_str = ", ".join(assignees) if assignees else "Unassigned"
                    timeline.append({
                        "event_type": "assignment",
                        "date": created,
                        "task": t["name"],
                        "department": t.get("taskType", "Task"),
                        "author": assign_str,
                        "status": "Initialized"
                    })
                
                if updated and t.get("status"):
                    timeline.append({
                        "event_type": "status_change",
                        "date": updated,
                        "task": t["name"],
                        "department": t.get("taskType", "Task"),
                        "author": assign_str if created else "System",
                        "status": t.get("status")
                    })
            
            # 2. Folder Creation Event fallback
            folder = self.api.get_folder_by_id(project_name, folder_id)
            if folder:
                # Use Ayon's createdAt if available (rare on purely GraphQL endpoints), fallback to earliest task date
                folder_created = folder.get("createdAt", earliest_task_date)
                if folder_created:
                    timeline.append({
                        "event_type": "creation",
                        "date": folder_created,
                        "task": folder.get("name", "Asset"),
                        "department": "System",
                        "author": "Pipeline",
                        "status": "Created"
                    })
            
            if not tasks and not timeline:
                return {"lifecycle": []}
                
            task_ids = list(tasks.keys())
            
            # 3. Get versions for these tasks
            if task_ids:
                versions_gen = self.api.get_versions(project_name, task_ids=task_ids, fields=["id", "version", "author", "createdAt", "taskId", "status", "attrib"])
                for v in versions_gen:
                    t_info = tasks.get(v.get("taskId"), {"name": "Unknown", "taskType": "Unknown"})
                    comment = v.get("attrib", {}).get("comment", "")
                    timeline.append({
                        "event_type": "publish",
                        "date": v.get("createdAt"),
                        "task": t_info["name"],
                        "department": t_info.get("taskType", "Unknown"),
                        "version": f"v{v.get('version', 1):03d}",
                        "author": v.get("author", "Unknown"),
                        "status": v.get("status", "Published"),
                        "task_id": v.get("taskId"),
                        "comment": comment,
                        "folder_id": folder_id
                    })
                
            timeline.sort(key=lambda x: x["date"] or "")
            logger.info(f"Lifecycle for {folder_id} mapped successfully. Found {len(timeline)} chronological nodes.")
            return {"lifecycle": timeline}
        except Exception as e:
            logger.error(f"Error fetching lifecycle for {folder_id}: {e}", exc_info=True)
            return {"lifecycle": []}

    def bulk_update_tasks(self, project_name: str, task_updates: list) -> dict:
        """
        Executes a single batch transaction to update multiple tasks.
        Expected task_updates format: [{"task_id": "...", "status": "...", "end_date": "..."}]
        """
        operations = []
        for update in task_updates:
            task_id = update.get("task_id")
            if not task_id:
                continue

            changes = {}
            if update.get("status"):
                changes["status"] = update["status"]

            attrib_changes = {}
            if update.get("end_date"):
                attrib_changes["endDate"] = f"{update['end_date']}T00:00:00Z" # Ayon expects ISO format

            if attrib_changes:
                changes["attrib"] = attrib_changes

            if changes:
                operations.append({
                    "type": "update",
                    "entityType": "task",
                    "entityId": task_id,
                    "data": changes
                })

        if operations:
            # Execute all updates in a single server transaction
            self.api.send_batch_operations(project_name, operations)
            
        tracking_cache.clear()
        return {"status": "ok", "updated": len(operations)}

    def update_task_properties(self, project_name: str, task_id: str, 
                               start_date: Optional[str] = None, 
                               end_date: Optional[str] = None,
                               status: Optional[str] = None,
                               assignees: Optional[list] = None) -> dict:
        """
        Updates task attributes (dates, status, assignees) via Ayon batch ops.
        """
        try:
            changes: Dict[str, Any] = {}
            if status:
                changes["status"] = status
            if assignees is not None:
                changes["assignees"] = assignees

            attrib_changes = {}
            if start_date:
                attrib_changes["startDate"] = f"{start_date}T00:00:00Z"
            if end_date:
                attrib_changes["endDate"] = f"{end_date}T00:00:00Z"
            
            if attrib_changes:
                changes["attrib"] = attrib_changes

            if not changes:
                return {"status": "no_change"}

            operations = [{
                "type": "update",
                "entityType": "task",
                "entityId": task_id,
                "data": changes
            }]
            self.api.send_batch_operations(project_name, operations)
            tracking_cache.clear()
            return {"status": "ok"}
        except Exception as e:
            logger.error(f"Failed to update task {task_id}: {e}", exc_info=True)
            return {"status": "error", "detail": str(e)}

    def get_project_users(self, project_name: str) -> list:
        """Returns a list of all user names associated with the project."""
        try:
            # ayon_api.get_users() often returns a generator.
            users = list(self.api.get_users())
            return sorted([u["name"] for u in users if u.get("active", True) and "name" in u])
        except Exception as e:
            logger.error(f"Error fetching users for {project_name}: {e}")
            return []

    def get_project_statuses(self, project_name: str) -> list:
        """
        Returns ALL statuses defined in the project anatomy schema.
        This is intentionally NOT cached so it always reflects the live schema,
        fixing the bug where the bulk-edit dropdown only showed statuses present
        on currently-existing tasks rather than the full studio-configured list.
        """
        try:
            project_info = self.api.get_project(project_name)
            if project_info and "statuses" in project_info:
                return [
                    {
                        "name": s["name"],
                        "color": s.get("color", "#aaaaaa"),
                        "shortName": s.get("shortName", ""),
                        "icon": s.get("icon", ""),
                        "state": s.get("state", ""),
                    }
                    for s in project_info["statuses"]
                    if "name" in s
                ]
            return []
        except Exception as e:
            logger.error(f"Error fetching statuses for {project_name}: {e}", exc_info=True)
            return []

    def get_task_latest_version_media(self, project_name: str, task_id: str) -> dict:
        """
        Returns the resolved file path of the most recent published review media (.mp4)
        for the given task, plus version metadata for display in the Reviewer tab.
        """
        try:
            versions = sorted(
                list(self.api.get_versions(
                    project_name,
                    task_ids=[task_id],
                    fields=["id", "version", "taskId", "author", "createdAt"]
                )),
                key=lambda v: v.get("version", 0),
                reverse=True
            )
            if not versions:
                return {"path": None, "version": None}

            latest = versions[0]
            version_id = latest["id"]

            repres = list(self.api.get_representations(
                project_name,
                version_ids=[version_id],
                fields=["id", "name", "files", "attrib"]
            ))

            # Prefer named review/h264 representations first, then fall back to any .mp4
            preferred = {"review", "h264", "mp4", "preview", "burnin"}
            for priority in (True, False):
                for repre in repres:
                    is_preferred = repre.get("name", "").lower() in preferred
                    if priority != is_preferred:
                        continue
                    for f in repre.get("files", []):
                        path = f.get("path", "")
                        if path.lower().endswith(".mp4"):
                            return {
                                "path": path,
                                "version": latest.get("version"),
                                "version_id": version_id,
                                "author": latest.get("author"),
                            }

            return {"path": None, "version": latest.get("version"), "version_id": version_id}
        except Exception as e:
            logger.error(f"Error fetching media for task {task_id}: {e}", exc_info=True)
            return {"path": None, "error": str(e)}

    def post_review_annotation(
        self,
        project_name: str,
        task_id: str,
        image_bytes: bytes,
        note: str,
        frame_time: str,
    ) -> dict:
        """
        Two-phase Ayon activity post:
          1. Upload the composite PNG to /api/projects/{project}/files → receive file_id.
          2. POST a 'comment' activity that embeds the image via Markdown and attaches
             the file_id so it renders inline in the Ayon web feed.

        Uses direct HTTP calls (via requests) because ayon-python-api does not expose
        a multipart file-upload helper or the activities REST surface.
        """
        import io
        import requests as _requests

        base_url = os.getenv("AYON_SERVER_URL", "http://ayon:5000/").rstrip("/")
        token = os.getenv("AYON_API_TOKEN", "")
        auth_headers = {"Authorization": f"Bearer {token}"}

        # ── Step 1: Upload the annotation PNG ────────────────────────────────
        file_id: Optional[str] = None
        try:
            upload_resp = _requests.post(
                f"{base_url}/api/projects/{project_name}/files",
                headers=auth_headers,
                files={"file": ("annotation.png", io.BytesIO(image_bytes), "image/png")},
                timeout=30,
            )
            upload_resp.raise_for_status()
            file_id = upload_resp.json().get("id")
            logger.info(f"Annotation image uploaded → file_id={file_id}")
        except Exception as e:
            # Non-fatal: we still post the text note even if upload fails.
            logger.error(f"Annotation file upload failed: {e}", exc_info=True)

        # ── Step 2: Build the Markdown comment body ──────────────────────────
        # Timecode line uses the frame_time passed from the frontend (stored at
        # freeze-click time — see Bug 2 fix in main.js reviewerFreezeFrame).
        timecode_md = f"\n\n**Frame Time:** `{frame_time}`" if frame_time else ""
        img_md = ""
        if file_id:
            img_md = f"\n\n![Annotation](/api/projects/{project_name}/files/{file_id})"

        body = f"{(note or '').strip()}{timecode_md}{img_md}".strip()

        # ── Step 3: Post the activity/comment ────────────────────────────────
        try:
            activity_payload: Dict[str, Any] = {
                "activityType": "comment",
                "body": body,
            }
            if file_id:
                activity_payload["files"] = [file_id]

            act_resp = _requests.post(
                f"{base_url}/api/projects/{project_name}/tasks/{task_id}/activities",
                headers={**auth_headers, "Content-Type": "application/json"},
                json=activity_payload,
                timeout=30,
            )
            act_resp.raise_for_status()
            return {"status": "ok", "activity_id": act_resp.json().get("id"), "file_id": file_id}
        except Exception as e:
            logger.error(f"Activity post failed: {e}", exc_info=True)
            return {"status": "error", "detail": str(e)}