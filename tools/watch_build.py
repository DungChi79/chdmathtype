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


import subprocess

try:
    head_sha = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd="/home/hatch/workspace/chdmathtype-native",
        text=True).strip()
except Exception:
    head_sha = ""
print("following run for HEAD:", head_sha, flush=True)

deadline = time.time() + 30 * 60
run = {}
while time.time() < deadline:
    try:
        data = get(f"{API}/actions/runs?per_page=10")
        runs = data.get("workflow_runs") or []
        # Theo dõi đúng run của commit hiện tại; bỏ qua các run cũ (tránh
        # nhận nhầm run trước đó khi run mới chưa kịp xếp hàng).
        mine = [r for r in runs if r.get("head_sha") == head_sha] if head_sha else runs[:1]
        if mine:
            run = mine[0]
            print(f"run {run['id']}: status={run['status']} conclusion={run.get('conclusion')}", flush=True)
            if run["status"] == "completed":
                break
        else:
            print("waiting for run of HEAD to appear...", flush=True)
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
