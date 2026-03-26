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
    # From previous probe: Task 'ai' in Kleem_Library
    tasks = list(api.get_tasks(project_name, fields=["id", "name", "assignees"]))
    target_task = None
    for t in tasks:
        if t['name'] == 'ai':
            target_task = t
            break
            
    if not target_task:
        print("Target task 'ai' not found.")
        sys.exit(0)
        
    task_id = target_task['id']
    print(f"Original assignees for '{target_task['name']}': {target_task.get('assignees')}")
    
    # Toggle assignment for 'rina1'
    original = target_task.get('assignees', [])
    if 'rina1' in original:
        new_assignees = [a for a in original if a != 'rina1']
    else:
        new_assignees = original + ['rina1']
        
    print(f"Attempting update to: {new_assignees}")
    
    operations = [{
        "type": "update",
        "entityType": "task",
        "entityId": task_id,
        "data": {"assignees": new_assignees}
    }]
    
    api.send_batch_operations(project_name, operations)
    print("Batch operations sent.")
    
    # Verify
    updated_tasks = list(api.get_tasks(project_name, ids=[task_id], fields=["id", "name", "assignees"]))
    if updated_tasks:
        print(f"Verified assignees: {updated_tasks[0].get('assignees')}")
    else:
        print("Could not verify update.")
        
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
