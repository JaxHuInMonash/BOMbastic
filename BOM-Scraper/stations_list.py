import pandas as pd

with open("BOM-Scraper/stations_list.txt") as f:
  text = f.readlines()[4:]

df = pd.DataFrame(columns=['STN', 'Dist', 'Name', 'Start', 'End', 'Lat', 'Lon', 'State', 'Height (m)', 'Bar_ht'])

test = text[0].split()
print(test)
print(test[-3])
print(test[-4:-1])
rows = []

for i in range(len(text)-5):

    line = text[i].split()
    row = [line[0], line[1]]

    j = 3

    name_done = False
    name = line[2]

    while not name_done:

        if line[j].isnumeric() and len(line[j]) == 4:
           row.append(name)
           break

        name += " " + line[j]
        j += 1

    if line[-8] == "..":
       line[-8] = "Present"

    if line[-3] == "..":
        line[-3] = "N/A"

    if line[-2] == "..":
        line[-2] = "N/A"

    row.extend(line[-9:-5])
    row.extend(line[-4:-1])
    rows.append(row)
    print(row)

df1 = pd.DataFrame(rows)
print(df1)