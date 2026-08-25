import pandas as pd

all_stations = pd.read_csv('BOM-Scraper/data/stations_list.csv', dtype={"STN": str})
best_stations = pd.read_csv('BOM-Scraper/data/best_stations.csv', dtype={"STN": str})

all_stations['lat_bin'] = (all_stations['Lat'].astype(float) // 2) * 2
all_stations['lon_bin'] = (all_stations['Lon'].astype(float) // 2) * 2

bin_totals = (
    all_stations.groupby(['lat_bin', 'lon_bin'])
    .size()
    .reset_index(name='total_stations_in_bin')
)

best_stations = best_stations.drop(columns=['total_stations_in_bin'], errors='ignore')

best_stations = best_stations.merge(bin_totals, on=['lat_bin', 'lon_bin'], how='left')

best_stations.to_csv('BOM-Scraper/data/best_stations.csv', index=False)
print(best_stations[['STN', 'lat_bin', 'lon_bin', 'total_stations_in_bin']])