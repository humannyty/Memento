#!/usr/bin/env python3
"""memento prototype server: stdlib only (http.server + sqlite3)."""
import base64, json, os, re, secrets, sqlite3, threading, uuid, html, mimetypes
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.abspath(__file__))
PUB = os.path.join(ROOT, "public")
DATA = os.path.join(ROOT, "data")
UPL = os.path.join(DATA, "uploads")
DB = os.path.join(DATA, "memento.db")
PORT = int(os.environ.get("PORT", "8787"))
CAP = 20
MIN_GAP = 4          # hops required since a person last held a memento before it can return
MAXLEN = 140
PT = ZoneInfo("America/Los_Angeles")
os.makedirs(UPL, exist_ok=True)

keyf = os.path.join(DATA, "admin_key.txt")
if not os.path.exists(keyf):
    open(keyf, "w").write(secrets.token_urlsafe(18))
ADMIN_KEY = open(keyf).read().strip()

LOCK = threading.Lock()

from contextlib import contextmanager
@contextmanager
def db():
    c = sqlite3.connect(DB, timeout=10)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    try:
        with c: yield c
    finally:
        c.close()

with db() as c:
    c.executescript("""
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS mementos(id INTEGER PRIMARY KEY, creator_id INTEGER NOT NULL REFERENCES users(id),
        kind TEXT NOT NULL, text TEXT, image TEXT, created_at TEXT NOT NULL, created_day TEXT NOT NULL,
        holder_id INTEGER NOT NULL REFERENCES users(id), hops INTEGER NOT NULL DEFAULT 0, received_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS hops(id INTEGER PRIMARY KEY, memento_id INTEGER NOT NULL REFERENCES mementos(id),
        from_id INTEGER NOT NULL, to_id INTEGER NOT NULL, at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reports(id INTEGER PRIMARY KEY, memento_id INTEGER NOT NULL, reporter_id INTEGER NOT NULL,
        reason TEXT, at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS ix_m_holder ON mementos(holder_id);
    CREATE INDEX IF NOT EXISTS ix_h_m ON hops(memento_id);
    """)

def now(): return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
def today_pt(): return datetime.now(PT).date().isoformat()

class ApiError(Exception):
    def __init__(self, code, msg): self.code, self.msg = code, msg

def user(c, uid):
    try: uid = int(uid)
    except (TypeError, ValueError): raise ApiError(401, "unknown user")
    r = c.execute("SELECT id,name FROM users WHERE id=?", (uid,)).fetchone()
    if not r: raise ApiError(401, "unknown user")
    return dict(r)

def held_count(c, uid): return c.execute("SELECT COUNT(*) FROM mementos WHERE holder_id=?", (uid,)).fetchone()[0]

def holders_seq(c, m):
    seq = [m["creator_id"]]
    for h in c.execute("SELECT to_id FROM hops WHERE memento_id=? ORDER BY id", (m["id"],)): seq.append(h[0])
    return seq

def mem_json(c, m, uid=None):
    names = {r[0]: r[1] for r in c.execute("SELECT id,name FROM users")}
    last = c.execute("SELECT from_id FROM hops WHERE memento_id=? ORDER BY id DESC LIMIT 1", (m["id"],)).fetchone()
    return {"id": m["id"], "kind": m["kind"], "text": m["text"],
            "image": f"/uploads/{m['image']}" if m["image"] else None,
            "creator": names.get(m["creator_id"]), "creator_id": m["creator_id"],
            "from": names.get(last[0]) if last else None, "from_id": last[0] if last else None,
            "holder": names.get(m["holder_id"]), "holder_id": m["holder_id"],
            "hops": m["hops"], "created_at": m["created_at"], "received_at": m["received_at"]}

