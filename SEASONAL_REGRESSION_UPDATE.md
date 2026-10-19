# Seasonal + Trend regression update

This project is based on the supplied `demo.zip` with the seasonal regression fixes applied.

## Changes
- Fixes the React regression hook to send requests for **one variable** rather than requiring x and y.
- Selects stations with one weather variable with sufficient date coverage, instead of requiring two overlapping variables.
- Defaults the Relationship tab to a five-year period when entering it from the one-year preset.
- Allows monthly temperature means with >=70% observed daily coverage and rainfall totals with >=90% covered daily data. The fit still requires 24 usable months.

## Run locally
1. Install dependencies: `pip install -r requirements.txt` and `(cd frontend && npm install)`.
2. Start PostgreSQL and configure the existing database/credentials according to README.md. The database is not embedded in this ZIP.
3. From `backend/`: `python -m uvicorn main:app --reload --port 8001`.
4. From `frontend/`: `npm run dev`; open http://localhost:5173.

## Before pushing
- Review the changes and verify the regression on a station with at least 24 usable months.
- Do not commit personal credentials, environment files, or installed dependencies.
- Legacy two-variable regression tests may require updating.
- Some stations legitimately lack sufficient observations; the patch cannot create missing data.
