# EV Daily Maintenance Automator

Turns a pasted WhatsApp shift report into an editable `.xlsx` daily maintenance log.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Workflow

1. **Paste** the WhatsApp shift report text.
2. **Parse** it - the app extracts the date, shift, and each truck's job into an editable table.
3. **Review** every job. The parser flags anything it isn't confident about (missing times, an unclear status) with a warning - fix those before generating.
4. **Generate & download** - the app writes the reviewed data into a fresh copy of `public/Daily maintenance log.xlsx` and downloads it. The template itself is never modified; every download starts from the same clean template plus whatever's already recorded past the last used row, so numbering continues correctly across separate report runs without ever losing or overwriting a previous day's rows.

## Template mapping

`public/Daily maintenance log.xlsx` has two sheets:

**Sheet1 - "DAILY COMPLETED LOG"** gets one row per job with status **Completed**:
`NO, DATE, TRUCK No., SHIFT, Start time, Finish time, Duration, Task Category, JOB DESCRIPTION, ACTION, STATUS, Assigned To`

**Sheet2 - "DOWN EV TRUCKS"** gets one row for every job that has a start (down) time recorded, whether it was resolved during the shift or is still open:
`TRUCK No., Down Date, Down Time, Up Date, Up Time, Reason, Current Status, ETA`
A resolved job fills in Up Date/Time and marks status `up`; a job still marked **Down** leaves those blank and records the ETA instead.

This means most jobs appear on **both** sheets - Sheet1 as the completed work record, Sheet2 as the downtime timeline - which matches how the team's own reference reports were filled in.

## What was fixed vs. the previous version

- **The template file had real sample data baked into it** (rows 10-13 on Sheet1, rows 4-8 on Sheet2), so every generated report looked unchanged no matter what was pasted - the new rows were being appended correctly, just underneath permanent leftover sample data. The template shipped here is header-only, with formatting pre-applied 500 rows down so new rows always look consistent.
- **Down-truck tracking only ever wrote truly-still-down jobs to Sheet2**, silently dropping every truck that went down and came back up in the same shift - even though the team's own reference file tracks those too. Fixed as described above.
- **Times were written as raw text** instead of real Excel time values, and **dates were parsed ambiguously** (day/month vs. month/day). Both are now parsed and written explicitly, matching the template's own `M/d/yyyy` / `h:mm` cell formats.
- **Row numbering broke on any gap** in the sheet (it inferred the next NO. from the row's position, not from the data). It now reads the last number actually used.
- **The parser silently dropped job descriptions** for lines phrased like "ET013 is down for a leaking hose..." because of an overly strict pattern match. It now keeps the text and instead flags jobs where it genuinely can't tell the outcome, for you to confirm.
- **The API route had no cache/dynamic controls**, so a platform or browser cache could in principle serve a stale response. It now explicitly disables caching.

## Vercel

Import the Git repository into Vercel. No environment variables are required.
