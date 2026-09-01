import pandas as pd
import os
import shutil

rainfall_dir = "BOM-Scraper/data/rainfall"
selected_dir = os.path.join(rainfall_dir, "selected")
others_dir = os.path.join(rainfall_dir, "others")

os.makedirs(selected_dir, exist_ok=True)
os.makedirs(others_dir, exist_ok=True)

best_stations = pd.read_csv('BOM-Scraper/data/best_stations.csv', dtype={"STN": str})
selected_stns = set(best_stations['STN'])

moved_selected = 0
moved_others = 0
skipped = 0

for filename in os.listdir(rainfall_dir):
    src_path = os.path.join(rainfall_dir, filename)

    if not os.path.isfile(src_path) or not filename.endswith(".csv"):
        continue

    station = os.path.splitext(filename)[0]

    if station in selected_stns:
        shutil.move(src_path, os.path.join(selected_dir, filename))
        moved_selected += 1
    else:
        shutil.move(src_path, os.path.join(others_dir, filename))
        moved_others += 1

print(f"{moved_selected} files moved to selected/")
print(f"{moved_others} files moved to others/")