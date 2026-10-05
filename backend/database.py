"""SQLite layer for AnnSaarthi. The browser never touches the database; only Flask does."""
import json
import os
import sqlite3
import sys

DB_PATH = os.environ.get(
    "ANNSAARTHI_DB",
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data", "ann_saarthi.db")),
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS commodities (pos INTEGER, id TEXT PRIMARY KEY, name TEXT, status TEXT, msp REAL, unit TEXT, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS centres (pos INTEGER, id TEXT PRIMARY KEY, code TEXT, name TEXT, district TEXT, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS schedules (pos INTEGER, id TEXT PRIMARY KEY, centre_id TEXT, commodity_id TEXT, start_date TEXT, end_date TEXT, status TEXT, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS slots (slot_key TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS farmers (pos INTEGER, farmer_key TEXT PRIMARY KEY, farmer_id TEXT, application_id TEXT, full_name TEXT, mobile TEXT, village TEXT, district TEXT, registration_status TEXT, stage TEXT, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS applications (pos INTEGER, application_id TEXT PRIMARY KEY, mobile TEXT, status TEXT, submitted_at TEXT, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bookings (pos INTEGER, booking_id TEXT PRIMARY KEY, procurement_id TEXT, farmer_id TEXT, commodity_id TEXT, centre_id TEXT, date TEXT, start_hour REAL, status TEXT, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tokens (pos INTEGER, main_token_id TEXT PRIMARY KEY, booking_id TEXT, token TEXT, farmer_id TEXT, centre_id TEXT, date TEXT, seq INTEGER, status TEXT, stage TEXT, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS quality_records (token TEXT PRIMARY KEY, farmer_id TEXT, batch_id TEXT, assessment_status TEXT, quality_grade TEXT, quality_token TEXT, report_id TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS weighing_records (token TEXT PRIMARY KEY, farmer_id TEXT, weight_qtl REAL, rate_per_qtl REAL, amount REAL, deductions REAL);
CREATE TABLE IF NOT EXISTS payments (token TEXT PRIMARY KEY, farmer_id TEXT, payment_status TEXT, payment_ref TEXT, amount REAL);
CREATE TABLE IF NOT EXISTS receipts (receipt_no TEXT PRIMARY KEY, token TEXT, farmer_id TEXT, amount REAL, completed_at TEXT);
CREATE TABLE IF NOT EXISTS notifications (pos INTEGER, id TEXT PRIMARY KEY, farmer_id TEXT, title TEXT, body TEXT, at TEXT, is_read INTEGER, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (pos INTEGER PRIMARY KEY, at TEXT, text TEXT);
CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER);
CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""

# DB key -> (table, pk column, id function, extra column extractor)
def _j(o):
    return json.dumps(o, ensure_ascii=False)

def connect():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)   # idempotent; also recreates tables if the file was deleted
    return conn

def init_db():
    with connect() as c:
        c.executescript(SCHEMA)

def is_empty():
    with connect() as c:
        return c.execute("SELECT COUNT(*) FROM centres").fetchone()[0] == 0

LISTS = {
    "commodities": ("commodities", ["pos", "id", "name", "status", "msp", "unit", "data"],
                    lambda o, i: [i, o.get("id"), o.get("name"), o.get("status"), o.get("msp"), o.get("unit")]),
    "centres": ("centres", ["pos", "id", "code", "name", "district", "data"],
                lambda o, i: [i, o.get("id"), o.get("code"), o.get("name"), o.get("district")]),
    "schedules": ("schedules", ["pos", "id", "centre_id", "commodity_id", "start_date", "end_date", "status", "data"],
                  lambda o, i: [i, o.get("id"), o.get("centreId"), o.get("commodityId"), o.get("startDate"), o.get("endDate"), o.get("status")]),
    "farmers": ("farmers", ["pos", "farmer_key", "farmer_id", "application_id", "full_name", "mobile", "village", "district", "registration_status", "stage", "data"],
                lambda o, i: [i, o.get("farmerId") or o.get("applicationId") or f"row-{i}", o.get("farmerId"), o.get("applicationId"),
                              o.get("fullName"), o.get("mobile"), o.get("village"), o.get("district"), o.get("registrationStatus"), o.get("stage")]),
    "applications": ("applications", ["pos", "application_id", "mobile", "status", "submitted_at", "data"],
                     lambda o, i: [i, o.get("applicationId") or f"row-{i}", o.get("mobile"), o.get("status"), o.get("submittedAt")]),
    "bookings": ("bookings", ["pos", "booking_id", "procurement_id", "farmer_id", "commodity_id", "centre_id", "date", "start_hour", "status", "data"],
                 lambda o, i: [i, o.get("bookingId"), o.get("procurementId"), o.get("farmerId"), o.get("commodityId"), o.get("centreId"),
                               o.get("date"), o.get("startHour"), o.get("bookingStatus")]),
    "tokens": ("tokens", ["pos", "main_token_id", "booking_id", "token", "farmer_id", "centre_id", "date", "seq", "status", "stage", "data"],
               lambda o, i: [i, o.get("mainTokenId") or f"row-{i}", o.get("bookingId"), o.get("token"), o.get("farmerId"), o.get("centreId"),
                             o.get("date"), o.get("seq"), o.get("status"), o.get("stage")]),
    "notifications": ("notifications", ["pos", "id", "farmer_id", "title", "body", "at", "is_read", "data"],
                      lambda o, i: [i, o.get("id") or f"row-{i}", o.get("farmerId"), o.get("title"), o.get("body"), o.get("at"), 1 if o.get("read") else 0]),
}
KNOWN = set(LISTS) | {"slots", "events", "seq"}

def save_state(payload):
    db = payload.get("db") or {}
    cfg = payload.get("cfg") or {}
    with connect() as c:
        for t in ["commodities", "centres", "schedules", "slots", "farmers", "applications", "bookings", "tokens",
                  "quality_records", "weighing_records", "payments", "receipts", "notifications", "events", "counters", "config"]:
            c.execute(f"DELETE FROM {t}")
        for key, (table, cols, fn) in LISTS.items():
            ph = ",".join("?" * len(cols))
            for i, o in enumerate(db.get(key) or []):
                c.execute(f"INSERT OR REPLACE INTO {table} ({','.join(cols)}) VALUES ({ph})", fn(o, i) + [_j(o)])
        for k, v in (db.get("slots") or {}).items():
            c.execute("INSERT OR REPLACE INTO slots VALUES (?,?)", (k, _j(v)))
        for i, e in enumerate(db.get("events") or []):
            c.execute("INSERT OR REPLACE INTO events VALUES (?,?,?)", (i, e.get("at"), e.get("text")))
        for k, v in (db.get("seq") or {}).items():
            c.execute("INSERT OR REPLACE INTO counters VALUES (?,?)", (k, v))
        for k, v in cfg.items():
            c.execute("INSERT OR REPLACE INTO config VALUES (?,?)", ("cfg:" + k, _j(v)))
        for k, v in db.items():            # any other top-level DB key is preserved as-is
            if k not in KNOWN:
                c.execute("INSERT OR REPLACE INTO config VALUES (?,?)", ("db:" + k, _j(v)))
        # query-friendly records derived from each token (quality / weighing / payment / receipt)
        for t in db.get("tokens") or []:
            tk, fid = t.get("token"), t.get("farmerId")
            oq = t.get("oq") or {}
            if t.get("qualityGrade") or oq:
                c.execute("INSERT OR REPLACE INTO quality_records VALUES (?,?,?,?,?,?,?,?)",
                          (tk, fid, oq.get("batchId"), oq.get("status"), t.get("qualityGrade"), t.get("qualityToken"), oq.get("reportId"), _j(oq) if oq else None))
            if t.get("weightQtl") is not None:
                c.execute("INSERT OR REPLACE INTO weighing_records VALUES (?,?,?,?,?,?)",
                          (tk, fid, t.get("weightQtl"), t.get("ratePerQtl"), t.get("amount"), t.get("deductions")))
            if t.get("paymentStatus") and t.get("paymentStatus") != "NOT_STARTED":
                c.execute("INSERT OR REPLACE INTO payments VALUES (?,?,?,?,?)",
                          (tk, fid, t.get("paymentStatus"), t.get("paymentRef"), t.get("amount")))
            if t.get("receiptNo"):
                c.execute("INSERT OR REPLACE INTO receipts VALUES (?,?,?,?,?)",
                          (t.get("receiptNo"), tk, fid, t.get("amount"), t.get("completedAt")))
    return True

def load_state():
    with connect() as c:
        if c.execute("SELECT COUNT(*) FROM counters").fetchone()[0] == 0:
            return {}
        db = {}
        for key, (table, _cols, _fn) in LISTS.items():
            db[key] = [json.loads(r["data"]) for r in c.execute(f"SELECT data FROM {table} ORDER BY pos")]
        db["slots"] = {r["slot_key"]: json.loads(r["data"]) for r in c.execute("SELECT * FROM slots")}
        db["events"] = [{"at": r["at"], "text": r["text"]} for r in c.execute("SELECT * FROM events ORDER BY pos")]
        db["seq"] = {r["name"]: r["value"] for r in c.execute("SELECT * FROM counters")}
        cfg = {}
        for r in c.execute("SELECT * FROM config"):
            kind, _, k = r["key"].partition(":")
            if kind == "cfg":
                cfg[k] = json.loads(r["value"])
            else:
                db[k] = json.loads(r["value"])
        return {"db": db, "cfg": cfg}

def rows(sql, args=()):
    with connect() as c:
        return [dict(r) for r in c.execute(sql, args)]

def reset():
    with connect() as c:
        c.executescript("DROP TABLE IF EXISTS commodities;DROP TABLE IF EXISTS centres;DROP TABLE IF EXISTS schedules;DROP TABLE IF EXISTS slots;"
                        "DROP TABLE IF EXISTS farmers;DROP TABLE IF EXISTS applications;DROP TABLE IF EXISTS bookings;DROP TABLE IF EXISTS tokens;"
                        "DROP TABLE IF EXISTS quality_records;DROP TABLE IF EXISTS weighing_records;DROP TABLE IF EXISTS payments;"
                        "DROP TABLE IF EXISTS receipts;DROP TABLE IF EXISTS notifications;DROP TABLE IF EXISTS events;"
                        "DROP TABLE IF EXISTS counters;DROP TABLE IF EXISTS config;")
    init_db()

if __name__ == "__main__":
    if "--reset" in sys.argv:
        reset(); print("Database reset. Demo data is re-seeded on the next page load:", DB_PATH)
    else:
        init_db(); print("Database ready:", DB_PATH)
