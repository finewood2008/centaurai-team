#!/usr/bin/env python3
"""
AionUi backend API helper.

Discovers the running CentaurAI Core REST API and exposes thin
wrappers for the operations this skill needs: assistants, skills, rules, avatar.

The backend port is dynamic (changes every launch) and is NOT written to a
file, so we discover it: list centaurai-core (with legacy aioncore fallback)
listening ports, then probe each one
for a working /api/assistants endpoint. Cross-platform (lsof on macOS/Linux,
netstat on Windows), with 13400 as a documented fallback.

Usage:
    python3 aionui_api.py discover
    python3 aionui_api.py get   /api/assistants
    python3 aionui_api.py post  /api/skills/import      '{"skill_path": "/abs/path"}'
    python3 aionui_api.py put   /api/assistants/<id>     '{"enabled_skills": ["x"]}'
    python3 aionui_api.py patch /api/assistants/<id>/state '{"enabled": false}'
    python3 aionui_api.py delete /api/skills/<name>

All commands print the JSON response (or the discovered base URL) to stdout.
Non-zero exit on failure.
"""
import json
import os
import subprocess
import sys
import urllib.request
import urllib.error


def _legacy_fallback_enabled():
    value = (os.environ.get("CENTAURAI_CORE_ALLOW_LEGACY_FALLBACK") or
             os.environ.get("AIONUI_BACKEND_ALLOW_LEGACY") or "")
    return value.strip().lower() in ("1", "true", "yes")


def _candidate_ports():
    ports = []
    seen = set()

    def add(p):
        if p not in seen:
            seen.add(p)
            ports.append(p)

    # macOS / Linux
    try:
        outputs = []
        process_names = ["centaurai-core"]
        if _legacy_fallback_enabled():
            process_names.append("aioncore")
        for process_name in process_names:
            outputs.append(subprocess.run(
                ["lsof", "-nP", "-iTCP", "-sTCP:LISTEN", "-a", "-c", process_name],
                capture_output=True, text=True, timeout=5,
            ).stdout)
        out = "\n".join(outputs)
        for line in out.splitlines():
            for tok in line.split():
                if tok.startswith("127.0.0.1:"):
                    try:
                        add(int(tok.split(":")[1]))
                    except ValueError:
                        pass
    except Exception:
        pass

    # Windows fallback
    if not ports:
        try:
            out = subprocess.run(["netstat", "-ano"], capture_output=True, text=True, timeout=5).stdout
            for line in out.splitlines():
                if "LISTENING" in line and "127.0.0.1:" in line:
                    try:
                        add(int(line.split("127.0.0.1:")[1].split()[0]))
                    except (ValueError, IndexError):
                        pass
        except Exception:
            pass

    add(13400)  # documented fallback
    return ports


def _probe(port):
    try:
        health = urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=2)
        identity = json.loads(health.read())
        if identity.get("status") != "ok":
            return False
        if identity.get("service") != "centaurai-core" and not _legacy_fallback_enabled():
            return False
        assistants = urllib.request.urlopen(f"http://127.0.0.1:{port}/api/assistants", timeout=2)
        return json.loads(assistants.read()).get("success") is True
    except Exception:
        return False


def discover():
    for p in _candidate_ports():
        if _probe(p):
            return f"http://127.0.0.1:{p}"
    raise SystemExit(
        "CentaurAI Core not found. Is the app running? "
        "Legacy aioncore requires CENTAURAI_CORE_ALLOW_LEGACY_FALLBACK=1."
    )


def request(method, path, body=None):
    base = discover()
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        base + path, data=data,
        headers={"Content-Type": "application/json"}, method=method.upper(),
    )
    try:
        r = urllib.request.urlopen(req, timeout=15)
        return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise SystemExit(f"HTTP {e.code}: {e.read().decode()}")


def main(argv):
    if not argv:
        print(__doc__)
        return 1
    cmd = argv[0].lower()
    if cmd == "discover":
        print(discover())
        return 0
    if cmd in ("get", "post", "put", "patch", "delete"):
        path = argv[1]
        body = json.loads(argv[2]) if len(argv) > 2 else None
        print(json.dumps(request(cmd, path, body), ensure_ascii=False, indent=2))
        return 0
    print(f"Unknown command: {cmd}")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
