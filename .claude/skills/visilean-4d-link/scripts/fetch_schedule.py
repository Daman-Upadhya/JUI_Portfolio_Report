"""
Pull the current schedule (tasks + location tree + trades) from VisiLean - READ ONLY.

Usage:
  python fetch_schedule.py <work_dir> <projectGuid> [--env-prefix VL_TATA] [--list-projects]

Credentials are read from Windows *user* environment variables (set once with setup_credentials.ps1):
  <PREFIX>_CLIENT_ID      36-char GUID
  <PREFIX>_CLIENT_SECRET  ~43 chars
  <PREFIX>_MCP_KEY        ~75 chars, looks like "xxxxx_xxxx_..."
They are never printed or written to disk.

Writes: work_dir/tasks.json, work_dir/locations.json, work_dir/trades.json
Notes:  VisiLean allows 60 requests/minute and an MCP response is capped at ~60k characters,
        so tasks are paged 150 at a time with a narrow field list, with retry/back-off.
"""
import sys, os, json, time, argparse, urllib.request, urllib.error

ap = argparse.ArgumentParser()
ap.add_argument("work_dir"); ap.add_argument("project_guid", nargs="?")
ap.add_argument("--env-prefix", default="VL")
ap.add_argument("--list-projects", action="store_true", help="only list the projects the credentials can see")
a = ap.parse_args()

def env(n):
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as k: return winreg.QueryValueEx(k, n)[0]
    except Exception:
        v = os.environ.get(n)
        if not v: sys.exit(f"Environment variable {n} is not set - run setup_credentials.ps1 first.")
        return v

URL = "https://go.visilean.com/ca/mcp"
H = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream",
     "X-MCP-Client-Id": env(a.env_prefix + "_CLIENT_ID"), "X-MCP-Client-Secret": env(a.env_prefix + "_CLIENT_SECRET"),
     "X-MCP-Key": env(a.env_prefix + "_MCP_KEY")}
SID = None

def post(payload):
    global SID
    h = dict(H)
    if SID: h["Mcp-Session-Id"] = SID
    req = urllib.request.Request(URL, data=json.dumps(payload).encode(), headers=h, method="POST")
    with urllib.request.urlopen(req, timeout=300) as r:
        body = r.read().decode("utf-8", "replace"); SID = r.headers.get("Mcp-Session-Id") or SID
    if body.lstrip().startswith(("event:", "data:")):
        d = [l[5:].strip() for l in body.splitlines() if l.startswith("data:")]; body = d[-1] if d else ""
    return json.loads(body) if body.strip() else None

def connect():
    global SID
    SID = None
    post({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-03-26", "capabilities": {},
                                                                         "clientInfo": {"name": "vl-4d-link", "version": "1"}}})
    post({"jsonrpc": "2.0", "method": "notifications/initialized"})

def call(tool, args):
    for attempt in range(6):
        try:
            res = post({"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": tool, "arguments": args}})
            if "error" in res:
                msg = res["error"].get("message", "")
                if "credential" in msg.lower():
                    sys.exit("VisiLean rejected the credentials. Check the three values; a common mistake is pasting the "
                             "Client ID (36-char GUID) and the MCP Key (75-char token) into each other's prompts.")
                raise RuntimeError(msg)
            return json.loads("\n".join(c.get("text", "") for c in res["result"].get("content", [])))
        except (urllib.error.HTTPError, json.JSONDecodeError, RuntimeError) as e:
            time.sleep(6 * (attempt + 1)); connect()
    raise RuntimeError(f"{tool} failed after retries")

connect()
if a.list_projects or not a.project_guid:
    p = call("visilean_list_projects", {})
    print("workspace:", p.get("customerName"))
    for x in p["projects"]: print(f"  {x['projectGuid']}  {x['status']:<11} {x['title']}")
    sys.exit(0)

W = a.work_dir; os.makedirs(W, exist_ok=True); P = a.project_guid
json.dump(call("visilean_list_locations", {"projectGuid": P, "fields": "title,hasChildren"}),
          open(os.path.join(W, "locations.json"), "w", encoding="utf-8"))
json.dump(call("visilean_list_trades", {"projectGuid": P}), open(os.path.join(W, "trades.json"), "w", encoding="utf-8"))
F = "taskGuid,taskId,externalId,title,locationGuid,tradeGuid,activityType,startDate,endDate,status"
tasks, page = [], 0
while True:
    d = call("visilean_list_tasks", {"projectGuid": P, "pageSize": 150, "page": page, "fields": F, "sort": "name"})
    tasks += d["data"]
    if not d["hasNext"]: break
    page += 1
    if page % 20 == 0: print("tasks", len(tasks), "/", d["totalCount"], flush=True)
json.dump(tasks, open(os.path.join(W, "tasks.json"), "w", encoding="utf-8"))
print("tasks:", len(tasks), "| locations + trades saved to", W)
