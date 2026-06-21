"""Run from the project root: python reset_admin.py"""
import sqlite3
import sys
from passlib.context import CryptContext

DB = "telemetry.db"
EMAIL = "admin@ai-asset-mgmt.local"
NEW_PASSWORD = "Admin123!"

pwd = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
hashed = pwd.hash(NEW_PASSWORD)

try:
    conn = sqlite3.connect(DB)
    cur = conn.cursor()
    cur.execute(
        "UPDATE users SET hashed_password=?, is_active=1 WHERE email=?",
        (hashed, EMAIL),
    )
    conn.commit()
    rows = cur.rowcount
    conn.close()
    if rows:
        print(f"Done! Login with:  {EMAIL}  /  {NEW_PASSWORD}")
    else:
        print(f"User '{EMAIL}' not found in {DB}.")
        print("Check the email address or that you are in the right folder.")
except FileNotFoundError:
    print(f"ERROR: {DB} not found. Run this script from the project root folder.")
    sys.exit(1)
