import csv
from decimal import Decimal
from pathlib import Path
import shutil
import sys
from types import SimpleNamespace

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import backend
import budget_loader
import desktop_api


def _convert_to_pdf(_docx_path, pdf_path):
    Path(pdf_path).write_bytes(b"test pdf")


@pytest.fixture
def app_files(tmp_path, monkeypatch):
    for filename in (
        "database.xlsx",
        "budget.csv",
        "VoucherTemplate.docx",
        "CoverLetterTemplate.docx",
    ):
        shutil.copy2(ROOT / filename, tmp_path / filename)

    (tmp_path / "Output").mkdir()
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(backend, "DB_PATH", str(tmp_path / "database.xlsx"))
    monkeypatch.setattr(budget_loader, "BUDGET_CSV", str(tmp_path / "budget.csv"))
    monkeypatch.setattr(budget_loader, "BUDGETS_JSON", str(tmp_path / "budgets_extracted.json"))
    monkeypatch.setattr(backend, "pythoncom", SimpleNamespace(CoInitialize=lambda: None))
    monkeypatch.setattr(
        backend,
        "docx2pdf",
        SimpleNamespace(convert=_convert_to_pdf),
    )
    assert budget_loader.ensure_current() is None
    return tmp_path


def _balance():
    result = backend.get_balance("B1.1")
    assert result["status"] == "success"
    return Decimal(str(result["data"]["remaining"]))


def _submit(amount, employee_id="E001"):
    return backend.process_transaction(
        employee_id,
        "Direct Cost",
        "B1.1",
        str(amount),
        "Budget tracking test",
        "Transfer",
        "Test User",
    )


def _ledger_counts(workbook):
    with pd.ExcelFile(workbook) as excel:
        return (
            len(excel.parse("Vouchers")),
            len(excel.parse("Transactions")),
        )


def _append_voucher(workbook, code, amount):
    with pd.ExcelFile(workbook) as excel:
        sheets = {name: excel.parse(name) for name in excel.sheet_names}
    vouchers = sheets["Vouchers"]
    row = {column: None for column in vouchers.columns}
    row.update({
        "Voucher ID": "V-TEST-BALANCE",
        "Amount": amount,
        "Sub Budget Code": code,
    })
    sheets["Vouchers"] = pd.concat([vouchers, pd.DataFrame([row])], ignore_index=True)
    with pd.ExcelWriter(workbook) as writer:
        for name, frame in sheets.items():
            frame.to_excel(writer, sheet_name=name, index=False)


def _find_line(catalog, code):
    return next(
        line for lines in catalog["sub"].values()
        for line in lines if line["code"] == code
    )


def _set_budget_amount(csv_path, code, amount):
    with csv_path.open(encoding="utf-8-sig", newline="") as stream:
        rows = list(csv.reader(stream))
    amount_column = next(
        index for index, value in enumerate(rows[0])
        if "estimated revenue" in value.lower()
    )
    row = next(row for row in rows if row and row[0].strip() == code)
    row[amount_column] = str(amount)
    with csv_path.open("w", encoding="utf-8-sig", newline="") as stream:
        csv.writer(stream).writerows(rows)


def test_loader_returns_only_supported_main_budgets_and_ignores_income():
    catalog = budget_loader.parse_budget_csv()

    assert [main["code"] for main in catalog["main"]] == ["B", "C", "D", "E"]
    assert all(not line["code"].startswith("A") for lines in catalog["sub"].values() for line in lines)


def test_loader_groups_only_positive_payable_lines_and_normalizes_codes(tmp_path):
    csv_path = tmp_path / "budget.csv"
    shutil.copy2(ROOT / "budget.csv", csv_path)
    with csv_path.open(encoding="utf-8-sig", newline="") as stream:
        rows = list(csv.reader(stream))
    next(row for row in rows if row and row[0].strip() == "D1.2.2")[0] = "D1.2,2"
    with csv_path.open("w", encoding="utf-8-sig", newline="") as stream:
        csv.writer(stream).writerows(rows)
    catalog = budget_loader.parse_budget_csv(csv_path)

    for main in catalog["main"]:
        lines = catalog["sub"][f"{main['code']}. {main['name']}"]
        assert all(line["code"].startswith(main["code"]) for line in lines)
        assert all(line["allocated"] > 0 for line in lines)
        assert all(
            not line["name"].upper().startswith(("TOTAL", "SUB TOTAL", "GRAND TOTAL"))
            for line in lines
        )

    assert [line["code"] for line in catalog["sub"][f"C. {catalog['main'][1]['name']}"]] == ["C"]
    assert _find_line(catalog, "B4")["name"] == "Government Taxes (5% of A)"
    assert _find_line(catalog, "D1.2.2")["name"] == "Staff 4"
    all_codes = [line["code"] for lines in catalog["sub"].values() for line in lines]
    assert len(all_codes) == len(set(all_codes))
    assert not {"B1.4", "B2.1", "B2.1.3", "D1", "D1.2", "D2.1"}.intersection(all_codes)


