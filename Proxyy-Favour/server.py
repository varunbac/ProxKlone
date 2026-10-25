#!/usr/bin/env python3
"""SQLite-backed local server for Hangout."""
from contextlib import contextmanager
from email.message import EmailMessage
from email.utils import formataddr
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from datetime import datetime, timedelta
from urllib.parse import unquote, urlsplit
import hashlib
import hmac
import json
import os
import re
import secrets
import smtplib
import ssl
import sqlite3
import time

ROOT = Path(__file__).resolve().parent
DATABASE = ROOT / "favour.sqlite3"
PORT = int(os.environ.get("PORT", "8767"))
# Capture the server source revision at startup. A launcher can then distinguish
# this process from an older copy that still has the same project directory.
SERVER_BUILD = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()[:16]
OTP_TTL_SECONDS = 10 * 60
OTP_RESEND_SECONDS = 60
OTP_MAX_ATTEMPTS = 5


def load_local_environment():
    """Load simple KEY=value settings from .env without an extra dependency."""
    env_path = ROOT / ".env"
    try:
        lines = env_path.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("\"'")
        if key.startswith("FAVOUR_SMTP_") and re.fullmatch(r"[A-Z0-9_]+", key):
            os.environ.setdefault(key, value)


load_local_environment()


class MailConfigurationError(Exception):
    pass


class MailDeliveryError(Exception):
    pass


def smtp_settings():
    host = os.environ.get("FAVOUR_SMTP_HOST", "").strip()
    sender = os.environ.get("FAVOUR_SMTP_FROM", "").strip()
    username = os.environ.get("FAVOUR_SMTP_USER", "").strip()
    password = os.environ.get("FAVOUR_SMTP_PASSWORD", "")
    try:
        port = int(os.environ.get("FAVOUR_SMTP_PORT", "587"))
    except ValueError as error:
        raise MailConfigurationError("FAVOUR_SMTP_PORT must be a number.") from error
    starttls = os.environ.get("FAVOUR_SMTP_STARTTLS", "true").strip().lower() not in ("0", "false", "no")
    use_ssl = os.environ.get("FAVOUR_SMTP_SSL", "false").strip().lower() in ("1", "true", "yes")
    if not host or not sender:
        raise MailConfigurationError("Email delivery is not configured. Add the FAVOUR_SMTP settings to the .env file and restart Hangout.")
    if not valid_email(sender.lower()):
        raise MailConfigurationError("FAVOUR_SMTP_FROM must be a valid sender email address.")
    if not 1 <= port <= 65535:
        raise MailConfigurationError("FAVOUR_SMTP_PORT must be between 1 and 65535.")
    if bool(username) != bool(password):
        raise MailConfigurationError("Set both FAVOUR_SMTP_USER and FAVOUR_SMTP_PASSWORD, or leave both blank for an unauthenticated relay.")
    if starttls and use_ssl:
        raise MailConfigurationError("Use either FAVOUR_SMTP_STARTTLS or FAVOUR_SMTP_SSL, not both.")
    if username and not (starttls or use_ssl):
        raise MailConfigurationError("SMTP authentication requires TLS. Enable STARTTLS or SSL in the .env file.")
    return host, port, sender, username, password, starttls, use_ssl


def send_otp_email(recipient, code, purpose):
    host, port, sender, username, password, starttls, use_ssl = smtp_settings()
    if purpose == "signup":
        subject = "Verify your Hangout email"
        introduction = "Use this code to verify your email and finish creating your Hangout account."
    else:
        subject = "Reset your Hangout password"
        introduction = "Use this code to reset your Hangout password."
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = formataddr(("Hangout", sender))
    message["To"] = recipient
    message.set_content("""%s

Your one-time code is: %s

The code expires in 10 minutes. If you did not request this, you can ignore this email.
""" % (introduction, code))
    try:
        if use_ssl:
            client_context = smtplib.SMTP_SSL(host, port, timeout=15,
                                              context=ssl.create_default_context())
        else:
            client_context = smtplib.SMTP(host, port, timeout=15)
        with client_context as client:
            client.ehlo()
            if starttls:
                client.starttls(context=ssl.create_default_context())
                client.ehlo()
            if username:
                client.login(username, password)
            client.send_message(message)
    except (OSError, smtplib.SMTPException) as error:
        raise MailDeliveryError("Hangout could not send the email. Check your SMTP settings and try again.") from error


