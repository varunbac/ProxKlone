#!/usr/bin/env python3
"""SQLite-backed local server for the Favour adaptation of Proxyy."""
from contextlib import contextmanager
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
import hashlib
import hmac
import json
import os
import secrets
import sqlite3

ROOT = Path(__file__).resolve().parent
DATABASE = ROOT / "favour.sqlite3"
PORT = int(os.environ.get("PORT", "8766"))


@contextmanager
def database():
    connection = sqlite3.connect(DATABASE)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def hash_password(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 180000).hex()


def initialize_database():
    with database() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                department TEXT NOT NULL DEFAULT 'IIT Roorkee',
                coins INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS favours (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                creator_id INTEGER NOT NULL REFERENCES users(id),
                beneficiary_id INTEGER NOT NULL REFERENCES users(id),
                title TEXT NOT NULL,
                event_time TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','declined')),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                confirmed_at TEXT
            );
            CREATE TABLE IF NOT EXISTS ledger (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id),
                favour_id INTEGER REFERENCES favours(id),
                description TEXT NOT NULL,
                amount INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS reward_claims (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id),
                reward_key TEXT NOT NULL,
                claimed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, reward_key)
            );
        """)
        db.execute("UPDATE favours SET title='Favour' WHERE title!='Favour'")
        if db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0:
            demo_password = "campus2026"
            people = [
                ("Aanya Mehta", "aanya@iitr.ac.in", "Engineering · 2nd year", 7),
                ("Rohan Sharma", "rohan@iitr.ac.in", "Engineering · 2nd year", 18),
                ("Zoya Khan", "zoya@iitr.ac.in", "Design · 3rd year", 14),
                ("Kabir Sethi", "kabir@iitr.ac.in", "Architecture · 1st year", 11),
                ("Ishita Rao", "ishita@iitr.ac.in", "Biotech · 2nd year", 8),
            ]
            for name, email, department, coins in people:
                salt = secrets.token_hex(16)
                db.execute("""INSERT INTO users(name,username,email,password_hash,salt,department,coins)
                    VALUES(?,?,?,?,?,?,?)""",
                    (name, email, email, hash_password(demo_password, salt), salt, department, coins))
            ids = {row["email"]: row["id"] for row in db.execute("SELECT id,email FROM users")}
            sample = [
                ("rohan@iitr.ac.in", "aanya@iitr.ac.in", "Favour", "2026-10-24T09:00", "pending"),
                ("zoya@iitr.ac.in", "aanya@iitr.ac.in", "Favour", "2026-10-24T11:30", "pending"),
                ("kabir@iitr.ac.in", "aanya@iitr.ac.in", "Favour", "2026-10-23T08:15", "confirmed"),
            ]
            for creator_email, beneficiary_email, title, event_time, status in sample:
                cur = db.execute("""INSERT INTO favours(creator_id,beneficiary_id,title,event_time,status)
                    VALUES(?,?,?,?,?)""", (ids[creator_email], ids[beneficiary_email], title, event_time, status))
                if status == "confirmed":
                    db.execute("INSERT INTO ledger(user_id,favour_id,description,amount) VALUES(?,?,?,1)",
                               (ids[beneficiary_email], cur.lastrowid, title))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format_string, *args):
        print("%s - %s" % (self.address_string(), format_string % args))

    def send_json(self, data, status=200, headers=None):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        try:
            length = min(int(self.headers.get("Content-Length", "0")), 12000)
            return json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return None

    def session_user(self, db):
        token = None
        for piece in self.headers.get("Cookie", "").split(";"):
            key, _, value = piece.strip().partition("=")
            if key == "favour_session":
                token = value
        if not token:
            return None
        return db.execute("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?", (token,)).fetchone()

    def session_cookie(self, db, user_id):
        token = secrets.token_urlsafe(32)
        db.execute("INSERT INTO sessions(token,user_id) VALUES(?,?)", (token, user_id))
        return {"Set-Cookie": "favour_session=%s; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000" % token}

    @staticmethod
    def public_user(row):
        return {"id": row["id"], "name": row["name"], "email": row["email"],
                "department": row["department"], "coins": row["coins"]}

    def do_GET(self):
        path = urlsplit(self.path).path
        if not path.startswith("/api/"):
            if path == "/":
                self.send_response(302)
                self.send_header("Location", "/sign%20up/")
                self.end_headers()
                return
            return super().do_GET()
        with database() as db:
            user = self.session_user(db)
            if path == "/api/me":
                if not user:
                    return self.send_json({"user": None, "claims": []})
                claims = [row[0] for row in db.execute("SELECT reward_key FROM reward_claims WHERE user_id=?", (user["id"],))]
                return self.send_json({"user": self.public_user(user), "claims": claims})
            if path == "/api/people":
                if not user:
                    return self.send_json({"error": "Sign in to see people in your circle."}, 401)
                rows = db.execute("SELECT id,name,department,coins FROM users WHERE id!=? ORDER BY name", (user["id"],)).fetchall()
                return self.send_json({"people": [dict(row) for row in rows]})
            if path == "/api/favours":
                if not user:
                    return self.send_json({"error": "Sign in to see your favours."}, 401)
                rows = db.execute("""SELECT f.*, c.name AS creator_name, b.name AS beneficiary_name
                    FROM favours f JOIN users c ON c.id=f.creator_id JOIN users b ON b.id=f.beneficiary_id
                    WHERE f.creator_id=? OR f.beneficiary_id=? ORDER BY f.created_at DESC,f.id DESC""",
                    (user["id"], user["id"])).fetchall()
                return self.send_json({"favours": [dict(row) for row in rows]})
            if path == "/api/leaderboard":
                rows = db.execute("SELECT id,name,department,coins FROM users ORDER BY coins DESC,name LIMIT 8").fetchall()
                return self.send_json({"people": [dict(row) for row in rows]})
        return self.send_json({"error": "Not found."}, 404)

    def do_POST(self):
        path = urlsplit(self.path).path
        data = self.read_json()
        if data is None:
            return self.send_json({"error": "Invalid form data."}, 400)
        with database() as db:
            user = self.session_user(db)
            if path == "/api/signup":
                name = str(data.get("name", "")).strip()[:80]
                email = str(data.get("email", "")).strip().lower()[:140]
                password = str(data.get("password", ""))
                if len(name) < 2 or "@" not in email or len(password) < 8:
                    return self.send_json({"error": "Enter your name, a valid email, and a password with at least 8 characters."}, 400)
                salt = secrets.token_hex(16)
                try:
                    cur = db.execute("""INSERT INTO users(name,username,email,password_hash,salt)
                        VALUES(?,?,?,?,?)""", (name, email, email, hash_password(password, salt), salt))
                except sqlite3.IntegrityError:
                    return self.send_json({"error": "That email already has an account. Please sign in."}, 409)
                row = db.execute("SELECT * FROM users WHERE id=?", (cur.lastrowid,)).fetchone()
                return self.send_json({"created": True}, 201)
            if path == "/api/login":
                email = str(data.get("email", data.get("username", ""))).strip()
                password = str(data.get("password", ""))
                row = db.execute("SELECT * FROM users WHERE username=? OR email=?", (email, email)).fetchone()
                if not row or not hmac.compare_digest(hash_password(password, row["salt"]), row["password_hash"]):
                    return self.send_json({"error": "Campus email or password doesn’t match."}, 401)
                return self.send_json({"user": self.public_user(row), "claims": []}, headers=self.session_cookie(db, row["id"]))
            if path == "/api/logout":
                token = None
                for piece in self.headers.get("Cookie", "").split(";"):
                    key, _, value = piece.strip().partition("=")
                    if key == "favour_session":
                        token = value
                if token:
                    db.execute("DELETE FROM sessions WHERE token=?", (token,))
                return self.send_json({"ok": True}, headers={"Set-Cookie": "favour_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"})
            if not user:
                return self.send_json({"error": "Sign in to continue."}, 401)
            if path == "/api/favours":
                try:
                    beneficiary_id = int(data.get("beneficiary_id"))
                except (ValueError, TypeError):
                    return self.send_json({"error": "Choose a person."}, 400)
                event_time = str(data.get("event_time", "")).strip()[:40]
                recipient = db.execute("SELECT id,name FROM users WHERE id=?", (beneficiary_id,)).fetchone()
                if beneficiary_id == user["id"] or not recipient or len(event_time) < 10:
                    return self.send_json({"error": "Choose a person and set the favour date and time."}, 400)
                title = "Favour"
                cur = db.execute("INSERT INTO favours(creator_id,beneficiary_id,title,event_time) VALUES(?,?,?,?)",
                                 (user["id"], beneficiary_id, title, event_time))
                return self.send_json({"id": cur.lastrowid}, 201)
            if path.startswith("/api/favours/") and path.endswith("/confirm"):
                try:
                    favour_id = int(path.split("/")[3])
                except (ValueError, IndexError):
                    return self.send_json({"error": "Favour not found."}, 404)
                favour = db.execute("SELECT * FROM favours WHERE id=?", (favour_id,)).fetchone()
                if not favour:
                    return self.send_json({"error": "Favour not found."}, 404)
                if favour["beneficiary_id"] != user["id"]:
                    return self.send_json({"error": "Only the person receiving the favour can confirm it."}, 403)
                changed = db.execute("UPDATE favours SET status='confirmed',confirmed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'", (favour_id,)).rowcount
                if changed != 1:
                    return self.send_json({"error": "This favour has already been handled."}, 409)
                db.execute("UPDATE users SET coins=coins+1 WHERE id=?", (user["id"],))
                db.execute("INSERT INTO ledger(user_id,favour_id,description,amount) VALUES(?,?,?,1)",
                           (user["id"], favour_id, favour["title"]))
                return self.send_json({"ok": True, "coins": user["coins"] + 1})
            if path.startswith("/api/favours/") and path.endswith("/decline"):
                try:
                    favour_id = int(path.split("/")[3])
                except (ValueError, IndexError):
                    return self.send_json({"error": "Favour not found."}, 404)
                changed = db.execute("UPDATE favours SET status='declined' WHERE id=? AND beneficiary_id=? AND status='pending'",
                                     (favour_id, user["id"])).rowcount
                if not changed:
                    return self.send_json({"error": "Pending favour not found."}, 404)
                return self.send_json({"ok": True})
            if path == "/api/rewards/claim":
                reward = str(data.get("reward", ""))
                thresholds = {"pakoda": 3, "biryani": 5}
                if reward not in thresholds:
                    return self.send_json({"error": "Reward not found."}, 404)
                if user["coins"] < thresholds[reward]:
                    return self.send_json({"error": "Earn enough Favourcoins to unlock that treat."}, 400)
                try:
                    db.execute("INSERT INTO reward_claims(user_id,reward_key) VALUES(?,?)", (user["id"], reward))
                except sqlite3.IntegrityError:
                    return self.send_json({"error": "You have already claimed this treat."}, 409)
                return self.send_json({"ok": True})
        return self.send_json({"error": "Not found."}, 404)


if __name__ == "__main__":
    initialize_database()
    print("Favour is running at http://127.0.0.1:%s" % PORT)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
