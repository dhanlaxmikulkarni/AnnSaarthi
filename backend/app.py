"""AnnSaarthi Flask REST API (SQLite via database.py)."""
from flask import Flask, jsonify, request
import database as db
from quality_gemini import quality_bp

app = Flask(__name__)
db.init_db()
app.register_blueprint(quality_bp)

@app.after_request
def cors(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    resp.headers["Access-Control-Allow-Methods"] = "GET,POST,PUT,DELETE,OPTIONS"
    return resp

@app.route("/api/<path:_p>", methods=["OPTIONS"])
def options(_p):
    return ("", 204)

@app.get("/api/health")
def health():
    return jsonify(ok=True, seeded=not db.is_empty())

# Whole portal state (farmers, bookings, tokens, quality, weighing, payments, receipts, notifications, config...)
@app.get("/api/state")
def get_state():
    return jsonify(db.load_state())

@app.route("/api/state", methods=["POST", "PUT"])
def put_state():
    payload = request.get_json(force=True, silent=True)
    if not payload or "db" not in payload:
        return jsonify(error="invalid payload"), 400
    db.save_state(payload)
    return jsonify(ok=True)
@app.post("/api/demo/reset")
def reset_demo_data():
    try:
        db.reset()
        return jsonify(
            ok=True,
            message="Demo data has been restored successfully."
        )
    except Exception as e:
        print("Demo reset error:", repr(e))
        return jsonify(
            ok=False,
            error="Could not restore demo data.",
            details=str(e)
        ), 500

@app.get("/api/config")
def get_config():
    return jsonify(db.load_state().get("cfg", {}))

@app.put("/api/config")
def put_config():
    cfg = request.get_json(force=True, silent=True) or {}
    state = db.load_state()
    if not state:
        return jsonify(error="no state yet"), 409
    state["cfg"].update(cfg)
    db.save_state(state)
    return jsonify(state["cfg"])

# Read-only record endpoints
@app.get("/api/farmers")
def farmers():
    return jsonify(db.rows("SELECT farmer_id, application_id, full_name, mobile, village, district, registration_status, stage FROM farmers ORDER BY pos"))

@app.get("/api/bookings")
def bookings():
    return jsonify(db.rows("SELECT booking_id, procurement_id, farmer_id, commodity_id, centre_id, date, start_hour, status FROM bookings ORDER BY pos"))

@app.get("/api/tokens")
def tokens():
    return jsonify(db.rows("SELECT token, main_token_id, booking_id, farmer_id, centre_id, date, seq, status, stage FROM tokens ORDER BY pos"))

@app.get("/api/quality")
def quality():
    return jsonify(db.rows("SELECT token, farmer_id, batch_id, assessment_status, quality_grade, quality_token, report_id FROM quality_records"))

@app.get("/api/weighing")
def weighing():
    return jsonify(db.rows("SELECT * FROM weighing_records"))

@app.get("/api/payments")
def payments():
    return jsonify(db.rows("SELECT * FROM payments"))

@app.get("/api/receipts")
def receipts():
    return jsonify(db.rows("SELECT * FROM receipts"))

@app.get("/api/receipts/<receipt_no>")
def receipt(receipt_no):
    r = db.rows("SELECT * FROM receipts WHERE receipt_no=?", (receipt_no,))
    return (jsonify(r[0]) if r else (jsonify(error="not found"), 404))

@app.get("/api/notifications")
def notifications():
    q, args = "SELECT id, farmer_id, title, body, at, is_read FROM notifications", ()
    if request.args.get("farmerId"):
        q += " WHERE farmer_id=?"; args = (request.args["farmerId"],)
    return jsonify(db.rows(q + " ORDER BY pos", args))

@app.get("/api/centres")
def centres():
    return jsonify(db.rows("SELECT id, code, name, district FROM centres ORDER BY pos"))

@app.get("/api/commodities")
def commodities():
    return jsonify(db.rows("SELECT id, name, status, msp, unit FROM commodities ORDER BY pos"))

if __name__ == "__main__":
    app.run(debug=True, port=5000)
