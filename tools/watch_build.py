#!/usr/bin/env python3
"""Poll the public repo's GitHub Actions until the macOS build finishes,
then report the release assets (name, size, download URL)."""
import json
import time
import urllib.request

API = "https://api.github.com/repos/DungChi79/chdmathtype"


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "chd-build-watch"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


deadline = time.time() + 30 * 60
run = {}
while time.time() < deadline:
    try:
        data = get(f"{API}/actions/runs?per_page=3")
        runs = data.get("workflow_runs") or []
        if runs:
            run = runs[0]
            print(f"run {run['id']}: status={run['status']} conclusion={run.get('conclusion')}", flush=True)
            if run["status"] == "completed":
                break
    except Exception as e:
        print("poll error:", e, flush=True)
    time.sleep(45)

print("FINAL RUN:", json.dumps({k: run.get(k) for k in ("id", "status", "conclusion", "html_url", "name")}))
try:
    rels = get(f"{API}/releases?per_page=3")
    for rel in rels:
        print("RELEASE:", rel.get("tag_name"), rel.get("html_url"))
        for a in rel.get("assets", []):
            print("  ASSET:", a["name"], a["size"], a["browser_download_url"])
except Exception as e:
    print("release fetch error:", e)
