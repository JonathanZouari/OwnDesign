"""Tiny data layer: SQLite locally, Supabase/Postgres when DATABASE_URL is set.
Schema uses TEXT ids and portable types so the same SQL runs on both."""
import datetime as dt
import os
import sqlite3
import threading
import uuid

SCHEMA = """
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT, pw TEXT NOT NULL, created TEXT);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), created TEXT);
CREATE TABLE IF NOT EXISTS studios(id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT, logo_url TEXT, color_primary TEXT,
  color_accent TEXT, font TEXT, template TEXT, plan TEXT, trial_ends TEXT, created TEXT);
CREATE TABLE IF NOT EXISTS memberships(studio_id TEXT REFERENCES studios(id), user_id TEXT REFERENCES users(id), role TEXT,
  PRIMARY KEY(studio_id, user_id));
CREATE TABLE IF NOT EXISTS invitations(token TEXT PRIMARY KEY, studio_id TEXT REFERENCES studios(id), email TEXT, role TEXT,
  project_id TEXT, used INTEGER, created TEXT);
CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, studio_id TEXT REFERENCES studios(id), name TEXT, kind TEXT, brief TEXT,
  status TEXT, created TEXT);
CREATE TABLE IF NOT EXISTS project_access(project_id TEXT REFERENCES projects(id), user_id TEXT REFERENCES users(id), role TEXT,
  PRIMARY KEY(project_id, user_id));
CREATE TABLE IF NOT EXISTS plan_versions(id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), n INTEGER, data TEXT,
  note TEXT, author_id TEXT, needs_review INTEGER, review_reasons TEXT, created TEXT);
CREATE TABLE IF NOT EXISTS render_jobs(id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id),
  version_id TEXT REFERENCES plan_versions(id), viewpoint TEXT, room_id TEXT, status TEXT, error TEXT, image TEXT, created TEXT);
CREATE TABLE IF NOT EXISTS ai_messages(id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), role TEXT, content TEXT, created TEXT);
CREATE TABLE IF NOT EXISTS project_posts(id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), author_id TEXT, kind TEXT,
  body TEXT, created TEXT);
CREATE TABLE IF NOT EXISTS project_tasks(id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), title TEXT, assignee_id TEXT,
  done INTEGER, created_by TEXT, created TEXT);
CREATE TABLE IF NOT EXISTS review_decisions(id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), version_id TEXT,
  decision TEXT, note TEXT, author_id TEXT, created TEXT);
CREATE TABLE IF NOT EXISTS audit_events(id TEXT PRIMARY KEY, studio_id TEXT, project_id TEXT, user_id TEXT, action TEXT,
  detail TEXT, created TEXT);
CREATE TABLE IF NOT EXISTS credit_ledger(id TEXT PRIMARY KEY, studio_id TEXT REFERENCES studios(id), delta INTEGER, reason TEXT,
  created TEXT);
"""

DATABASE_URL = os.environ.get("DATABASE_URL")
lock = threading.RLock()  # one shared connection; serialise access across server threads
conn = None


def init(path=None):
    global conn
    if DATABASE_URL:
        import psycopg  # only needed for Supabase/Postgres
        from psycopg.rows import dict_row
        conn = psycopg.connect(DATABASE_URL, row_factory=dict_row, autocommit=True)
        conn.execute(SCHEMA)
    else:
        conn = sqlite3.connect(path or os.environ.get("SQLITE_PATH", "app.db"), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        conn.executescript(SCHEMA)


def q(sql, *args):
    with lock:
        cur = conn.execute(sql.replace("?", "%s") if DATABASE_URL else sql, args)
        rows = cur.fetchall() if cur.description else []
        if not DATABASE_URL:
            conn.commit()
        return [dict(r) for r in rows]


def one(sql, *args):
    rows = q(sql, *args)
    return rows[0] if rows else None


def new_id():
    return uuid.uuid4().hex


def now(days=0):
    return (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=days)).isoformat(timespec="seconds")
