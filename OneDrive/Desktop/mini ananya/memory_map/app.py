"""Memory Map - a location-based digital memory preservation system.

Plain Flask + sqlite3 (no ORM, no extra libraries).
Run with:  python app.py
"""
import os
import sqlite3
import uuid
from datetime import date, datetime, timedelta
from functools import wraps

from flask import (Flask, g, jsonify, redirect, render_template, request,
                   session, url_for, flash)
from werkzeug.security import check_password_hash, generate_password_hash

BASE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE, "memorymap.db")
UPLOAD_DIR = os.path.join(BASE, "static", "uploads")
ALLOWED_EXT = {"png", "jpg", "jpeg", "gif", "webp"}

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024  # 20 MB per request
app.secret_key = os.environ.get("SECRET_KEY", "change-this-before-real-use")

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    date TEXT NOT NULL,
    place TEXT DEFAULT '',
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    mood TEXT DEFAULT '',
    category TEXT DEFAULT '',
    tags TEXT DEFAULT '',
    favorite INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    filename TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS journeys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS journey_memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    journey_id INTEGER NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
    memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL
);
"""


# ---------------------------------------------------------------- database
def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    db = sqlite3.connect(DB_PATH)
    db.executescript(SCHEMA)
    cols = [r[1] for r in db.execute("PRAGMA table_info(memories)")]
    if "favorite" not in cols:  # upgrade a database made by the first version
        db.execute("ALTER TABLE memories ADD COLUMN favorite INTEGER DEFAULT 0")
    db.commit()
    db.close()


# ----------------------------------------------------------------- helpers
def login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        # also reject a leftover cookie whose user no longer exists in the database
        user_ok = "user_id" in session and get_db().execute(
            "SELECT 1 FROM users WHERE id = ?", (session["user_id"],)).fetchone()
        if not user_ok:
            session.clear()
            if request.path.startswith("/api/"):
                return jsonify(error="Please log in again."), 401
            return redirect(url_for("login"))
        return view(*args, **kwargs)
    return wrapper


def allowed_file(name):
    return "." in name and name.rsplit(".", 1)[1].lower() in ALLOWED_EXT


def save_photos(memory_id, files):
    db = get_db()
    for f in files:
        if not f or not f.filename or not allowed_file(f.filename):
            continue
        ext = f.filename.rsplit(".", 1)[1].lower()
        name = uuid.uuid4().hex + "." + ext
        f.save(os.path.join(UPLOAD_DIR, name))
        db.execute("INSERT INTO photos (memory_id, filename) VALUES (?, ?)",
                   (memory_id, name))


def memory_to_dict(row):
    photos = get_db().execute(
        "SELECT id, filename FROM photos WHERE memory_id = ?", (row["id"],)
    ).fetchall()
    d = dict(row)
    d["photos"] = [{"id": p["id"], "url": url_for("static", filename="uploads/" + p["filename"])}
                   for p in photos]
    return d


def read_memory_form(form):
    """Validate form data. Returns (values, error)."""
    title = form.get("title", "").strip()
    when = form.get("date", "").strip()
    if not title:
        return None, "Title is required."
    try:
        datetime.strptime(when, "%Y-%m-%d")
    except ValueError:
        return None, "Enter a valid date."
    try:
        lat = float(form.get("latitude", ""))
        lng = float(form.get("longitude", ""))
    except ValueError:
        return None, "Pick a location on the map first."
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return None, "Location is out of range."
    tags = ",".join(t.strip().lower() for t in form.get("tags", "").split(",") if t.strip())
    return {
        "title": title, "description": form.get("description", "").strip(),
        "date": when, "place": form.get("place", "").strip(),
        "latitude": lat, "longitude": lng,
        "mood": form.get("mood", "").strip(), "category": form.get("category", "").strip(),
        "tags": tags,
    }, None


def own_memory(memory_id):
    return get_db().execute(
        "SELECT * FROM memories WHERE id = ? AND user_id = ?",
        (memory_id, session["user_id"])).fetchone()


# ------------------------------------------------------------ auth + pages
@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        name = request.form.get("name", "").strip()
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        if not name or "@" not in email or len(password) < 6:
            flash("Enter your name, a valid email and a password of 6+ characters.")
        else:
            db = get_db()
            if db.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
                flash("That email is already registered. Log in instead.")
            else:
                db.execute("INSERT INTO users (name, email, password) VALUES (?, ?, ?)",
                           (name, email, generate_password_hash(password)))
                db.commit()
                flash("Account created. You can log in now.")
                return redirect(url_for("login"))
    return render_template("register.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        user = get_db().execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        if user and check_password_hash(user["password"], request.form.get("password", "")):
            session.clear()
            session["user_id"] = user["id"]
            session["user_name"] = user["name"]
            return redirect(url_for("index"))
        flash("Invalid email or password.")
    return render_template("login.html")


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/")
@login_required
def index():
    return render_template("index.html")


@app.route("/timeline")
@login_required
def timeline():
    return render_template("timeline.html")


@app.route("/journeys")
@login_required
def journeys_page():
    return render_template("journeys.html")


@app.route("/stats")
@login_required
def stats_page():
    return render_template("stats.html")


# --------------------------------------------------------------- memory API
@app.route("/api/memories", methods=["GET"])
@login_required
def list_memories():
    sql = "SELECT * FROM memories WHERE user_id = ?"
    args = [session["user_id"]]
    q = request.args
    if q.get("q"):
        sql += " AND (title LIKE ? OR description LIKE ?)"
        args += ["%" + q["q"] + "%"] * 2
    if q.get("place"):
        sql += " AND place LIKE ?"
        args.append("%" + q["place"] + "%")
    if q.get("year"):
        sql += " AND strftime('%Y', date) = ?"
        args.append(q["year"])
    if q.get("date"):
        sql += " AND date = ?"
        args.append(q["date"])
    if q.get("category"):
        sql += " AND category = ?"
        args.append(q["category"])
    if q.get("mood"):
        sql += " AND mood = ?"
        args.append(q["mood"])
    if q.get("favorite"):
        sql += " AND favorite = 1"
    if q.get("tag"):
        sql += " AND ',' || tags || ',' LIKE ?"
        args.append("%," + q["tag"].strip().lower() + ",%")
    sql += " ORDER BY date DESC, id DESC"
    rows = get_db().execute(sql, args).fetchall()
    return jsonify([memory_to_dict(r) for r in rows])


@app.route("/api/memories", methods=["POST"])
@login_required
def create_memory():
    values, error = read_memory_form(request.form)
    if error:
        return jsonify(error=error), 400
    db = get_db()
    cur = db.execute(
        """INSERT INTO memories (user_id, title, description, date, place, latitude,
           longitude, mood, category, tags) VALUES (?,?,?,?,?,?,?,?,?,?)""",
        (session["user_id"], values["title"], values["description"], values["date"],
         values["place"], values["latitude"], values["longitude"], values["mood"],
         values["category"], values["tags"]))
    save_photos(cur.lastrowid, request.files.getlist("photos"))
    db.commit()
    return jsonify(id=cur.lastrowid), 201


@app.route("/api/memories/<int:memory_id>", methods=["POST"])
@login_required
def update_memory(memory_id):
    if not own_memory(memory_id):
        return jsonify(error="Memory not found."), 404
    values, error = read_memory_form(request.form)
    if error:
        return jsonify(error=error), 400
    db = get_db()
    db.execute(
        """UPDATE memories SET title=?, description=?, date=?, place=?, latitude=?,
           longitude=?, mood=?, category=?, tags=? WHERE id=? AND user_id=?""",
        (values["title"], values["description"], values["date"], values["place"],
         values["latitude"], values["longitude"], values["mood"], values["category"],
         values["tags"], memory_id, session["user_id"]))
    save_photos(memory_id, request.files.getlist("photos"))
    db.commit()
    return jsonify(ok=True)


@app.route("/api/memories/<int:memory_id>", methods=["DELETE"])
@login_required
def delete_memory(memory_id):
    if not own_memory(memory_id):
        return jsonify(error="Memory not found."), 404
    db = get_db()
    for p in db.execute("SELECT filename FROM photos WHERE memory_id = ?", (memory_id,)):
        path = os.path.join(UPLOAD_DIR, p["filename"])
        if os.path.exists(path):
            os.remove(path)
    db.execute("DELETE FROM memories WHERE id = ?", (memory_id,))
    db.commit()
    return jsonify(ok=True)


@app.route("/api/memories/<int:memory_id>/favorite", methods=["POST"])
@login_required
def toggle_favorite(memory_id):
    m = own_memory(memory_id)
    if not m:
        return jsonify(error="Memory not found."), 404
    new_value = 0 if m["favorite"] else 1
    db = get_db()
    db.execute("UPDATE memories SET favorite = ? WHERE id = ?", (new_value, memory_id))
    db.commit()
    return jsonify(favorite=new_value)


@app.route("/api/photos/<int:photo_id>", methods=["DELETE"])
@login_required
def delete_photo(photo_id):
    db = get_db()
    p = db.execute(
        """SELECT photos.* FROM photos JOIN memories ON memories.id = photos.memory_id
           WHERE photos.id = ? AND memories.user_id = ?""",
        (photo_id, session["user_id"])).fetchone()
    if not p:
        return jsonify(error="Photo not found."), 404
    path = os.path.join(UPLOAD_DIR, p["filename"])
    if os.path.exists(path):
        os.remove(path)
    db.execute("DELETE FROM photos WHERE id = ?", (photo_id,))
    db.commit()
    return jsonify(ok=True)


@app.route("/api/onthisday")
@login_required
def on_this_day():
    today = date.today()
    rows = get_db().execute(
        """SELECT * FROM memories WHERE user_id = ?
           AND strftime('%m-%d', date) = ? AND strftime('%Y', date) < ?
           ORDER BY date DESC""",
        (session["user_id"], today.strftime("%m-%d"), str(today.year))).fetchall()
    return jsonify([memory_to_dict(r) for r in rows])


# ------------------------------------------------------------- journeys API
def journey_to_dict(row):
    mems = get_db().execute(
        """SELECT memories.id, memories.title, memories.date, memories.latitude,
                  memories.longitude, journey_memories.sequence
           FROM journey_memories JOIN memories ON memories.id = journey_memories.memory_id
           WHERE journey_memories.journey_id = ? ORDER BY journey_memories.sequence""",
        (row["id"],)).fetchall()
    d = dict(row)
    d["memories"] = [dict(m) for m in mems]
    return d


@app.route("/api/journeys", methods=["GET"])
@login_required
def list_journeys():
    rows = get_db().execute(
        "SELECT * FROM journeys WHERE user_id = ? ORDER BY id DESC",
        (session["user_id"],)).fetchall()
    return jsonify([journey_to_dict(r) for r in rows])


@app.route("/api/journeys", methods=["POST"])
@login_required
def create_journey():
    data = request.get_json(silent=True) or {}
    name = str(data.get("name", "")).strip()
    ids = data.get("memory_ids", [])
    if not name:
        return jsonify(error="Give the journey a name."), 400
    if not isinstance(ids, list) or len(ids) < 2:
        return jsonify(error="Choose at least two memories."), 400
    db = get_db()
    for mid in ids:  # every memory must belong to this user
        if not isinstance(mid, int) or not own_memory(mid):
            return jsonify(error="Invalid memory selected."), 400
    cur = db.execute("INSERT INTO journeys (user_id, name, description) VALUES (?,?,?)",
                     (session["user_id"], name, str(data.get("description", "")).strip()))
    for seq, mid in enumerate(ids, start=1):
        db.execute("INSERT INTO journey_memories (journey_id, memory_id, sequence) VALUES (?,?,?)",
                   (cur.lastrowid, mid, seq))
    db.commit()
    return jsonify(id=cur.lastrowid), 201


@app.route("/api/journeys/<int:journey_id>", methods=["DELETE"])
@login_required
def delete_journey(journey_id):
    db = get_db()
    cur = db.execute("DELETE FROM journeys WHERE id = ? AND user_id = ?",
                     (journey_id, session["user_id"]))
    db.commit()
    if cur.rowcount == 0:
        return jsonify(error="Journey not found."), 404
    return jsonify(ok=True)


# ------------------------------------------------------- account + export
@app.route("/account", methods=["GET", "POST"])
@login_required
def account():
    if request.method == "POST":
        db = get_db()
        user = db.execute("SELECT * FROM users WHERE id = ?", (session["user_id"],)).fetchone()
        new = request.form.get("new_password", "")
        if not check_password_hash(user["password"], request.form.get("old_password", "")):
            flash("Your current password is not correct.")
        elif len(new) < 6:
            flash("The new password needs at least 6 characters.")
        else:
            db.execute("UPDATE users SET password = ? WHERE id = ?",
                       (generate_password_hash(new), user["id"]))
            db.commit()
            flash("Password changed.")
    return render_template("account.html")


@app.route("/api/export")
@login_required
def export_data():
    db = get_db()
    rows = db.execute("SELECT * FROM memories WHERE user_id = ? ORDER BY date",
                      (session["user_id"],)).fetchall()
    journeys = db.execute("SELECT * FROM journeys WHERE user_id = ?",
                          (session["user_id"],)).fetchall()
    resp = jsonify(user=session["user_name"], exported_on=date.today().isoformat(),
                   memories=[memory_to_dict(r) for r in rows],
                   journeys=[journey_to_dict(j) for j in journeys])
    resp.headers["Content-Disposition"] = "attachment; filename=memory_map_export.json"
    return resp


# ----------------------------------------------------------------- stats API
@app.route("/api/stats")
@login_required
def stats():
    db = get_db()
    uid = session["user_id"]

    def group(sql):
        return [dict(r) for r in db.execute(sql, (uid,)).fetchall()]

    one = lambda sql: db.execute(sql, (uid,)).fetchone()[0]

    # day streak: consecutive days (ending today or yesterday) that have a memory
    days = {r[0] for r in db.execute("SELECT DISTINCT date FROM memories WHERE user_id = ?", (uid,))}
    day = date.today()
    if day.isoformat() not in days:
        day -= timedelta(days=1)
    streak = 0
    while day.isoformat() in days:
        streak += 1
        day -= timedelta(days=1)
    return jsonify(
        total_memories=one("SELECT COUNT(*) FROM memories WHERE user_id = ?"),
        total_locations=one("SELECT COUNT(DISTINCT round(latitude,3) || ',' || round(longitude,3)) FROM memories WHERE user_id = ?"),
        total_photos=one("SELECT COUNT(*) FROM photos JOIN memories ON memories.id = photos.memory_id WHERE memories.user_id = ?"),
        total_journeys=one("SELECT COUNT(*) FROM journeys WHERE user_id = ?"),
        streak=streak,
        favorites=one("SELECT COUNT(*) FROM memories WHERE user_id = ? AND favorite = 1"),
        this_month=one("SELECT COUNT(*) FROM memories WHERE user_id = ? AND strftime('%Y-%m', date) = strftime('%Y-%m', 'now')"),
        by_year=group("SELECT strftime('%Y', date) AS label, COUNT(*) AS count FROM memories WHERE user_id = ? GROUP BY label ORDER BY label"),
        by_category=group("SELECT category AS label, COUNT(*) AS count FROM memories WHERE user_id = ? AND category != '' GROUP BY category ORDER BY count DESC"),
        by_mood=group("SELECT mood AS label, COUNT(*) AS count FROM memories WHERE user_id = ? AND mood != '' GROUP BY mood ORDER BY count DESC"),
        top_places=group("SELECT place AS label, COUNT(*) AS count FROM memories WHERE user_id = ? AND place != '' GROUP BY place ORDER BY count DESC LIMIT 5"),
    )


init_db()

if __name__ == "__main__":
    app.run(debug=True)
