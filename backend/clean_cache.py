"""Safe cache cleanup for this project.

- clears requests-cache if requests_cache is installed
- removes common osmnx cache folders under the user profile
- does NOT remove backend/data/graph.json unless --remove-data is passed
"""
import os
import shutil
import argparse

HOME = os.path.expanduser("~")
COMMON_CACHE_DIRS = [
    os.path.join(HOME, ".cache", "osmnx"),
    os.path.join(HOME, ".osmnx_cache"),
]

parser = argparse.ArgumentParser()
parser.add_argument("--remove-data", action="store_true", help="Also remove backend/data contents")
args = parser.parse_args()

# 1) clear requests-cache programmatically
try:
    import requests_cache
    cache = requests_cache.get_cache()
    print(f"Found requests-cache: {cache}")
    cache.clear()
    print("Cleared requests-cache")
except Exception as e:
    print("requests_cache not available or no cache to clear:", e)

# 2) remove common osmnx cache directories
for d in COMMON_CACHE_DIRS:
    if os.path.exists(d):
        print(f"Removing cache directory: {d}")
        try:
            shutil.rmtree(d)
        except Exception as e:
            print(f"Failed to remove {d}: {e}")
    else:
        print(f"Cache dir not found: {d}")

# 3) optionally remove backend/data
if args.remove_data:
    data_dir = os.path.join(os.getcwd(), "data")
    if os.path.exists(data_dir):
        print(f"Removing backend data directory: {data_dir}")
        try:
            shutil.rmtree(data_dir)
        except Exception as e:
            print(f"Failed to remove {data_dir}: {e}")
    else:
        print("No backend/data directory found to remove")

print("Done.")
