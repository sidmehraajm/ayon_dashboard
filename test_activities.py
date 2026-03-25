import os
from dotenv import load_dotenv
from ayon_api.server_api import ServerAPI

load_dotenv()
api = ServerAPI(os.getenv('AYON_SERVER_URL'), os.getenv('AYON_API_TOKEN'))

events = list(api.get_events(project_names=["FX_Library"]))[:20]
for e in events:
    print(f"[{e.get('topic')}] {e.get('createdAt')} - {e.get('user')}: {e.get('description')} {e.get('summary')}")