def picker(c, m, uid):
    seq = holders_seq(c, m); n = len(seq) - 1
    out = []
    for u in c.execute("SELECT id,name FROM users WHERE id!=? ORDER BY created_at, id", (uid,)):
        idx = [i for i, h in enumerate(seq) if h == u["id"]]
        since = n - idx[-1] if idx else None
        ok = since is None or since >= MIN_GAP
        out.append({"id": u["id"], "name": u["name"], "eligible": ok, "since": since})
    return out

def get_m(c, mid):
    m = c.execute("SELECT * FROM mementos WHERE id=?", (mid,)).fetchone()
    if not m: raise ApiError(404, "not found")
    return m

# ---------------------------------------------------------------- API handlers
def api(method, path, q, body):
    with LOCK, db() as c:
        if path == "/api/users" and method == "GET":
            return {"users": [dict(r) for r in c.execute("SELECT id,name FROM users ORDER BY created_at, id")]}
        if path == "/api/users" and method == "POST":
            name = re.sub(r"\s+", " ", str(body.get("name", ""))).strip()[:24]
            if not name: raise ApiError(400, "Please type a name.")
            r = c.execute("SELECT id,name FROM users WHERE name=?", (name,)).fetchone()
            if r: return {"user": dict(r)}
            cur = c.execute("INSERT INTO users(name,created_at) VALUES(?,?)", (name, now()))
            return {"user": {"id": cur.lastrowid, "name": name}}
        if path == "/api/me":
            u = user(c, q.get("uid"))
            held = [mem_json(c, m) for m in c.execute("SELECT * FROM mementos WHERE holder_id=? ORDER BY received_at DESC, id DESC", (u["id"],))]
            made = c.execute("SELECT * FROM mementos WHERE creator_id=? ORDER BY id DESC", (u["id"],)).fetchall()
            today = c.execute("SELECT COUNT(*) FROM mementos WHERE creator_id=? AND created_day=?", (u["id"], today_pt())).fetchone()[0]
            others = [dict(r) for r in c.execute("SELECT id,name FROM users WHERE id!=? ORDER BY created_at,id", (u["id"],))]
            full = {r[0] for r in c.execute("SELECT holder_id FROM mementos GROUP BY holder_id HAVING COUNT(*)>=?", (CAP,))}
            # a suggestion for the firm nudge: oldest held memento + an eligible, non-full friend
            sugg = None
            if len(held) >= 17 and others:
                for mj in sorted(held, key=lambda x: x["received_at"]):
                    elig = [p for p in picker(c, get_m(c, mj["id"]), u["id"]) if p["eligible"] and p["id"] not in full]
                    if elig:
                        p = elig[(mj["id"] + u["id"]) % len(elig)]
                        sugg = {"memento_id": mj["id"], "to_id": p["id"], "to": p["name"]}; break
            return {"user": u, "held": held, "count": len(held), "cap": CAP, "made_today": today > 0,
                    "made": [mem_json(c, m) for m in made], "people": others, "suggestion": sugg, "server_time": now()}
        mm = re.fullmatch(r"/api/mementos(?:/(\d+))?(?:/(hand|report))?", path)
        if mm:
            mid, action = mm.group(1), mm.group(2)
            if not mid and method == "POST":
                u = user(c, body.get("uid"))
                if held_count(c, u["id"]) >= CAP: raise ApiError(409, "full")
                if c.execute("SELECT COUNT(*) FROM mementos WHERE creator_id=? AND created_day=?", (u["id"], today_pt())).fetchone()[0]:
                    raise ApiError(409, "already")
                kind = body.get("kind")
                if kind not in ("photo", "note", "joke"): raise ApiError(400, "bad kind")
                text = str(body.get("text") or "").strip()
                if len(text) > MAXLEN: raise ApiError(400, "Too long (max 140).")
                img = None
                if kind == "photo":
                    data = str(body.get("image") or "")
                    data = data.split(",", 1)[1] if data.startswith("data:") else data
                    try: raw = base64.b64decode(data, validate=True)
                    except Exception: raise ApiError(400, "bad image")
                    if raw[:3] != b"\xff\xd8\xff" or len(raw) > 4_000_000: raise ApiError(400, "Please choose a photo (JPEG, under 4 MB).")
                    img = uuid.uuid4().hex + ".jpg"
                    open(os.path.join(UPL, img), "wb").write(raw)
                elif not text: raise ApiError(400, "Write something first.")
                t = now()
                cur = c.execute("INSERT INTO mementos(creator_id,kind,text,image,created_at,created_day,holder_id,hops,received_at) VALUES(?,?,?,?,?,?,?,0,?)",
                                (u["id"], kind, text or None, img, t, today_pt(), u["id"], t))
                return {"memento": mem_json(c, get_m(c, cur.lastrowid))}
            if mid and not action and method == "GET":
                u = user(c, q.get("uid")); m = get_m(c, int(mid))
                seq = holders_seq(c, m)
                if u["id"] not in seq: raise ApiError(403, "You haven't held this one.")
                names = {r[0]: r[1] for r in c.execute("SELECT id,name FROM users")}
                tl = [{"name": names.get(m["creator_id"]), "id": m["creator_id"], "at": m["created_at"], "event": "made"}]
                for h in c.execute("SELECT * FROM hops WHERE memento_id=? ORDER BY id", (m["id"],)):
                    tl.append({"name": names.get(h["to_id"]), "id": h["to_id"], "from": names.get(h["from_id"]), "at": h["at"], "event": "received"})
                return {"memento": mem_json(c, m), "timeline": tl,
                        "picker": picker(c, m, u["id"]) if m["holder_id"] == u["id"] else []}
            if mid and action == "hand" and method == "POST":
                u = user(c, body.get("uid")); m = get_m(c, int(mid))
                if m["holder_id"] != u["id"]: raise ApiError(409, "This memento isn't in your hands any more.")
                to = user(c, body.get("to"))
                if to["id"] == u["id"]: raise ApiError(400, "That's you!")
                p = next((p for p in picker(c, m, u["id"]) if p["id"] == to["id"]), None)
                if not p or not p["eligible"]: raise ApiError(409, f"{to['name']} held it too recently.")
                if held_count(c, to["id"]) >= CAP:
                    return {"bounced": True, "name": to["name"]}
                t = now()
                c.execute("INSERT INTO hops(memento_id,from_id,to_id,at) VALUES(?,?,?,?)", (m["id"], u["id"], to["id"], t))
                c.execute("UPDATE mementos SET holder_id=?, hops=hops+1, received_at=? WHERE id=?", (to["id"], t, m["id"]))
                return {"ok": True, "to": to["name"], "hops": m["hops"] + 1}
            if mid and action == "report" and method == "POST":
                u = user(c, body.get("uid")); m = get_m(c, int(mid))
                c.execute("INSERT INTO reports(memento_id,reporter_id,reason,at) VALUES(?,?,?,?)",
                          (m["id"], u["id"], str(body.get("reason") or "")[:500], now()))
                return {"ok": True}
        raise ApiError(404, "no such endpoint")

