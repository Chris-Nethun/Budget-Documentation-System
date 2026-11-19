import sys
import pandas as pd
import json
from datetime import datetime
import os
import uuid
import tempfile
import threading
from decimal import Decimal, InvalidOperation

try:
    import pythoncom
except ImportError:
    pythoncom = None

try:
    import docx2pdf
except ImportError:
    docx2pdf = None

from docx import Document
import re

import budget_loader

DB_PATH = 'database.xlsx'
db_lock = threading.Lock()

def get_employee(emp_id):
    try:
        df = pd.read_excel(DB_PATH, sheet_name='Employees')
        emp = df[df['Employee ID'].astype(str).str.strip() == str(emp_id).strip()]
        if emp.empty:
            return {"status": "error", "message": "Employee ID not found"}
        data = emp.iloc[0].to_dict()
        data = {k: (str(v) if pd.isna(v) else v) for k, v in data.items()}
        return {"status": "success", "data": data}
    except Exception as e:
        return {"status": "error", "message": str(e)}

def get_budgets():
    try:
        error = budget_loader.ensure_current()
        if error:
            return error
        return {"status": "success", "data": _catalog_with_balances()}
    except Exception as e:
        return {"status": "error", "message": str(e)}

def _number(value):
    return int(value) if value == value.to_integral_value() else float(value)


def _catalog_with_balances(catalog=None):
    catalog = catalog or budget_loader.read_catalog()
    vouchers = pd.read_excel(DB_PATH, sheet_name="Vouchers")
    if "Sub Budget Code" not in vouchers or "Amount" not in vouchers:
        raise ValueError("Vouchers sheet is missing required budget columns")

    spent_by_code = {}
    for _, row in vouchers.iterrows():
        raw_code = row["Sub Budget Code"]
        value = row["Amount"]
        if pd.isna(raw_code) or pd.isna(value):
            continue
        try:
            code = budget_loader.normalize_code(str(raw_code))
            amount = Decimal(str(value))
        except (ValueError, InvalidOperation) as error:
            raise ValueError(f"Invalid voucher budget entry: {raw_code}, {value}") from error
        if not amount.is_finite():
            raise ValueError(f"Invalid voucher amount for {code}: {value}")
        spent_by_code[code] = spent_by_code.get(code, Decimal("0")) + amount

    for main in catalog["main"]:
        key = f"{main['code']}. {main['name']}"
        for line in catalog["sub"][key]:
            allocated = Decimal(str(line["allocated"]))
            spent = spent_by_code.get(line["code"], Decimal("0"))
            line["spent"] = _number(spent)
            line["remaining"] = _number(allocated - spent)
    return catalog


def _balance_data(budget_code, catalog=None):
    try:
        catalog = _catalog_with_balances(catalog)
        main = next((item for item in catalog["main"] if item["code"] == budget_code), None)
        if main:
            lines = catalog["sub"][f"{main['code']}. {main['name']}"]
            allocated = sum((Decimal(str(line["allocated"])) for line in lines), Decimal("0"))
            spent = sum((Decimal(str(line["spent"])) for line in lines), Decimal("0"))
            remaining = allocated - spent
            return {
                "status": "success",
                "data": {
                    "budgetCode": budget_code,
                    "mainBudgetCode": budget_code,
                    "allocated": _number(allocated),
                    "spent": _number(spent),
                    "remaining": _number(remaining),
                },
            }

        line = next(
            (line for lines in catalog["sub"].values()
             for line in lines if line["code"] == budget_code),
            None,
        )
        if line is None:
            return {"status": "error", "message": f"Unknown budget code: {budget_code}"}
        return {
            "status": "success",
            "data": {
                "budgetCode": budget_code,
                "subBudgetCode": budget_code,
                "allocated": line["allocated"],
                "spent": line["spent"],
                "remaining": line["remaining"],
            },
        }
    except Exception as error:
        return {"status": "error", "message": str(error)}


def get_balance(budget_code):
    error = budget_loader.ensure_current()
    if error:
        return error
    code = str(budget_code).strip()
    try:
        code = budget_loader.normalize_code(code)
    except ValueError:
        code = code.upper()
    return _balance_data(code)


