import urllib.request, urllib.error, json, sys

BASE = "https://aifinops-backend.onrender.com"
EMAIL = "admin@aifinops.local"
PASSWORD = "Htaron1603."

PAGES = ["home","chat","overview","cost","agents","models","workflows",
         "alerts","budgets","security","users","apikeys","settings",
         "integrations","onboarding"]

def post(path, body, token=None):
    data = json.dumps(body).encode()
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode()}")
        sys.exit(1)

def patch(path, body, token):
    data = json.dumps(body).encode()
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {token}"}
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method="PATCH")
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode()}")
        sys.exit(1)

print("Logging in...")
resp = post("/auth/login", {"email": EMAIL, "password": PASSWORD})
token = resp["access_token"]
print("Login OK")

print("Patching admin role...")
result = patch("/roles/admin", {"pages": PAGES}, token)
print("Result:", json.dumps(result, indent=2))