def pt(iso):
    try: return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(PT).strftime("%a %d %b, %I:%M %p PT")
    except Exception: return iso

def admin_page():
    with db() as c:
        names = {r[0]: r[1] for r in c.execute("SELECT id,name FROM users")}
        rows = c.execute("SELECT r.*, m.kind, m.text, m.image, m.creator_id, m.holder_id, m.hops FROM reports r JOIN mementos m ON m.id=r.memento_id ORDER BY r.id DESC").fetchall()
        users = c.execute("SELECT u.id,u.name,u.created_at,(SELECT COUNT(*) FROM mementos WHERE holder_id=u.id) n FROM users u ORDER BY u.id").fetchall()
        total = c.execute("SELECT COUNT(*) FROM mementos").fetchone()[0]
    e = html.escape
    rep = "".join(f"""<tr><td>{e(pt(r['at']))}</td><td>#{r['memento_id']} · {e(r['kind'])}<br>{('<img src="/uploads/'+e(r['image'])+'">') if r['image'] else ''}{e(r['text'] or '')}</td>
      <td>{e(names.get(r['reporter_id'],'?'))}</td><td>{e(names.get(r['creator_id'],'?'))}</td><td>{e(names.get(r['holder_id'],'?'))}</td><td>{e(r['reason'] or '')}</td></tr>""" for r in rows) or '<tr><td colspan=6><i>No reports yet.</i></td></tr>'
    us = "".join(f"<li>{e(u['name'])} — holds {u['n']} of {CAP}</li>" for u in users)
    return f"""<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>memento · admin</title>
<style>body{{font:15px/1.4 Jost,system-ui,sans-serif;background:#faf4ea;color:#33243a;padding:20px;max-width:900px;margin:auto}}h1{{font-family:'Cormorant Garamond',serif;font-weight:400;font-style:italic}}
table{{border-collapse:collapse;width:100%}}td,th{{border-bottom:1px solid #e3d6cc;padding:8px;text-align:left;vertical-align:top}}img{{max-width:140px;display:block;margin:4px 0}}</style>
<h1>memento · reports</h1><div style="overflow-x:auto"><table><tr><th>When (PT)</th><th>Memento</th><th>Reported by</th><th>Made by</th><th>Held by</th><th>Reason</th></tr>{rep}</table></div>
<h1>people</h1><ul>{us}</ul><p>{total} mementos in the world.</p>"""

