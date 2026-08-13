#!/usr/bin/env python3
"""Claude Code time-tracking daemon.

Polls running processes for Claude Code activity and reports completed
sessions to the claude-tracker backend API.
"""

import json
import os
import signal
import sys
import time
from datetime import datetime, timedelta

try:
    import psutil
except ImportError:
    print("Missing dependency 'psutil'. Install with: pip install psutil requests")
    sys.exit(1)

try:
    import requests
except ImportError:
    print("Missing dependency 'requests'. Install with: pip install psutil requests")
    sys.exit(1)

CONFIG_DIR = os.path.join(os.path.expanduser("~"), ".claude_tracker")
CONFIG_PATH = os.path.join(CONFIG_DIR, "config.json")

POLL_INTERVAL_SECONDS = 5
GRACE_PERIOD_SECONDS = 60

RANKS = [
    ("Rookie", 0),
    ("Scripter", 5),
    ("Dev", 20),
    ("Hacker", 50),
    ("Pro", 100),
    ("Elite", 250),
    ("Legendary", 500),
    ("God Mode", 1000),
]


def current_rank(total_hours):
    rank = RANKS[0][0]
    for name, hours in RANKS:
        if total_hours >= hours:
            rank = name
    return rank


def load_config():
    if not os.path.exists(CONFIG_PATH):
        return None
    with open(CONFIG_PATH, "r") as f:
        return json.load(f)


def save_config(config):
    os.makedirs(CONFIG_DIR, exist_ok=True)
    with open(CONFIG_PATH, "w") as f:
        json.dump(config, f, indent=2)


def first_run_setup():
    print("=== Claude Tracker Daemon: first-time setup ===")
    name = input("Enter your display name: ").strip()
    while not name:
        name = input("Display name cannot be empty. Enter your display name: ").strip()

    default_url = "http://localhost:3001"
    api_url = input(f"Enter API URL [{default_url}]: ").strip() or default_url
    api_url = api_url.rstrip("/")

    import uuid

    user_id = str(uuid.uuid4())

    try:
        resp = requests.post(
            f"{api_url}/api/users", json={"id": user_id, "name": name}, timeout=10
        )
        resp.raise_for_status()
    except requests.RequestException as exc:
        print(f"Failed to create user on backend: {exc}")
        sys.exit(1)

    config = {"userId": user_id, "name": name, "apiUrl": api_url}
    save_config(config)
    print(f"Setup complete. Config saved to {CONFIG_PATH}")
    return config


def is_claude_process(proc):
    try:
        name = (proc.name() or "").lower()
        if "claude" in name:
            return True
        cmdline = proc.cmdline()
        if cmdline and any("claude" in part.lower() for part in cmdline):
            return True
    except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
        return False
    return False


def any_claude_running():
    for proc in psutil.process_iter(["pid", "name"]):
        if is_claude_process(proc):
            return True
    return False


def fetch_total_seconds(api_url, user_id):
    try:
        resp = requests.get(f"{api_url}/api/user/{user_id}", timeout=10)
        if resp.status_code == 404:
            return 0
        resp.raise_for_status()
        return resp.json().get("total_seconds", 0)
    except requests.RequestException:
        return None


def post_session(api_url, user_id, duration_seconds):
    try:
        resp = requests.post(
            f"{api_url}/api/sessions",
            json={"userId": user_id, "durationSeconds": int(duration_seconds)},
            timeout=10,
        )
        resp.raise_for_status()
        return True
    except requests.RequestException as exc:
        print(f"\nFailed to save session: {exc}")
        return False


class Tracker:
    def __init__(self, config):
        self.config = config
        self.session_start = None
        self.last_seen = None
        self.running = True

    def status_line(self, active):
        elapsed = 0
        if self.session_start:
            elapsed = (datetime.now() - self.session_start).total_seconds()

        total_seconds = fetch_total_seconds(self.config["apiUrl"], self.config["userId"])
        total_hours = (total_seconds or 0) / 3600
        rank = current_rank(total_hours)

        state = "ACTIVE" if active else "IDLE"
        h, rem = divmod(int(elapsed), 3600)
        m, s = divmod(rem, 60)
        sys.stdout.write(
            f"\r[{state}] session {h:02d}:{m:02d}:{s:02d} | "
            f"total {total_hours:.1f}h | rank {rank}      "
        )
        sys.stdout.flush()

    def end_session(self):
        if self.session_start is None:
            return
        duration = (self.last_seen - self.session_start).total_seconds()
        self.session_start = None
        self.last_seen = None
        if duration >= 1:
            ok = post_session(self.config["apiUrl"], self.config["userId"], duration)
            if ok:
                print(f"\nSession saved: {timedelta(seconds=int(duration))}")

    def handle_interrupt(self, signum, frame):
        print("\nShutting down, saving partial session...")
        self.running = False
        self.end_session()
        print("Goodbye.")
        sys.exit(0)

    def run(self):
        signal.signal(signal.SIGINT, self.handle_interrupt)
        signal.signal(signal.SIGTERM, self.handle_interrupt)

        print(f"Tracking Claude Code activity for '{self.config['name']}'...")
        print("Press Ctrl+C to stop.\n")

        while self.running:
            active = any_claude_running()
            now = datetime.now()

            if active:
                if self.session_start is None:
                    self.session_start = now
                self.last_seen = now
            else:
                if self.session_start is not None:
                    gap = (now - self.last_seen).total_seconds()
                    if gap > GRACE_PERIOD_SECONDS:
                        self.end_session()

            self.status_line(active)
            time.sleep(POLL_INTERVAL_SECONDS)


def main():
    config = load_config()
    if config is None:
        config = first_run_setup()

    tracker = Tracker(config)
    tracker.run()


if __name__ == "__main__":
    main()
