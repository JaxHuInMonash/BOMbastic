import pandas as pd

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
print(df)