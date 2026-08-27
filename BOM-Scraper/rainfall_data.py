import requests
import re
import io
import zipfile
import time
import os
import pandas as pd

headers = {"User-Agent": "Mozilla/5.0"}

def get_rainfall(station):

    session = requests.Session()
    html_url = "https://www.bom.gov.au/jsp/ncc/cdio/weatherData/av?p_nccObsCode=136&p_display_type=dailyDataFile&p_startYear=&p_c=&p_stn_num=" + str(station)

    r = session.get(html_url, headers=headers)
    match = re.search(r'href="([^"]*p_display_type=dailyZippedDataFile[^"]*)"', r.text)

    if not match:
        return None

    zip_url = "https://www.bom.gov.au" + match.group(1).replace("&amp;", "&")

    r2 = session.get(zip_url, headers=headers)
    z = zipfile.ZipFile(io.BytesIO(r2.content))

    csv_name = [n for n in z.namelist() if n.endswith(".csv")][0]
    df = pd.read_csv(z.open(csv_name))

    return df

RAIN_DIR = "BOM-Scraper/data/rainfall"

# station_sorter.py moves finished downloads into selected/ and others/, so a
# resumed run has to look in all three places. Checking only the flat directory
# meant every re-run after a sort re-downloaded the entire candidate list.
SEARCH_DIRS = (RAIN_DIR,
               os.path.join(RAIN_DIR, "selected"),
               os.path.join(RAIN_DIR, "others"))


def find_existing(station):
    """Path of an already-downloaded CSV for this station, or None."""
    for directory in SEARCH_DIRS:
        path = os.path.join(directory, f"{station}.csv")
        if os.path.exists(path):
            return path
    return None


os.makedirs(RAIN_DIR, exist_ok=True)

no_data = []
got_data = []
days_recorded = {}
df = pd.read_csv('BOM-Scraper/data/candidate_stations.csv', dtype={"STN": str})

for station in df['STN']:

    station = str(station)
    out_path = os.path.join(RAIN_DIR, f"{station}.csv")

    if find_existing(station):
        got_data.append(station)
        continue

    data = get_rainfall(station)

    if data is None:
        print(station, "no rainfall data, skipping")
        no_data.append(station)
    else:
        rain_col = next(c for c in data.columns if "Rainfall amount" in c)
        days_recorded[station] = data[rain_col].notna().sum()

        data.to_csv(out_path, index=False)
        got_data.append(station)

    time.sleep(0.2)

# backfill days_recorded for stations that were skipped because
# their CSV already existed from a previous run
for station in got_data:
    if station not in days_recorded:
        path = find_existing(station)
        if path is None:          # moved or removed between passes
            continue
        existing = pd.read_csv(path)
        rain_col = next(c for c in existing.columns if "Rainfall amount" in c)
        days_recorded[station] = existing[rain_col].notna().sum()

with open("BOM-Scraper/data/no_rainfall_data.txt", "w") as f:
    for station in no_data:
        f.write(station + "\n")

print(f"{len(no_data)} stations had no rainfall data")

# find bins where none of the candidate stations returned rainfall data
df['has_data'] = df['STN'].isin(got_data)
df['days_recorded'] = df['STN'].map(days_recorded).fillna(0).astype(int)

bin_coverage = df.groupby(['lat_bin', 'lon_bin'])['has_data'].any()
empty_bins = bin_coverage[~bin_coverage].reset_index()[['lat_bin', 'lon_bin']]

empty_bins.to_csv('BOM-Scraper/data/empty_bins.csv', index=False)
print(f"{len(empty_bins)} bins have no station with rainfall data")

# pick the station with the most days recorded per bin
best_stations = (
    df[df['has_data']]
    .sort_values('days_recorded', ascending=False)
    .groupby(['lat_bin', 'lon_bin'])
    .head(1)
)

best_stations.to_csv('BOM-Scraper/data/best_stations.csv', index=False)
print(f"{len(best_stations)} best stations selected")

days_list = best_stations[['STN', 'days_recorded']].sort_values('days_recorded', ascending=False)
days_list.to_csv('BOM-Scraper/data/best_stations_days_recorded.csv', index=False)
print(days_list)