import re
import pandas as pd
import os

with open("BOM-Scraper/stations_list.txt", encoding="utf-8") as f:
    lines = f.readlines()

dash_line = lines[3].rstrip("\r\n")
spans = [(m.start(), m.end()) for m in re.finditer(r"-+", dash_line)]
colspecs = [(s, e if i < len(spans) - 1 else None) for i, (s, e) in enumerate(spans)]

names = ['STN', 'Dist', 'Name', 'Start', 'End', 'Lat', 'Lon',
         'Source', 'State', 'Height (m)', 'Bar_ht', 'WMO']

df = pd.read_fwf(
    "BOM-Scraper/stations_list.txt",
    colspecs=colspecs,
    names=names,
    skiprows=4,
    dtype=str,
)

for col in df.columns:
    df[col] = df[col].str.strip()

df = df[df['STN'].str.fullmatch(r'\d+', na=False)].reset_index(drop=True)

df['End'] = df['End'].replace('..', 'Present')
df['Height (m)'] = df['Height (m)'].replace('..', 'N/A')
df['Bar_ht'] = df['Bar_ht'].replace('..', 'N/A')

os.makedirs("BOM-Scraper/data", exist_ok=True)
df.to_csv('BOM-Scraper/data/stations_list.csv', index=False)

df['still_operating'] = df['End'] == "Present"
df = df[df['still_operating']]

df['years_active'] = df['End'].replace('Present', '2026').astype(int) - df['Start'].astype(int)
df = df[df['years_active'] >= 10]

df['lat_bin'] = (df['Lat'].astype(float) // 2) * 2
df['lon_bin'] = (df['Lon'].astype(float) // 2) * 2

candidates = (
    df.sort_values('years_active', ascending=False)
      .groupby(['lat_bin', 'lon_bin'])
      .head(5)
)

candidates.to_csv('BOM-Scraper/data/candidate_stations.csv', index=False)
print(f"{len(candidates)} candidate stations saved")