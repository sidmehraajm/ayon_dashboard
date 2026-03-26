import os
import sys
from ayon_api.server_api import ServerAPI
from dotenv import load_dotenv

load_dotenv()

token = os.getenv("AYON_API_TOKEN")
url = os.getenv("AYON_SERVER_URL", "http://ayon:5000/")

api = ServerAPI(base_url=url, token=token)

try:
    project_name = "Kleem_Library"
    tasks = list(api.get_tasks(project_name, fields=["id", "name", "assignees"]))
    for t in tasks:
        if t['name'] == 'ai':
            print(f"Final assignees for '{t['name']}': {t.get('assignees')}")
            break
except Exception as e:
    print(f"Error: {e}")
