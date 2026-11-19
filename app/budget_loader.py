"""Parse budget.csv into the budget catalog consumed by the desktop UI."""
import csv
import json
import os
import re
import tempfile
import threading
from decimal import Decimal, InvalidOperation


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BUDGET_CSV = os.path.join(BASE_DIR, "budget.csv")
BUDGETS_JSON = os.path.join(BASE_DIR, "budgets_extracted.json")
MAIN_CODES = ("B", "C", "D", "E")
LOADER_VERSION = "2"

_lock = threading.Lock()


def _number(value):
    return int(value) if value == value.to_integral_value() else float(value)


def normalize_code(value):
    code = re.sub(r"\s+", "", value.strip().upper()).replace(",", ".")
    if code == "C":
        return code
    match = re.fullmatch(r"([BCDE])\.?(\d+(?:\.\d+)*)", code)
    if not match:
        raise ValueError(f"unsupported budget code {value!r}")
    return match.group(1) + match.group(2)


def _is_total_row(name):
    normalized = " ".join(name.upper().replace("_", " ").split())
    return bool(re.match(r"^(?:(?:SUB|GRAND)\s+)?TOTAL\b", normalized))


def _parse_amount(amount_text, line_number):
    try:
        amount = Decimal(amount_text.replace(",", "").replace("Rs.", "").strip())
    except InvalidOperation as error:
        raise ValueError(f"line {line_number} has invalid amount {amount_text!r}") from error
    if not amount.is_finite() or amount < 0:
        raise ValueError(f"line {line_number} has an invalid negative or non-finite amount")
    return amount


def parse_budget_csv(path=None):
    csv_path = path or BUDGET_CSV
    with open(csv_path, encoding="utf-8-sig", newline="") as stream:
        rows = list(csv.reader(stream))

    amount_column = None
    header_index = None
    for index, row in enumerate(rows):
        for column, value in enumerate(row):
            normalized = " ".join(value.lower().split())
            if "estimated revenue" in normalized and "cost" in normalized:
                header_index = index
                amount_column = column
                break
        if header_index is not None:
            break
    if header_index is None:
        raise ValueError("the 'Estimated revenue / Cost' column was not found")

    main_rows = {}
    payable_rows = []
    seen_codes = set()
    contribution = None
    for line_number, row in enumerate(rows[header_index + 1:], start=header_index + 2):
        raw_code = row[0].strip() if row else ""
        name = row[1].strip() if len(row) > 1 else ""
        compact_code = re.sub(r"\s+", "", raw_code.upper())
        if not compact_code or re.match(r"^A(?:$|[.,\d])", compact_code):
            continue
        if _is_total_row(name):
            continue

        if compact_code in MAIN_CODES:
            if not name:
                raise ValueError(f"line {line_number} has no name for main code {compact_code}")
            if compact_code in main_rows:
                raise ValueError(f"line {line_number} repeats main budget code {compact_code}")
            main_rows[compact_code] = {"code": compact_code, "name": name}
            if compact_code != "C":
                continue
            if len(row) <= amount_column or not row[amount_column].strip():
                raise ValueError(f"line {line_number} has no allocation for main budget C")
            amount = _parse_amount(row[amount_column].strip(), line_number)
            if amount <= 0:
                raise ValueError(f"line {line_number} must give main budget C a positive allocation")
            contribution = (line_number, "C", name, amount)
            continue

        if len(row) <= amount_column:
            raise ValueError(f"line {line_number} is missing the amount column")
        amount_text = row[amount_column].strip()
        if not amount_text:
            continue
        amount = _parse_amount(amount_text, line_number)
        if amount == 0:
            continue
        if not name:
            raise ValueError(f"line {line_number} has an amount but no description")

        try:
            code = normalize_code(raw_code)
        except ValueError as error:
            raise ValueError(f"line {line_number}: {error}") from error
        if code == "C":
            raise ValueError(f"line {line_number} repeats main budget code C")
        if code[0] == "C":
            raise ValueError(f"line {line_number} gives C an unsupported child budget code {code}")
        if code in seen_codes:
            raise ValueError(f"line {line_number} repeats budget code {code}")
        seen_codes.add(code)
        payable_rows.append((line_number, code, name, amount))

    missing_main = [code for code in MAIN_CODES if code not in main_rows]
    if missing_main:
        raise ValueError("missing main budget codes: " + ", ".join(missing_main))
    if contribution is None:
        raise ValueError("main budget C must have a positive allocation")

    sub = {f"{code}. {main_rows[code]['name']}": [] for code in MAIN_CODES}
    for line_number, code, name, amount in payable_rows:
        parent = code[0]
        sub[f"{parent}. {main_rows[parent]['name']}"].append({
            "code": code,
            "name": name,
            "allocated": _number(amount),
        })

    _, code, name, amount = contribution
    sub[f"C. {main_rows['C']['name']}"].append({
        "code": code,
        "name": name,
        "allocated": _number(amount),
    })

    return {
        "main": [main_rows[code] for code in MAIN_CODES],
        "sub": sub,
    }


def _atomic_write(path, write):
    directory = os.path.dirname(path)
    os.makedirs(directory, exist_ok=True)
    descriptor, temporary_path = tempfile.mkstemp(prefix=".budget-", dir=directory)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="") as stream:
            write(stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_path, path)
    finally:
        if os.path.exists(temporary_path):
            os.unlink(temporary_path)


def ensure_current():
    csv_path = BUDGET_CSV
    json_path = BUDGETS_JSON
    mtime_path = json_path + ".source-mtime"
    with _lock:
        try:
            source_mtime = os.stat(csv_path).st_mtime_ns
            source_signature = f"{LOADER_VERSION}:{source_mtime}"
            if os.path.isfile(json_path) and os.path.isfile(mtime_path):
                with open(mtime_path, encoding="utf-8") as stream:
                    if stream.read().strip() == source_signature:
                        return None

            catalog = parse_budget_csv(csv_path)
        except (OSError, ValueError, csv.Error) as error:
            fallback_message = (
                "The last good budget catalog was kept."
                if os.path.isfile(json_path)
                else "No existing budget catalog is available."
            )
            return {
                "status": "error",
                "message": (
                    f"Could not load {os.path.basename(csv_path)}: {error}. "
                    f"{fallback_message}"
                ),
            }

        try:
            _atomic_write(
                json_path,
                lambda stream: json.dump(catalog, stream, indent=4, ensure_ascii=False),
            )
            _atomic_write(mtime_path, lambda stream: stream.write(source_signature))
        except OSError as error:
            return {
                "status": "error",
                "message": f"Could not save the refreshed budget catalog: {error}",
            }
    return None


def read_catalog():
    with open(BUDGETS_JSON, encoding="utf-8") as stream:
        return json.load(stream)
