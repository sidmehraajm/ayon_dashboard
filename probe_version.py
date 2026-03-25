import os
import sys
from dotenv import load_dotenv

sys.path.append(r"p:\pipeline_database\Ayon\Scripts")
from ayon_dashboard.ayon_extractor import AyonDataExtractor

load_dotenv()

try:
    extractor = AyonDataExtractor()
    versions_gen = extractor.api.get_versions("SPRINT4", fields=["id", "version", "author", "createdAt", "taskId", "status", "attrib", "data"])
    
    count = 0
    for v in versions_gen:
        print(f"Keys: {list(v.keys())}")
        if "attrib" in v:
            print(f"Attrib: {v['attrib']}")
        if "data" in v:
            print(f"Data: {v['data']}")
        print("-------------")
        count += 1
        if count >= 3:
            break
except Exception as e:
    import traceback
    traceback.print_exc()
