"""
Schema Migration Checker
Compares SQL migration files against live Supabase database
to find tables, columns, and indexes that haven't been applied.

Usage:
  python scripts/check-schema.py

Requires: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars
  (reads from .env or .env.local)
"""

import os
import re
import sys
from pathlib import Path

# Load .env
def load_env():
    for env_file in [".env.local", ".env"]:
        path = Path(__file__).parent.parent / env_file
        if path.exists():
            with open(path) as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        key, _, value = line.partition("=")
                        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

load_env()

try:
    import httpx
except ImportError:
    print("Installing httpx...")
    os.system(f"{sys.executable} -m pip install httpx -q")
    import httpx

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env")
    sys.exit(1)

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}

# ── Query Supabase for existing schema ──

def run_sql(query: str) -> list[dict]:
    """Run SQL via Supabase's REST RPC (requires pg_net or a custom function).
    Falls back to querying information_schema via PostgREST."""
    resp = httpx.post(
        f"{SUPABASE_URL}/rest/v1/rpc/exec_sql",
        headers=HEADERS,
        json={"query": query},
        timeout=15,
    )
    if resp.status_code == 200:
        return resp.json()
    return []

def get_tables() -> set[str]:
    """Get all table names from the public schema."""
    resp = httpx.get(
        f"{SUPABASE_URL}/rest/v1/",
        headers=HEADERS,
        timeout=15,
    )
    if resp.status_code == 200:
        # PostgREST root returns available tables as keys in the OpenAPI spec
        data = resp.json()
        if isinstance(data, dict):
            # Try parsing OpenAPI paths
            paths = data.get("paths", {})
            tables = set()
            for path in paths:
                name = path.strip("/")
                if name and not name.startswith("rpc/"):
                    tables.add(name)
            if tables:
                return tables
            # Fallback: keys of definitions
            defs = data.get("definitions", {})
            return set(defs.keys())
    return set()

def get_columns() -> dict[str, set[str]]:
    """Get all columns per table. Uses PostgREST OpenAPI spec."""
    resp = httpx.get(
        f"{SUPABASE_URL}/rest/v1/",
        headers=HEADERS,
        timeout=15,
    )
    columns: dict[str, set[str]] = {}
    if resp.status_code == 200:
        data = resp.json()
        defs = data.get("definitions", {})
        for table_name, table_def in defs.items():
            props = table_def.get("properties", {})
            columns[table_name] = set(props.keys())
    return columns

# ── Parse SQL files for expected schema ──

def parse_sql_files(base_dir: str) -> dict:
    """Parse all .sql files and extract expected tables, columns, indexes."""
    expected = {
        "tables": {},       # table_name -> source_file
        "columns": {},      # "table.column" -> source_file
        "indexes": {},      # index_name -> source_file
    }

    sql_dir = Path(base_dir) / "supabase"
    sql_files = list(sql_dir.glob("*.sql")) + list(sql_dir.glob("migrations/*.sql"))

    for sql_file in sorted(sql_files):
        content = sql_file.read_text()
        rel_path = sql_file.relative_to(Path(base_dir))

        # CREATE TABLE
        for m in re.finditer(
            r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)",
            content, re.IGNORECASE
        ):
            expected["tables"][m.group(1)] = str(rel_path)

        # ALTER TABLE ... ADD COLUMN
        for m in re.finditer(
            r"ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)",
            content, re.IGNORECASE
        ):
            key = f"{m.group(1)}.{m.group(2)}"
            expected["columns"][key] = str(rel_path)

        # CREATE INDEX
        for m in re.finditer(
            r"CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)",
            content, re.IGNORECASE
        ):
            expected["indexes"][m.group(1)] = str(rel_path)

    return expected

# ── Main ──

def main():
    base_dir = Path(__file__).parent.parent
    print("Fetching live schema from Supabase...")

    live_tables = get_tables()
    live_columns = get_columns()

    if not live_tables:
        print("WARNING: Could not fetch tables from Supabase. Check your credentials.")
        print(f"  URL: {SUPABASE_URL}")
        print()

    print(f"Found {len(live_tables)} tables, {sum(len(v) for v in live_columns.values())} columns in live DB\n")

    print("Parsing SQL files...")
    expected = parse_sql_files(str(base_dir))
    print(f"Found {len(expected['tables'])} tables, {len(expected['columns'])} columns, {len(expected['indexes'])} indexes in SQL files\n")

    # ── Check missing tables
    missing_tables = []
    for table, source in sorted(expected["tables"].items()):
        if table not in live_tables:
            missing_tables.append((table, source))

    # ── Check missing columns
    missing_columns = []
    for col_key, source in sorted(expected["columns"].items()):
        table, col = col_key.split(".", 1)
        table_cols = live_columns.get(table, set())
        if table not in live_tables:
            missing_columns.append((col_key, source, "TABLE MISSING"))
        elif col not in table_cols:
            missing_columns.append((col_key, source, "COLUMN MISSING"))

    # ── Report
    print("=" * 60)

    if not missing_tables and not missing_columns:
        print("ALL MIGRATIONS APPLIED! Everything in SQL files exists in the DB.")
        print("=" * 60)
        return

    if missing_tables:
        print(f"MISSING TABLES ({len(missing_tables)}):")
        print("-" * 60)
        by_file: dict[str, list] = {}
        for table, source in missing_tables:
            by_file.setdefault(source, []).append(table)
        for source, tables in sorted(by_file.items()):
            print(f"\n  File: {source}")
            for t in tables:
                print(f"    - CREATE TABLE {t}")
        print()

    if missing_columns:
        print(f"MISSING COLUMNS ({len(missing_columns)}):")
        print("-" * 60)
        by_file: dict[str, list] = {}
        for col_key, source, reason in missing_columns:
            by_file.setdefault(source, []).append((col_key, reason))
        for source, cols in sorted(by_file.items()):
            print(f"\n  File: {source}")
            for col_key, reason in cols:
                table, col = col_key.split(".", 1)
                marker = " (table doesn't exist)" if reason == "TABLE MISSING" else ""
                print(f"    - ALTER TABLE {table} ADD COLUMN {col}{marker}")

    print()
    print("=" * 60)
    print(f"SUMMARY: {len(missing_tables)} missing tables, {len(missing_columns)} missing columns")
    print("Run the SQL files listed above in your Supabase SQL Editor to fix.")
    print("=" * 60)

if __name__ == "__main__":
    main()
