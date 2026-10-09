"""Wipe ALL app data (users, mementos, hops, reports, uploaded photos). Keeps the admin key."""
import sqlite3, os, glob
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
c = sqlite3.connect(os.path.join(D, "memento.db"))
for t in ("reports", "hops", "mementos", "users"): c.execute(f"DELETE FROM {t}")
c.execute("DELETE FROM sqlite_sequence") if c.execute("SELECT name FROM sqlite_master WHERE name='sqlite_sequence'").fetchone() else None
c.commit(); c.execute("VACUUM"); c.close()
for f in glob.glob(os.path.join(D, "uploads", "*")): os.remove(f)
print("wiped")
