import pandas as pd
import os

with open("BOM-Scraper/stations_list.txt") as f:
  text = f.readlines()[4:]

test = text[0].split()

rows = []

for i in range(len(text)-5):

    line = text[i].split()
    row = [line[0], line[1]]

    j = 3

    name = " ".join(line[2:-9])

    row.append(name)

    if line[-8] == "..":
       line[-8] = "Present"

    if line[-3] == "..":
        line[-3] = "N/A"

    if line[-2] == "..":
        line[-2] = "N/A"

    row.extend(line[-9:-5])
    row.extend(line[-4:-1])
    rows.append(row)

df = pd.DataFrame(rows, columns=['STN', 'Dist', 'Name', 'Start', 'End', 'Lat', 'Lon', 'State', 'Height (m)', 'Bar_ht'])

os.makedirs("BOM-Scraper/data", exist_ok=True)
df.to_csv('BOM-Scraper/data/stations_list.csv', index=False)

# ---- narrow down to a manageable, spread-out set of candidate stations ----

df['still_operating'] = df['End'] == "Present"
df = df[df['still_operating']]

df['years_active'] = df['End'].replace('Present', '2026').astype(int) - df['Start'].astype(int)
df = df[df['years_active'] >= 10]

df['lat_bin'] = (df['Lat'].astype(float) // 2) * 2
df['lon_bin'] = (df['Lon'].astype(float) // 2) * 2

candidates = (
    df.sort_values('years_active', ascending=False)
      .groupby(['lat_bin', 'lon_bin'])
      .head(2)
)

candidates.to_csv('BOM-Scraper/data/candidate_stations.csv', index=False)
print(f"{len(candidates)} candidate stations saved")