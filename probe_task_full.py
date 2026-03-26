import os
import sys
from ayon_api.server_api import ServerAPI
from dotenv import load_dotenv

load_dotenv()

token = os.getenv("AYON_API_TOKEN")
url = os.getenv("AYON_SERVER_URL", "http://ayon:5000/")

api = ServerAPI(base_url=url, token=token)

try:
    project_names = list(api.get_project_names())
    for project_name in project_names:
        tasks = list(api.get_tasks(project_name, fields=["id", "name", "assignees"]))
        for t in tasks:
            if t.get("assignees"):
                print(f"Project: {project_name}, Task: {t['name']}")
                print(f"Assignees: {t['assignees']}")
                sys.exit(0)
    print("No tasks with assignees found in any project.")
except Exception as e:
    print(f"Error: {e}")