class H(BaseHTTPRequestHandler):
    server_version = "memento/0.1"
    def log_message(self, fmt, *a):
        print("%s %s" % (self.log_date_time_string(), fmt % a), flush=True)
    def send(self, code, body, ctype="application/json", cache="no-store"):
        if isinstance(body, (dict, list)): body = json.dumps(body).encode()
        elif isinstance(body, str): body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache); self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers(); self.wfile.write(body)
    def handle_any(self, method):
        u = urlparse(self.path); path = u.path; q = {k: v[0] for k, v in parse_qs(u.query).items()}
        try:
            if path.startswith("/api/"):
                body = {}
                if method == "POST":
                    n = int(self.headers.get("Content-Length") or 0)
                    if n > 8_000_000: raise ApiError(413, "too big")
                    body = json.loads(self.rfile.read(n) or b"{}")
                return self.send(200, api(method, path, q, body))
            if path == "/admin":
                if not secrets.compare_digest(q.get("key", ""), ADMIN_KEY): return self.send(403, "forbidden", "text/plain")
                return self.send(200, admin_page(), "text/html; charset=utf-8")
            if path.startswith("/uploads/"):
                f = os.path.join(UPL, os.path.basename(path))
                if re.fullmatch(r"[0-9a-f]{32}\.jpg", os.path.basename(path)) and os.path.exists(f):
                    return self.send(200, open(f, "rb").read(), "image/jpeg", "public, max-age=31536000, immutable")
                return self.send(404, "not found", "text/plain")
            rel = "index.html" if path in ("/", "") else path.lstrip("/")
            f = os.path.normpath(os.path.join(PUB, rel))
            if not f.startswith(PUB) or not os.path.isfile(f): f = os.path.join(PUB, "index.html")
            ct = mimetypes.guess_type(f)[0] or "application/octet-stream"
            if ct.startswith("text/") or ct.endswith("javascript") or ct.endswith("json"): ct += "; charset=utf-8"
            cache = "public, max-age=86400" if "/art/" in f or f.endswith(".png") else "no-cache"
            return self.send(200, open(f, "rb").read(), ct, cache)
        except ApiError as e:
            return self.send(e.code, {"error": e.msg})
        except Exception as e:
            import traceback; traceback.print_exc()
            return self.send(500, {"error": "server error"})
    def do_GET(self): self.handle_any("GET")
    def do_POST(self): self.handle_any("POST")

if __name__ == "__main__":
    print(f"memento listening on :{PORT}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()
