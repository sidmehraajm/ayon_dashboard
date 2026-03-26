import os
import sys
from ayon_api.server_api import ServerAPI
from dotenv import load_dotenv

load_dotenv()

token = os.getenv("AYON_API_TOKEN")
url = os.getenv("AYON_SERVER_URL", "http://ayon:5000/")
print(f"Connecting to: {url}")

api = ServerAPI(base_url=url, token=token)

try:
    print("Fetching users...")
    users = api.get_users()
    # If it's a generator, convert to list
    users_list = list(users)
    print(f"Total users found: {len(users_list)}")
    if users_list:
        sample = users_list[0]
        print("Sample user structure:", sample)
        print("Sample 'name':", sample.get("name"))
        print("Sample 'active':", sample.get("active"))
except Exception as e:
    print(f"Error during probe: {e}")
    import traceback
    traceback.print_exc()