def test_budgets_and_main_balance_include_spending_and_remaining(app_files):
    workbook = app_files / "database.xlsx"
    _append_voucher(workbook, "B1.1", 1234.5)

    result = backend.get_budgets()

    assert result["status"] == "success"
    catalog = result["data"]
    line = _find_line(catalog, "B1.1")
    assert Decimal(str(line["allocated"])) == Decimal("360000")
    assert Decimal(str(line["spent"])) == Decimal("1234.5")
    assert Decimal(str(line["remaining"])) == Decimal("358765.5")
    for budget_lines in catalog["sub"].values():
        for budget_line in budget_lines:
            assert Decimal(str(budget_line["remaining"])) == (
                Decimal(str(budget_line["allocated"])) - Decimal(str(budget_line["spent"]))
            )

    main_result = backend.get_balance("B")
    main_lines = catalog["sub"]["B. Direct Cost"]
    assert main_result["status"] == "success"
    assert Decimal(str(main_result["data"]["allocated"])) == sum(
        (Decimal(str(item["allocated"])) for item in main_lines), Decimal("0")
    )
    assert Decimal(str(main_result["data"]["spent"])) == sum(
        (Decimal(str(item["spent"])) for item in main_lines), Decimal("0")
    )
    assert Decimal(str(main_result["data"]["remaining"])) == sum(
        (Decimal(str(item["remaining"])) for item in main_lines), Decimal("0")
    )
    sub_result = backend.get_balance("B1.1")
    assert sub_result["data"]["remaining"] == line["remaining"]


def test_amount_below_balance_succeeds_and_records_remaining(app_files):
    workbook = app_files / "database.xlsx"
    before_vouchers, before_transactions = _ledger_counts(workbook)
    balance = _balance()
    amount = balance / 2

    result = _submit(amount)

    assert result["status"] == "success"
    assert Decimal(str(result["remaining_balance"])) == balance - amount
    after_vouchers, after_transactions = _ledger_counts(workbook)
    assert after_vouchers == before_vouchers + 1
    assert after_transactions == before_transactions + 1
    with pd.ExcelFile(workbook) as excel:
        transaction = excel.parse("Transactions").iloc[-1]
    assert Decimal(str(transaction["Remaining Balance"])) == balance - amount
    assert len(list((app_files / "Output").iterdir())) == 4


def test_amount_above_balance_is_rejected_without_files_or_ledger(app_files):
    workbook = app_files / "database.xlsx"
    before = _ledger_counts(workbook)
    amount = _balance() + Decimal("1")

    result = _submit(amount)

    assert result["status"] == "error"
    assert "exceeds" in result["message"].lower()
    assert _ledger_counts(workbook) == before
    assert list((app_files / "Output").iterdir()) == []


def test_amount_equal_to_balance_succeeds_with_zero_remaining(app_files):
    workbook = app_files / "database.xlsx"
    balance = _balance()

    result = _submit(balance)

    assert result["status"] == "success"
    assert Decimal(str(result["remaining_balance"])) == 0
    with pd.ExcelFile(workbook) as excel:
        transaction = excel.parse("Transactions").iloc[-1]
    assert Decimal(str(transaction["Remaining Balance"])) == 0
    assert len(list((app_files / "Output").iterdir())) == 4


def test_unknown_employee_returns_exact_error_without_writes(app_files):
    workbook = app_files / "database.xlsx"
    before = _ledger_counts(workbook)

    result = _submit(Decimal("1000"), employee_id="UNKNOWN")

    assert result == {"status": "error", "message": "Employee ID not found"}
    assert _ledger_counts(workbook) == before
    assert list((app_files / "Output").iterdir()) == []


def test_pdf_conversion_failure_removes_documents_and_writes_no_ledger(app_files, monkeypatch):
    workbook = app_files / "database.xlsx"
    before = _ledger_counts(workbook)

    def fail_conversion(_docx_path, _pdf_path):
        raise RuntimeError("PDF conversion failed")

    monkeypatch.setattr(backend.docx2pdf, "convert", fail_conversion)
    result = _submit(Decimal("1000"))

    assert result["status"] == "error"
    assert "PDF conversion failed" in result["message"]
    assert _ledger_counts(workbook) == before
    assert list((app_files / "Output").iterdir()) == []


def test_editing_budget_csv_regenerates_catalog_on_budgets_request(app_files):
    csv_path = app_files / "budget.csv"
    _set_budget_amount(csv_path, "B1.1", 361000)

    result = backend.get_budgets()

    assert result["status"] == "success"
    assert _find_line(result["data"], "B1.1")["allocated"] == 361000
    assert _find_line(budget_loader.read_catalog(), "B1.1")["allocated"] == 361000


def test_process_action_refreshes_catalog_when_csv_changes(app_files):
    _set_budget_amount(app_files / "budget.csv", "B1.1", 362000)

    result = desktop_api.handle({"action": "process", "payload": {}})

    assert result["status"] == "error"
    assert "Missing required fields" in result["message"]
    assert _find_line(budget_loader.read_catalog(), "B1.1")["allocated"] == 362000


def test_invalid_budget_csv_keeps_last_good_catalog_and_reports_error(app_files):
    catalog_path = app_files / "budgets_extracted.json"
    csv_path = app_files / "budget.csv"
    last_good = catalog_path.read_bytes()
    csv_path.write_text("not,a,budget,header\n", encoding="utf-8")

    result = backend.get_budgets()

    assert result["status"] == "error"
    assert "Estimated revenue / Cost" in result["message"]
    assert catalog_path.read_bytes() == last_good
