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
    if not project_names:
        print("No projects found.")
        sys.exit(0)
    
    project_name = project_names[0]
    print(f"Checking project: {project_name}")
    
    tasks = list(api.get_tasks(project_name, fields=["id", "name", "assignees"]))
    if tasks:
        t = tasks[0]
        print(f"Sample task: {t['name']}")
        print(f"Task assignees (raw): {t.get('assignees')}")
        print(f"Type of assignees: {type(t.get('assignees'))}")
    else:
        print("No tasks found in project.")
except Exception as e:
    print(f"Error: {e}")