def valid_email(email):
    return len(email) <= 140 and re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email) is not None


def otp_digest(db, purpose, email, code):
    row = db.execute("SELECT meta_value FROM app_meta WHERE meta_key='otp_pepper_v1'").fetchone()
    if row:
        pepper = row[0]
    else:
        pepper = secrets.token_hex(32)
        db.execute("INSERT INTO app_meta(meta_key,meta_value) VALUES('otp_pepper_v1',?)", (pepper,))
    value = "%s:%s:%s" % (purpose, email.lower(), code)
    return hmac.new(pepper.encode("utf-8"), value.encode("utf-8"), hashlib.sha256).hexdigest()
TREATS = (
    {"key": "pakoda", "name": "Aloo pakoda", "cost": 2},
    {"key": "biryani", "name": "Hyderabadi biryani", "cost": 5},
    {"key": "chai-samosa", "name": "Chai and samosa", "cost": 2},
    {"key": "midnight-maggi", "name": "Midnight Maggi", "cost": 3},
    {"key": "momos", "name": "Steamed momos", "cost": 4},
    {"key": "masala-dosa", "name": "Masala dosa", "cost": 4},
    {"key": "chole-bhature", "name": "Chole bhature", "cost": 4},
    {"key": "campus-pizza", "name": "Campus pizza treat", "cost": 7},
)
TREAT_BY_KEY = {treat["key"]: treat for treat in TREATS}
DEMO_EMAILS = (
    "aanya@iitr.ac.in", "rohan@iitr.ac.in", "zoya@iitr.ac.in",
    "kabir@iitr.ac.in", "ishita@iitr.ac.in",
)


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
            CREATE TABLE IF NOT EXISTS treat_redemptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                requester_id INTEGER NOT NULL REFERENCES users(id),
                provider_id INTEGER NOT NULL REFERENCES users(id),
                treat_key TEXT NOT NULL,
                treat_name TEXT NOT NULL,
                cost INTEGER NOT NULL CHECK(cost > 0),
                status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','fulfilled','declined','cancelled')),
                requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                fulfilled_at TEXT
            );
            CREATE TABLE IF NOT EXISTS app_meta (
                meta_key TEXT PRIMARY KEY,
                meta_value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS pending_signups (
                email TEXT PRIMARY KEY COLLATE NOCASE,
                otp_hash TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                last_sent_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS password_reset_otps (
                user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                otp_hash TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                last_sent_at INTEGER NOT NULL
            );
        """)
        treat_schema = db.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='treat_redemptions'"
        ).fetchone()
        if treat_schema and "BETWEEN 2 AND 7" in (treat_schema["sql"] or "").upper():
            # Preserve existing requests while removing the old 2–7 price limit.
            db.execute("BEGIN IMMEDIATE")
            db.execute("ALTER TABLE treat_redemptions RENAME TO treat_redemptions_legacy")
            db.execute("""CREATE TABLE treat_redemptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                requester_id INTEGER NOT NULL REFERENCES users(id),
                provider_id INTEGER NOT NULL REFERENCES users(id),
                treat_key TEXT NOT NULL,
                treat_name TEXT NOT NULL,
                cost INTEGER NOT NULL CHECK(cost > 0),
                status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','fulfilled','declined','cancelled')),
                requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                fulfilled_at TEXT
            )""")
            db.execute("""INSERT INTO treat_redemptions
                (id,requester_id,provider_id,treat_key,treat_name,cost,status,requested_at,fulfilled_at)
                SELECT id,requester_id,provider_id,treat_key,treat_name,cost,status,requested_at,fulfilled_at
                FROM treat_redemptions_legacy""")
            db.execute("DROP TABLE treat_redemptions_legacy")
        db.execute("UPDATE favours SET title='Proxy' WHERE title!='Proxy'")
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
                ("rohan@iitr.ac.in", "aanya@iitr.ac.in", "Proxy", "2026-10-24T09:00", "pending"),
                ("zoya@iitr.ac.in", "aanya@iitr.ac.in", "Proxy", "2026-10-24T11:30", "pending"),
                ("kabir@iitr.ac.in", "aanya@iitr.ac.in", "Proxy", "2026-10-23T08:15", "confirmed"),
            ]
            for creator_email, beneficiary_email, title, event_time, status in sample:
                cur = db.execute("""INSERT INTO favours(creator_id,beneficiary_id,title,event_time,status)
                    VALUES(?,?,?,?,?)""", (ids[creator_email], ids[beneficiary_email], title, event_time, status))
                if status == "confirmed":
                    db.execute("INSERT INTO ledger(user_id,favour_id,description,amount) VALUES(?,?,?,1)",
                               (ids[beneficiary_email], cur.lastrowid, title))
        seed_demo_relationships(db)


def seed_demo_relationships(db):
    """Give the built-in demo circle believable, persistent person-to-person balances."""
    seeded = db.execute("SELECT 1 FROM app_meta WHERE meta_key='demo_relationships_v1'").fetchone()
    if seeded:
        return
    rows = db.execute("SELECT id,email FROM users WHERE email IN (%s)" %
                      ",".join("?" for _ in DEMO_EMAILS), DEMO_EMAILS).fetchall()
    ids = {row["email"].lower(): row["id"] for row in rows}
    if not all(email in ids for email in DEMO_EMAILS):
        return

    rng = secrets.SystemRandom()
    now = datetime.now()
    targets = [-3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    for index, first_email in enumerate(DEMO_EMAILS):
        for second_email in DEMO_EMAILS[index + 1:]:
            first_id, second_id = ids[first_email], ids[second_email]
            favour_balance = db.execute("""SELECT COALESCE(SUM(CASE WHEN creator_id=? THEN 1 ELSE -1 END),0)
                FROM favours WHERE status='confirmed'
                AND ((creator_id=? AND beneficiary_id=?) OR (creator_id=? AND beneficiary_id=?))""",
                (first_id, first_id, second_id, second_id, first_id)).fetchone()[0]
            treat_balance = db.execute("""SELECT COALESCE(SUM(CASE WHEN requester_id=? THEN -cost ELSE cost END),0)
                FROM treat_redemptions WHERE status='fulfilled'
                AND ((requester_id=? AND provider_id=?) OR (requester_id=? AND provider_id=?))""",
                (first_id, first_id, second_id, second_id, first_id)).fetchone()[0]
            difference = rng.choice(targets) - int(favour_balance + treat_balance)
            if difference == 0:
                continue
            creator_id, beneficiary_id = ((first_id, second_id) if difference > 0
                                           else (second_id, first_id))
            for _ in range(abs(difference)):
                happened = now - timedelta(days=rng.randint(2, 35),
                                           hours=rng.randint(0, 22), minutes=rng.choice((0, 15, 30, 45)))
                timestamp = happened.strftime("%Y-%m-%d %H:%M:%S")
                event_time = happened.strftime("%Y-%m-%dT%H:%M")
                db.execute("""INSERT INTO favours
                    (creator_id,beneficiary_id,title,event_time,status,created_at,confirmed_at)
                    VALUES(?,?,'Proxy',?,'confirmed',?,?)""",
                    (creator_id, beneficiary_id, event_time, timestamp, timestamp))
    db.execute("INSERT INTO app_meta(meta_key,meta_value) VALUES('demo_relationships_v1','seeded')")


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
                "department": row["department"]}

    @staticmethod
    def relationship_balance(db, user_id, partner_id):
        favour_delta = db.execute("""SELECT COALESCE(SUM(CASE WHEN creator_id=? THEN 1 ELSE -1 END),0)
            FROM favours WHERE status='confirmed'
            AND ((creator_id=? AND beneficiary_id=?) OR (creator_id=? AND beneficiary_id=?))""",
            (user_id, user_id, partner_id, partner_id, user_id)).fetchone()[0]
        treat_delta = db.execute("""SELECT COALESCE(SUM(CASE WHEN requester_id=? THEN -cost ELSE cost END),0)
            FROM treat_redemptions WHERE status='fulfilled'
            AND ((requester_id=? AND provider_id=?) OR (requester_id=? AND provider_id=?))""",
            (user_id, user_id, partner_id, partner_id, user_id)).fetchone()[0]
        return int(favour_delta + treat_delta)

    @staticmethod
    def total_outstanding_debt(db, user_id):
        """Sum this user's deficits with each person without offsetting separate credits."""
        return int(db.execute("""WITH entries AS (
                SELECT CASE WHEN creator_id=? THEN beneficiary_id ELSE creator_id END AS partner_id,
                       CASE WHEN creator_id=? THEN 1 ELSE -1 END AS amount
                FROM favours
                WHERE status='confirmed' AND (creator_id=? OR beneficiary_id=?)
                UNION ALL
                SELECT CASE WHEN requester_id=? THEN provider_id ELSE requester_id END AS partner_id,
                       CASE WHEN requester_id=? THEN -cost ELSE cost END AS amount
                FROM treat_redemptions
                WHERE status='fulfilled' AND (requester_id=? OR provider_id=?)
            ), balances AS (
                SELECT partner_id, SUM(amount) AS balance FROM entries GROUP BY partner_id
            )
            SELECT COALESCE(SUM(CASE WHEN balance < 0 THEN -balance ELSE 0 END),0)
            FROM balances""",
            (user_id, user_id, user_id, user_id,
             user_id, user_id, user_id, user_id)).fetchone()[0])

    @staticmethod
    def relationship_reserved(db, user_id, partner_id):
        return int(db.execute("""SELECT COALESCE(SUM(cost),0) FROM treat_redemptions
            WHERE requester_id=? AND provider_id=? AND status='pending'""",
            (user_id, partner_id)).fetchone()[0])

    @classmethod
    def relationship_summary(cls, db, user_id, partner_id):
        given = db.execute("""SELECT COUNT(*) FROM favours
            WHERE creator_id=? AND beneficiary_id=? AND status='confirmed'""",
            (user_id, partner_id)).fetchone()[0]
        received = db.execute("""SELECT COUNT(*) FROM favours
            WHERE creator_id=? AND beneficiary_id=? AND status='confirmed'""",
            (partner_id, user_id)).fetchone()[0]
        pending_given = db.execute("""SELECT COUNT(*) FROM favours
            WHERE creator_id=? AND beneficiary_id=? AND status='pending'""",
            (user_id, partner_id)).fetchone()[0]
        pending_received = db.execute("""SELECT COUNT(*) FROM favours
            WHERE creator_id=? AND beneficiary_id=? AND status='pending'""",
            (partner_id, user_id)).fetchone()[0]
        balance = cls.relationship_balance(db, user_id, partner_id)
        reserved = cls.relationship_reserved(db, user_id, partner_id)
        return {"balance": balance, "reserved": reserved, "available": max(0, balance - reserved),
                "given": given, "received": received,
                "pending_given": pending_given, "pending_received": pending_received}

    def request_signup_code(self, data):
        name = str(data.get("name", "")).strip()[:80]
        email = str(data.get("email", "")).strip().lower()[:140]
        password = str(data.get("password", ""))
        if len(name) < 2 or not valid_email(email) or not 8 <= len(password) <= 1024:
            return self.send_json({"error": "Enter your name, a valid email, and a password with 8 to 1024 characters."}, 400)
        with database() as db:
            if db.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone():
                return self.send_json({"error": "That email already has an account. Please sign in."}, 409)
            pending = db.execute("SELECT last_sent_at FROM pending_signups WHERE email=?", (email,)).fetchone()
            now = int(time.time())
            if pending and now - pending["last_sent_at"] < OTP_RESEND_SECONDS:
                wait = OTP_RESEND_SECONDS - (now - pending["last_sent_at"])
                return self.send_json({"error": "Please wait %s seconds before requesting another code." % wait}, 429)
        try:
            smtp_settings()
        except MailConfigurationError as error:
            return self.send_json({"error": str(error)}, 503)

        code = "%06d" % secrets.randbelow(1000000)
        now = int(time.time())
        with database() as db:
            digest = otp_digest(db, "signup", email, code)
            db.execute("""INSERT INTO pending_signups
                (email,otp_hash,expires_at,attempts,last_sent_at)
                VALUES(?,?,?,0,?)
                ON CONFLICT(email) DO UPDATE SET otp_hash=excluded.otp_hash,
                    expires_at=excluded.expires_at,attempts=0,last_sent_at=excluded.last_sent_at""",
                (email, digest, now + OTP_TTL_SECONDS, now))
        try:
            send_otp_email(email, code, "signup")
        except (MailConfigurationError, MailDeliveryError) as error:
            with database() as db:
                db.execute("DELETE FROM pending_signups WHERE email=? AND otp_hash=?", (email, digest))
            status = 503 if isinstance(error, MailConfigurationError) else 502
            return self.send_json({"error": str(error)}, status)
        return self.send_json({"sent": True, "expires_in": OTP_TTL_SECONDS})

    def verify_signup_code(self, data):
        name = str(data.get("name", "")).strip()[:80]
        email = str(data.get("email", "")).strip().lower()[:140]
        code = str(data.get("code", "")).strip()
        password = str(data.get("password", ""))
        if len(name) < 2 or not valid_email(email) or not re.fullmatch(r"\d{6}", code) or not 8 <= len(password) <= 1024:
            return self.send_json({"error": "Enter your name, email, six-digit code, and a password with 8 to 1024 characters."}, 400)
        now = int(time.time())
        with database() as db:
            pending = db.execute("SELECT * FROM pending_signups WHERE email=?", (email,)).fetchone()
            if not pending:
                return self.send_json({"error": "That code is invalid or expired. Request a new code."}, 400)
            if pending["expires_at"] <= now or pending["attempts"] >= OTP_MAX_ATTEMPTS:
                db.execute("DELETE FROM pending_signups WHERE email=?", (email,))
                return self.send_json({"error": "That code expired or has too many attempts. Request a new code."}, 400)
            expected = otp_digest(db, "signup", email, code)
            if not hmac.compare_digest(expected, pending["otp_hash"]):
                attempts = pending["attempts"] + 1
                if attempts >= OTP_MAX_ATTEMPTS:
                    db.execute("DELETE FROM pending_signups WHERE email=?", (email,))
                    return self.send_json({"error": "Too many incorrect codes. Request a new code."}, 400)
                db.execute("UPDATE pending_signups SET attempts=? WHERE email=?", (attempts, email))
                return self.send_json({"error": "That code is incorrect. Please try again."}, 400)
            salt = secrets.token_hex(16)
            try:
                db.execute("""INSERT INTO users(name,username,email,password_hash,salt)
                    VALUES(?,?,?,?,?)""",
                    (name, email, email, hash_password(password, salt), salt))
            except sqlite3.IntegrityError:
                db.execute("DELETE FROM pending_signups WHERE email=?", (email,))
                return self.send_json({"error": "That email already has an account. Please sign in."}, 409)
            db.execute("DELETE FROM pending_signups WHERE email=?", (email,))
        return self.send_json({"created": True}, 201)

    def request_password_reset_code(self, data):
        email = str(data.get("email", "")).strip().lower()[:140]
        if not valid_email(email):
            return self.send_json({"error": "Enter a valid email address."}, 400)
        try:
            smtp_settings()
        except MailConfigurationError as error:
            return self.send_json({"error": str(error)}, 503)
        code = "%06d" % secrets.randbelow(1000000)
        now = int(time.time())
        with database() as db:
            account = db.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone()
            if not account:
                return self.send_json({"sent": True, "expires_in": OTP_TTL_SECONDS})
            existing = db.execute("SELECT last_sent_at FROM password_reset_otps WHERE user_id=?",
                                  (account["id"],)).fetchone()
            if existing and now - existing["last_sent_at"] < OTP_RESEND_SECONDS:
                return self.send_json({"sent": True, "expires_in": OTP_TTL_SECONDS})
            digest = otp_digest(db, "password_reset", email, code)
            db.execute("""INSERT INTO password_reset_otps(user_id,otp_hash,expires_at,attempts,last_sent_at)
                VALUES(?,?,?,0,?) ON CONFLICT(user_id) DO UPDATE SET
                otp_hash=excluded.otp_hash,expires_at=excluded.expires_at,attempts=0,last_sent_at=excluded.last_sent_at""",
                (account["id"], digest, now + OTP_TTL_SECONDS, now))
            user_id = account["id"]
        try:
            send_otp_email(email, code, "password_reset")
        except (MailConfigurationError, MailDeliveryError) as error:
            with database() as db:
                db.execute("DELETE FROM password_reset_otps WHERE user_id=? AND otp_hash=?", (user_id, digest))
            status = 503 if isinstance(error, MailConfigurationError) else 502
            return self.send_json({"error": str(error)}, status)
        return self.send_json({"sent": True, "expires_in": OTP_TTL_SECONDS})

    def verify_password_reset_code(self, data):
        email = str(data.get("email", "")).strip().lower()[:140]
        code = str(data.get("code", "")).strip()
        password = str(data.get("password", ""))
        if not valid_email(email) or not re.fullmatch(r"\d{6}", code) or not 8 <= len(password) <= 1024:
            return self.send_json({"error": "Enter a valid email, six-digit code, and password with 8 to 1024 characters."}, 400)
        now = int(time.time())
        with database() as db:
            account = db.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone()
            reset = db.execute("SELECT * FROM password_reset_otps WHERE user_id=?",
                               (account["id"],)).fetchone() if account else None
            if not reset:
                return self.send_json({"error": "That code is invalid or expired. Request a new code."}, 400)
            if reset["expires_at"] <= now or reset["attempts"] >= OTP_MAX_ATTEMPTS:
                db.execute("DELETE FROM password_reset_otps WHERE user_id=?", (account["id"],))
                return self.send_json({"error": "That code expired or has too many attempts. Request a new code."}, 400)
            expected = otp_digest(db, "password_reset", email, code)
            if not hmac.compare_digest(expected, reset["otp_hash"]):
                attempts = reset["attempts"] + 1
                if attempts >= OTP_MAX_ATTEMPTS:
                    db.execute("DELETE FROM password_reset_otps WHERE user_id=?", (account["id"],))
                    return self.send_json({"error": "Too many incorrect codes. Request a new code."}, 400)
                db.execute("UPDATE password_reset_otps SET attempts=? WHERE user_id=?",
                           (attempts, account["id"]))
                return self.send_json({"error": "That code is incorrect. Please try again."}, 400)
            salt = secrets.token_hex(16)
            db.execute("UPDATE users SET password_hash=?,salt=? WHERE id=?",
                       (hash_password(password, salt), salt, account["id"]))
            db.execute("DELETE FROM sessions WHERE user_id=?", (account["id"],))
            db.execute("DELETE FROM password_reset_otps WHERE user_id=?", (account["id"],))
        return self.send_json({"ok": True})

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/api/health":
            return self.send_json({"application": "proxyy-favour", "root": str(ROOT), "build": SERVER_BUILD})
        if not path.startswith("/api/"):
            if any(part.startswith(".") and part not in (".", "..")
                   for part in unquote(path).split("/")):
                return self.send_error(404)
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
                    return self.send_json({"user": None})
                return self.send_json({"user": self.public_user(user)})
            if path in ("/api/people", "/api/leaderboard"):
                if not user:
                    return self.send_json({"error": "Sign in to see people in your circle."}, 401)
                rows = db.execute("SELECT id,name,department FROM users WHERE id!=? ORDER BY name", (user["id"],)).fetchall()
                people = []
                for row in rows:
                    person = dict(row)
                    person.update(self.relationship_summary(db, user["id"], row["id"]))
                    person["outstanding_debt"] = self.total_outstanding_debt(db, row["id"])
                    people.append(person)
                return self.send_json({"people": people})
            if path.startswith("/api/people/"):
                if not user:
                    return self.send_json({"error": "Sign in to see your relationship."}, 401)
                try:
                    partner_id = int(path.split("/")[3])
                except (ValueError, IndexError):
                    return self.send_json({"error": "Person not found."}, 404)
                person = db.execute("SELECT id,name,email,department FROM users WHERE id=? AND id!=?",
                                    (partner_id, user["id"])).fetchone()
                if not person:
                    return self.send_json({"error": "Person not found."}, 404)
                treats = list(TREATS)
                summary = self.relationship_summary(db, user["id"], partner_id)
                return self.send_json({"person": self.public_user(person), "relationship": summary,
                                       "treats": treats})
            if path == "/api/treats":
                if not user:
                    return self.send_json({"error": "Sign in to see treats in your circle."}, 401)
                return self.send_json({"treats": list(TREATS)})
            if path == "/api/favours":
                if not user:
                    return self.send_json({"error": "Sign in to see your proxies."}, 401)
                rows = db.execute("""SELECT f.*, c.name AS creator_name, b.name AS beneficiary_name
                    FROM favours f JOIN users c ON c.id=f.creator_id JOIN users b ON b.id=f.beneficiary_id
                    WHERE f.creator_id=? OR f.beneficiary_id=? ORDER BY f.created_at DESC,f.id DESC""",
                    (user["id"], user["id"])).fetchall()
                return self.send_json({"favours": [dict(row) for row in rows]})
        return self.send_json({"error": "Not found."}, 404)

    def do_POST(self):
        path = urlsplit(self.path).path
        data = self.read_json()
        if data is None:
            return self.send_json({"error": "Invalid form data."}, 400)
        if path == "/api/signup/send-otp":
            return self.request_signup_code(data)
        if path == "/api/signup/verify-otp":
            return self.verify_signup_code(data)
        if path == "/api/password-reset/send-otp":
            return self.request_password_reset_code(data)
        if path == "/api/password-reset/verify-otp":
            return self.verify_password_reset_code(data)
        with database() as db:
            user = self.session_user(db)
            if path == "/api/signup":
                return self.send_json({"error": "Verify your email first by requesting a one-time code."}, 400)
            if path == "/api/login":
                email = str(data.get("email", data.get("username", ""))).strip()
                password = str(data.get("password", ""))
                row = db.execute("SELECT * FROM users WHERE username=? OR email=?", (email, email)).fetchone()
                if not row or not hmac.compare_digest(hash_password(password, row["salt"]), row["password_hash"]):
                    return self.send_json({"error": "Campus email or password doesn’t match."}, 401)
                return self.send_json({"user": self.public_user(row)}, headers=self.session_cookie(db, row["id"]))
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
                    return self.send_json({"error": "Choose a person and set the proxy date and time."}, 400)
                title = "Proxy"
                cur = db.execute("INSERT INTO favours(creator_id,beneficiary_id,title,event_time) VALUES(?,?,?,?)",
                                 (user["id"], beneficiary_id, title, event_time))
                return self.send_json({"id": cur.lastrowid}, 201)
            if path.startswith("/api/favours/") and path.endswith("/confirm"):
                try:
                    favour_id = int(path.split("/")[3])
                except (ValueError, IndexError):
                    return self.send_json({"error": "Proxy not found."}, 404)
                favour = db.execute("SELECT * FROM favours WHERE id=?", (favour_id,)).fetchone()
                if not favour:
                    return self.send_json({"error": "Proxy not found."}, 404)
                if favour["beneficiary_id"] != user["id"]:
                    return self.send_json({"error": "Only the person receiving the proxy can confirm it."}, 403)
                changed = db.execute("UPDATE favours SET status='confirmed',confirmed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'", (favour_id,)).rowcount
                if changed != 1:
                    return self.send_json({"error": "This proxy has already been handled."}, 409)
                balance = self.relationship_balance(db, user["id"], favour["creator_id"])
                return self.send_json({"ok": True, "balance": balance, "partner_id": favour["creator_id"]})
            if path.startswith("/api/favours/") and path.endswith("/decline"):
                try:
                    favour_id = int(path.split("/")[3])
                except (ValueError, IndexError):
                    return self.send_json({"error": "Proxy not found."}, 404)
                changed = db.execute("UPDATE favours SET status='declined' WHERE id=? AND beneficiary_id=? AND status='pending'",
                                     (favour_id, user["id"])).rowcount
                if not changed:
                    return self.send_json({"error": "Pending proxy not found."}, 404)
                return self.send_json({"ok": True})
            if path == "/api/treat-redemptions":
                try:
                    provider_id = int(data.get("provider_id"))
                except (ValueError, TypeError):
                    return self.send_json({"error": "Choose the person providing the treat."}, 400)
                treat_key = str(data.get("treat_key", "")).strip()
                if treat_key == "custom":
                    treat_name = str(data.get("custom_name", "")).strip()
                    treat_cost = data.get("custom_cost")
                    if not treat_name or len(treat_name) > 80:
                        return self.send_json({"error": "Enter a custom dish name up to 80 characters."}, 400)
                    if isinstance(treat_cost, bool) or not isinstance(treat_cost, int) or treat_cost < 1:
                        return self.send_json({"error": "Set the custom dish price to a whole number of at least 1 P ₱."}, 400)
                    treat = {"key": "custom", "name": treat_name, "cost": treat_cost}
                else:
                    treat = TREAT_BY_KEY.get(treat_key)
                provider = db.execute("SELECT id FROM users WHERE id=? AND id!=?",
                                      (provider_id, user["id"])).fetchone()
                if not provider or not treat:
                    return self.send_json({"error": "Choose a valid person and treat."}, 400)
                relationship = self.relationship_summary(db, user["id"], provider_id)
                if relationship["available"] < treat["cost"]:
                    short = treat["cost"] - relationship["available"]
                    return self.send_json({"error": "You need %s more P ₱ with this person." % short}, 400)
                cur = db.execute("""INSERT INTO treat_redemptions
                    (requester_id,provider_id,treat_key,treat_name,cost)
                    VALUES(?,?,?,?,?)""",
                    (user["id"], provider_id, treat["key"], treat["name"], treat["cost"]))
                return self.send_json({"id": cur.lastrowid, "reserved": treat["cost"]}, 201)
            if path.startswith("/api/treat-redemptions/"):
                parts = path.strip("/").split("/")
                try:
                    redemption_id = int(parts[2])
                    action = parts[3]
                except (ValueError, IndexError):
                    return self.send_json({"error": "Treat request not found."}, 404)
                redemption = db.execute("SELECT * FROM treat_redemptions WHERE id=?", (redemption_id,)).fetchone()
                if not redemption or redemption["status"] != "pending":
                    return self.send_json({"error": "This treat request has already been handled."}, 409)
                if action == "fulfill":
                    if redemption["provider_id"] != user["id"]:
                        return self.send_json({"error": "Only the person providing the treat can mark it delivered."}, 403)
                    balance = self.relationship_balance(db, redemption["requester_id"], redemption["provider_id"])
                    if balance < redemption["cost"]:
                        return self.send_json({"error": "The requester no longer has enough P ₱ with you."}, 409)
                    db.execute("UPDATE treat_redemptions SET status='fulfilled',fulfilled_at=CURRENT_TIMESTAMP WHERE id=?",
                               (redemption_id,))
                    return self.send_json({"ok": True})
                if action == "decline":
                    if redemption["provider_id"] != user["id"]:
                        return self.send_json({"error": "Only the person providing the treat can decline it."}, 403)
                    db.execute("UPDATE treat_redemptions SET status='declined' WHERE id=?", (redemption_id,))
                    return self.send_json({"ok": True})
                if action == "cancel":
                    if redemption["requester_id"] != user["id"]:
                        return self.send_json({"error": "Only the person who requested the treat can cancel it."}, 403)
                    db.execute("UPDATE treat_redemptions SET status='cancelled' WHERE id=?", (redemption_id,))
                    return self.send_json({"ok": True})
                return self.send_json({"error": "Treat action not found."}, 404)
        return self.send_json({"error": "Not found."}, 404)


if __name__ == "__main__":
    initialize_database()
    print("Hangout is running at http://127.0.0.1:%s" % PORT)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