def _write_ledger(emp_id, amount, date_str, main_budget, sub_budget, payment_method,
                  prepared_by, description, voucher_id, remaining):
    database_path = os.path.abspath(DB_PATH)
    with pd.ExcelFile(database_path) as workbook:
        sheets = {sheet: workbook.parse(sheet) for sheet in workbook.sheet_names}

    vouchers_df = sheets["Vouchers"]
    new_voucher = pd.DataFrame([{
        "Voucher ID": voucher_id,
        "Employee ID": emp_id,
        "Amount": float(amount),
        "Date": date_str,
        "Status": "Approved",
        "Main Budget Code": main_budget,
        "Sub Budget Code": sub_budget,
        "Payment Method": payment_method,
        "Prepared By": prepared_by,
    }])
    sheets["Vouchers"] = pd.concat([vouchers_df, new_voucher], ignore_index=True)

    transactions_df = sheets["Transactions"]
    new_transaction = pd.DataFrame([{
        "Transaction Type": "Voucher Payment",
        "Amount": float(amount),
        "Remaining Balance": _number(remaining),
        "Date": date_str,
        "Description": f"Voucher {voucher_id} for {description}",
        "Main Budget Code": main_budget,
        "Sub Budget Code": sub_budget,
        "Payment Method": payment_method,
        "Prepared By": prepared_by,
    }])
    sheets["Transactions"] = pd.concat([transactions_df, new_transaction], ignore_index=True)

    descriptor, temporary_path = tempfile.mkstemp(
        prefix=".budget-ledger-", suffix=".xlsx", dir=os.path.dirname(database_path)
    )
    os.close(descriptor)
    try:
        with pd.ExcelWriter(temporary_path) as writer:
            for sheet, frame in sheets.items():
                frame.to_excel(writer, sheet_name=sheet, index=False)
        os.replace(temporary_path, database_path)
    finally:
        if os.path.exists(temporary_path):
            os.unlink(temporary_path)


