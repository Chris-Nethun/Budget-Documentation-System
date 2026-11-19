"""JSON bridge for the Windows desktop app; the UI communicates over Electron IPC."""
import json
import os
import sys

import pandas as pd

import backend


def clean(value):
    if pd.isna(value):
        return ""
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def list_employees():
    df = pd.read_excel(backend.DB_PATH, sheet_name="Employees")
    rows = [
        {
            "id": str(clean(row.get("Employee ID"))),
            "name": str(clean(row.get("Name"))),
            "department": str(clean(row.get("Department"))),
        }
        for row in df.to_dict("records")
    ]
    return {"status": "success", "data": rows}


def employee_details(emp_id):
    result = backend.get_employee(emp_id)
    if result.get("status") != "success":
        return result
    data = {
        key: clean(value) if not isinstance(value, str) or value != "nan" else ""
        for key, value in result["data"].items()
    }
    return {
        "status": "success",
        "data": {
            "id": str(data.get("Employee ID", emp_id)),
            "name": str(data.get("Name", "")),
            "nic": str(data.get("NIC", "")),
            "department": str(data.get("Department", "")),
            "address": str(data.get("addreess", "")),
            "bankName": str(data.get("Bank Name", "")),
            "accountNumber": str(data.get("AC number", "")),
        },
    }


def files_for(voucher_id):
    output_dir = os.path.join(os.path.dirname(os.path.abspath(backend.DB_PATH)), "Output")
    if not os.path.isdir(output_dir):
        return []
    return sorted(name for name in os.listdir(output_dir) if f"_{voucher_id}." in name)


def list_vouchers(limit=25):
    df = pd.read_excel(backend.DB_PATH, sheet_name="Vouchers")
    rows = []
    for row in reversed(df.to_dict("records")):
        voucher_id = str(clean(row.get("Voucher ID")))
        rows.append({
            "voucherId": voucher_id,
            "employeeId": str(clean(row.get("Employee ID"))),
            "amount": clean(row.get("Amount")),
            "date": str(clean(row.get("Date")))[:10],
            "status": str(clean(row.get("Status"))),
            "mainBudget": str(clean(row.get("Main Budget Code"))),
            "subBudget": str(clean(row.get("Sub Budget Code"))),
            "paymentMethod": str(clean(row.get("Payment Method"))),
            "preparedBy": str(clean(row.get("Prepared By"))),
            "files": files_for(voucher_id),
        })
        if len(rows) >= limit:
            break
    return {"status": "success", "data": rows}


def process_transaction(body):
    required = ["employeeId", "amount", "description"]
    missing = [key for key in required if not str(body.get(key, "")).strip()]
    if missing:
        return {
            "status": "error",
            "message": "Missing required fields: " + ", ".join(missing),
        }

    result = backend.process_transaction(
        str(body["employeeId"]).strip(),
        str(body.get("mainBudget", "")),
        str(body.get("subBudget", "")),
        str(body["amount"]),
        str(body["description"]).strip(),
        str(body.get("paymentMethod", "")),
        str(body.get("preparedBy", "")).strip(),
    )
    if result.get("status") == "success":
        result["files"] = files_for(result["voucher_id"])
    return result


def handle(request):
    action = request.get("action")
    payload = request.get("payload") or {}
    if action == "budgets":
        return backend.get_budgets()
    if action == "balance":
        return backend.get_balance(str(payload.get("budgetCode", payload.get("subBudgetCode", ""))))
    if action == "employees":
        return list_employees()
    if action == "employee":
        return employee_details(str(payload.get("employeeId", "")))
    if action == "vouchers":
        return list_vouchers()
    if action == "process":
        error = backend.budget_loader.ensure_current()
        if error:
            return error
        return process_transaction(payload)
    return {"status": "error", "message": "Unknown desktop action"}


if __name__ == "__main__":
    try:
        result = handle(json.loads(sys.stdin.read() or "{}"))
        print(json.dumps(result, default=str))
    except Exception as error:
        print(json.dumps({"status": "error", "message": str(error)}))
        sys.exit(1)
