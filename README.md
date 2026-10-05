# FIT3164-BOMbastic
Interactive Data Visualisation Project focused on BOM weather data. Part of the FIT3164 curriculum.

## Run it locally

The dashboard reads a PostgreSQL database on your own machine; nothing is hosted.
Setup is once per machine. After that, starting the app takes two terminals.
Commands are PowerShell, run from the repository root.

### What you need

- **Python 3.11+**
- **Node.js 22 LTS** (Vite 8 needs at least 20.19)
- **PostgreSQL 16**, with `psql` on PATH. If `psql` is not recognised, add
  `C:\Program Files\PostgreSQL\16\bin` to PATH and open a new terminal.

### One-time setup

The raw BOM CSVs are already in the repository under `BOM-Scraper/data/`, so
nothing is downloaded from BOM.

```powershell
git checkout feature; git pull
python -m pip install -r requirements.txt

# 1. Combine the per-station CSVs into one file per variable
#    (these *_all.csv files are git-ignored)
python BOM-Scraper/combine_csvs.py rainfall
python BOM-Scraper/combine_csvs.py tmax
python BOM-Scraper/combine_csvs.py tmin

# 2. Create the database and load it (the rainfall load takes a few minutes)
psql -U postgres -c "CREATE DATABASE bombastic"
psql -U postgres -d bombastic -v ON_ERROR_STOP=1 -f stations_database.sql
psql -U postgres -d bombastic -v ON_ERROR_STOP=1 -f rainfall_database.sql
psql -U postgres -d bombastic -v ON_ERROR_STOP=1 -v variable=tmax -f observations_database.sql
psql -U postgres -d bombastic -v ON_ERROR_STOP=1 -v variable=tmin -f observations_database.sql
```

`psql` asks for the `postgres` password each time; nothing shows while you type.
The loads can be re-run safely (rows are upserted), so after pulling new data,
repeat steps 1 and 2 for that variable.

### Start the app

```powershell
# Terminal 1 - API on http://localhost:8000
$env:PGPASSWORD = Read-Host "Postgres password"
cd backend; uvicorn main:app --reload --port 8000

# Terminal 2 - dashboard on http://localhost:5173
cd frontend; npm install; npm run dev
```

`npm install` is only needed the first time and after `package.json` changes.
The API reads the password from `PGPASSWORD` for that terminal only; don't
save it to a file or commit it. To use a database other than
`postgresql://postgres@localhost:5432/bombastic`, set `BOMBASTIC_DATABASE_URL`.

### Check it works

- http://localhost:8000/health returns `{"status":"ok","database":"ok"}`.
- http://localhost:8000/docs lists the API endpoints.
- The dashboard shows station markers; pick one to see its data.

| Symptom | Cause |
|---|---|
| `'psql' is not recognized` | PostgreSQL `bin` folder not on PATH (see above) |
| Dashboard says "Couldn't load stations" | The API (terminal 1) isn't running |
| API answers 503 | `PGPASSWORD` not set in the API terminal, or PostgreSQL isn't running |
| 503 mentioning the schema is out of date | Re-run `stations_database.sql`, then the loads |

### Tests

```powershell
python -m unittest discover -s tests -p "test_*.py" -v
```

Database tests are skipped unless `BOMBASTIC_TEST_DATABASE_URL` points at a
loaded database, e.g.
`$env:BOMBASTIC_TEST_DATABASE_URL = "postgresql://postgres@localhost:5432/bombastic"`.
