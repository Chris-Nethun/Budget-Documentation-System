# Budget Documentation System

A Windows desktop application for preparing budget transactions, maintaining voucher records, and generating approval documents.

## Current application

The application uses a React interface packaged with Electron and a Python backend. The desktop app communicates with the backend directly through Electron IPC; it does not start or require an HTTP server.

## Features

- Search employees by Employee ID and load their stored details.
- Select the B, C, D, and E main budgets and their payable sub-budget lines; income and A rows are excluded.
- See allocated, spent, and remaining funds for each line and the selected main budget.
- Block transactions that exceed the line's available balance.
- Enter payment details and validate transactions.
- Generate voucher and cover-letter documents in Word and PDF formats.
- Update the `Vouchers` and `Transactions` sheets in the Excel workbook.
- Review recent vouchers and open generated PDFs.

## Project structure

- `frontend/` – React UI, Electron desktop shell, and Windows installer configuration.
- `backend.py` – Python document generation, balance checks, and Excel ledger updates.
- `budget_loader.py` – parses `budget.csv`, normalizes budget codes, and refreshes the generated B/C/D/E catalog.
- `desktop_api.py` – action bridge used by the desktop app over Electron IPC.
- `database.xlsx` – workbook used by the source checkout.
- `budget.csv` – source budget, including allocations and rate/quantity calculations.
- `budgets_extracted.json` – generated budget catalog; do not edit directly.
- `VoucherTemplate.docx`, `CoverLetterTemplate.docx` – document templates.
- `Output/` – generated documents when running from the source checkout.
- `tests/test_budget.py` – budget and transaction tests.

## Requirements

- Windows 10 or 11.
- Python 3.9 or later and the required packages:

  ```bash
  pip install pandas openpyxl python-docx docx2pdf pywin32
  ```

- Node.js and npm to develop or build the desktop application.
- Microsoft Word for PDF conversion (`docx2pdf` uses Word automation).

## Run the desktop app from source

From the project folder:

```bash
pip install pandas openpyxl python-docx docx2pdf pywin32
cd frontend
npm install
npm run desktop:dev
```

In source mode, the app uses the workbook and templates in the project folder.

## Build a Windows installer

From `frontend/`:

```bash
npm install
npm run dist:win
```

The installer is created in `frontend/dist/`. The installer does not include a workbook or generated documents. On first launch, select the workbook to use. The app copies it into `%APPDATA%\budget-docs-frontend\database.xlsx` and stores subsequent workbook updates and generated documents there; the selected original workbook is not modified. In the app, use **Show database.xlsx** to open the folder containing the workbook the app updates. Python and the packages above must be installed on the computer running the app.

The application is desktop-only. There is no browser UI or HTTP server to start. Changes to `budget.csv` are detected by modification time when the app loads budgets, checks a balance, or processes a transaction; the desktop app also refreshes the catalog every 15 seconds and when it regains focus. For an installed app, edit `%APPDATA%\budget-docs-frontend\budget.csv`; source mode uses the file in the project folder. The JSON catalog is replaced atomically; if the CSV is invalid, the last good catalog is retained and the app reports the parsing error.

Only payable rows with a positive allocation appear in the sub-budget dropdown; headings, totals, and A/income rows are omitted. The C contribution is represented as its own selectable line. Codes are normalized (for example `B.4` to `B4` and `D1.2,2` to `D1.2.2`). Exhausted lines remain visible but cannot be selected.

The budget bar shows the selected main or sub line's allocation, voucher spending to date, and projected remaining balance after the amount currently entered. Processing rechecks the employee and current sub-line balance under a lock before generating documents. Ledger rows are written last, and any documents are removed if PDF conversion or ledger writing fails.

Run the focused tests from the project folder:

```bash
pip install pytest
pytest -q tests/test_budget.py
```

The tests use temporary copies of the workbook and CSV and stub Windows COM/PDF conversion, so they do not require Microsoft Word. They cover catalog filtering and code normalization, per-line/main balances, CSV refresh, transaction bounds, unknown employees, and failed PDF conversion.

## Data and generated documents

The workbook must contain `Employees`, `Vouchers`, and `Transactions` sheets. The Word templates must be available to the backend. The remaining balance for a budget line is its `allocated` amount from `budget.csv` minus the sum of `Amount` values in `Vouchers` for that `Sub Budget Code`. In the packaged desktop app, workbook changes and generated documents are kept in the app's Windows application-data folder; when running from source, they are kept in the project folder's `database.xlsx` and `Output/`.