def _process_transaction(emp_id, main_budget, sub_budget, amount, description,
                         payment_method, prepared_by):
    employee_result = get_employee(emp_id)
    if employee_result.get("status") != "success":
        if employee_result.get("message") == "Employee ID not found":
            return {"status": "error", "message": "Employee ID not found"}
        return employee_result

    try:
        amount_value = Decimal(str(amount))
    except InvalidOperation:
        return {"status": "error", "message": "Amount must be a valid number"}
    if not amount_value.is_finite() or amount_value <= 0:
        return {"status": "error", "message": "Amount must be greater than zero"}

    raw_sub_budget = str(sub_budget).strip()
    if not raw_sub_budget:
        return {"status": "error", "message": "Sub budget code is required"}
    try:
        sub_budget = budget_loader.normalize_code(raw_sub_budget)
    except ValueError as error:
        return {"status": "error", "message": str(error)}

    try:
        catalog = budget_loader.read_catalog()
    except (OSError, ValueError) as error:
        return {"status": "error", "message": str(error)}
    main_code = sub_budget[0]
    main_entry = next(
        (item for item in catalog["main"] if item["code"] == main_code),
        None,
    )
    if main_entry is None:
        return {"status": "error", "message": f"Unknown main budget code: {main_code}"}
    main_value = str(main_budget).strip()
    accepted_main_values = {
        main_code.casefold(),
        main_entry["name"].casefold(),
        f"{main_code}. {main_entry['name']}".casefold(),
    }
    if main_value.casefold() not in accepted_main_values:
        return {
            "status": "error",
            "message": f"Sub budget {sub_budget} does not belong to main budget {main_value}.",
        }

    balance_result = _balance_data(sub_budget, catalog)
    if balance_result.get("status") != "success":
        return balance_result
    balance = balance_result["data"]
    available = Decimal(str(balance["remaining"]))
    if amount_value > available:
        return {
            "status": "error",
            "message": (
                f"Amount exceeds the remaining balance for {sub_budget} "
                f"({balance['remaining']})."
            ),
        }

    emp_data = employee_result["data"]

    def employee_value(key):
        value = emp_data.get(key)
        if pd.isna(value) or str(value).strip().lower() == "nan":
            return ""
        return str(value)

    emp_name = employee_value("Name")
    bank_name = employee_value("Bank Name")
    ac_number = employee_value("AC number")
    bank_details = f"{bank_name} - {ac_number}".strip(" -")

    voucher_id = f"V-{uuid.uuid4().hex[:6].upper()}"
    date_str = datetime.now().strftime("%Y-%m-%d")
    output_dir = os.path.join(os.path.dirname(os.path.abspath(DB_PATH)), "Output")
    os.makedirs(output_dir, exist_ok=True)
    files = [
        os.path.join(output_dir, f"{date_str}_voucher_{voucher_id}.docx"),
        os.path.join(output_dir, f"{date_str}_voucher_{voucher_id}.pdf"),
        os.path.join(output_dir, f"{date_str}_cover_{voucher_id}.docx"),
        os.path.join(output_dir, f"{date_str}_cover_{voucher_id}.pdf"),
    ]

    try:
        if pythoncom is not None:
            pythoncom.CoInitialize()
        if docx2pdf is None:
            raise RuntimeError("docx2pdf is required for PDF generation")

        doc_v = Document("VoucherTemplate.docx")
        for paragraph in doc_v.paragraphs:
            if "Name:" in paragraph.text:
                paragraph.text = paragraph.text.replace("Name:", f"Name: {emp_name}")
            if "Payable To:" in paragraph.text:
                paragraph.text = paragraph.text.replace(
                    "Payable To:", f"Payable To: {emp_name} ({emp_id})"
                )
            if paragraph.text.strip() == "Prepared by":
                paragraph.text = f"Prepared by: {prepared_by}"
            elif "Prepared by" in paragraph.text and len(paragraph.text) < 20:
                paragraph.text = paragraph.text.replace("Prepared by", f"Prepared by: {prepared_by}")

        if doc_v.tables and len(doc_v.tables[0].rows) > 1:
            table = doc_v.tables[0]
            table.rows[1].cells[0].text = date_str
            table.rows[1].cells[1].text = description
            table.rows[1].cells[2].text = str(amount_value)
            table.rows[1].cells[3].text = str(amount_value)
            if len(table.rows) > 2:
                table.rows[2].cells[3].text = str(amount_value)
        doc_v.save(files[0])
        docx2pdf.convert(files[0], files[1])

        doc_c = Document("CoverLetterTemplate.docx")
        for paragraph in doc_c.paragraphs:
            if paragraph.text.strip() == "Date":
                paragraph.text = date_str
            if "Budget Name" in paragraph.text:
                paragraph.text = (
                    paragraph.text.replace("Budget Name", main_budget)
                    .replace("Year", "2026")
                    .replace("Budget Code", sub_budget)
                )
            if "Prepared by" in paragraph.text and ".........." in paragraph.text:
                paragraph.text = re.sub(
                    r"Prepared by \.+", f"Prepared by: {prepared_by}".ljust(45), paragraph.text
                )

        if doc_c.tables and len(doc_c.tables[0].rows) > 1:
            table = doc_c.tables[0]
            table.rows[1].cells[0].text = "1"
            table.rows[1].cells[1].text = emp_name
            table.rows[1].cells[2].text = description
            table.rows[1].cells[3].text = payment_method
            table.rows[1].cells[4].text = bank_details
            table.rows[1].cells[8].text = str(amount_value)
        doc_c.save(files[2])
        docx2pdf.convert(files[2], files[3])
    except Exception as error:
        for file_path in files:
            if os.path.exists(file_path):
                os.remove(file_path)
        return {"status": "error", "message": f"Document generation failed: {error}"}

    remaining = available - amount_value
    try:
        _write_ledger(
            emp_id, amount_value, date_str, main_budget, sub_budget, payment_method,
            prepared_by, description, voucher_id, remaining,
        )
    except Exception as error:
        for file_path in files:
            if os.path.exists(file_path):
                os.remove(file_path)
        return {"status": "error", "message": f"Transaction was not recorded: {error}"}

    return {
        "status": "success",
        "message": f"Transaction approved. Voucher {voucher_id} generated.",
        "voucher_id": voucher_id,
        "remaining_balance": _number(remaining),
    }


def process_transaction(emp_id, main_budget, sub_budget, amount, description,
                        payment_method, prepared_by):
    with db_lock:
        error = budget_loader.ensure_current()
        if error:
            return error
        return _process_transaction(
            emp_id, main_budget, sub_budget, amount, description, payment_method, prepared_by
        )

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({"status": "error", "message": "No command provided"}))
        sys.exit(1)
        
    cmd = sys.argv[1]
    if cmd == 'get_employee':
        print(json.dumps(get_employee(sys.argv[2])))
    elif cmd == 'get_budgets':
        print(json.dumps(get_budgets()))
    elif cmd == 'process':
        emp_id = sys.argv[2]
        main_budget = sys.argv[3]
        sub_budget = sys.argv[4]
        amount = sys.argv[5]
        desc = sys.argv[6]
        payment = sys.argv[7]
        prepared_by = sys.argv[8]
        print(json.dumps(process_transaction(emp_id, main_budget, sub_budget, amount, desc, payment, prepared_by)))
