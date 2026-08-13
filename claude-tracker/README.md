# Claude Tracker

A Steam-style playtime tracker for Claude Code usage — track your sessions, climb the ranks, and compete on a leaderboard.

![screenshot placeholder](./screenshot.png)

## Prerequisites

- Node.js 18+
- Python 3.8+
- pip

## Install

From the project root:

```bash
npm install
cd server && npm install && cd ..
```

## Running the backend

```bash
node server/index.js
```

The API starts on `http://localhost:3001` and creates `server/tracker.db` (SQLite) automatically on first run.

## Running the frontend

```bash
npm run dev
```

The app starts on `http://localhost:5173`. On first load you'll be prompted for a display name — a UUID is generated and both are stored in `localStorage`.

## Running the Python daemon (auto-tracker)

```bash
pip install psutil requests
python claude_tracker.py
```

On first run the daemon will ask for your name and the backend API URL (default `http://localhost:3001`), create a user via `POST /api/users`, and save the config to `~/.claude_tracker/config.json`.

The daemon polls every 5 seconds for a process named `claude`, `claude-code`, or with `claude` in its command line. When Claude Code disappears for more than 60 seconds, the session is considered over and is posted to the backend. Live status (session duration, total hours, current rank) prints to the terminal. Press `Ctrl+C` to stop — the in-progress session is saved before exit.

## Rank system

Ranks are based on cumulative tracked hours:

| Rank      | Hours |
|-----------|-------|
| Rookie    | 0     |
| Scripter  | 5     |
| Dev       | 20    |
| Hacker    | 50    |
| Pro       | 100   |
| Elite     | 250   |
| Legendary | 500   |
| God Mode  | 1000  |

The dashboard shows an XP-style progress bar toward your next rank based on total tracked hours.

## Screenshot

_Add a screenshot of the dashboard/leaderboard here._
