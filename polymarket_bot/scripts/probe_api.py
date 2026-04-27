"""Probe https://api.polymarket.us to discover available endpoints and auth methods.

Usage:
    cd polymarket_bot
    python scripts/probe_api.py

Loads CLOB_API_KEY from .env (if present). Tries browser-style headers to bypass
CDN IP blocks that reject cloud/VPS requests.
"""
import json
import os
import sys
import urllib.error
import urllib.request
from typing import Optional

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

BASE_URL = "https://api.polymarket.us"

_BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Origin": "https://polymarket.com",
    "Referer": "https://polymarket.com/",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
}

_ROUTES = [
    "/",
    "/markets",
    "/v1/markets",
    "/events",
    "/v1/events",
    "/me",
    "/v1/me",
]


def _fetch(url: str, extra_headers: Optional[dict] = None) -> tuple[int, str]:
    headers = dict(_BROWSER_HEADERS)
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            return resp.status, body
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace") if exc.fp else ""
        return exc.code, body
    except Exception as exc:
        return 0, str(exc)


def _summarise(body: str, status: int) -> str:
    body = body.strip()
    if not body:
        return "(empty)"
    try:
        parsed = json.loads(body)
        if isinstance(parsed, list):
            return f"JSON list, {len(parsed)} items"
        if isinstance(parsed, dict):
            keys = list(parsed.keys())[:5]
            return "JSON {" + ", ".join(keys) + ("..." if len(parsed) > 5 else "") + "}"
    except json.JSONDecodeError:
        pass
    return body[:80].replace("\n", " ")


def main() -> None:
    api_key = os.getenv("CLOB_API_KEY", "").strip()
    key_display = (api_key[:8] + "...") if api_key else "(none)"

    print(f"Probing {BASE_URL}")
    print(f"API key: {key_display}")
    print("-" * 70)

    all_403 = True

    auth_variants: list[tuple[str, dict]] = [
        ("no auth", {}),
        ("Bearer", {"Authorization": f"Bearer {api_key}"} if api_key else {}),
        ("POLY-API-KEY", {"POLY-API-KEY": api_key} if api_key else {}),
    ]

    for route in _ROUTES:
        url = BASE_URL + route
        for auth_label, auth_headers in auth_variants:
            if not api_key and auth_label != "no auth":
                continue  # skip auth variants when no key available

            status, body = _fetch(url, auth_headers)
            summary = _summarise(body, status)

            tag = f"[{status}]" if status else "[ERR]"
            if status != 403:
                all_403 = False

            print(f"  {tag:<6} GET {route:<20} ({auth_label:<14}) -> {summary}")

        print()

    print("-" * 70)
    if all_403:
        print(
            "All routes blocked with 403 (CDN/WAF IP allowlist).\n"
            "Try running this script from your home machine or a different network.\n"
            "The API likely only accepts requests from US residential IPs or browsers."
        )
    else:
        print("Done. Routes above showing [200] are accessible from this machine.")
        print("Review the JSON structure to decide what to integrate into the bot.")


if __name__ == "__main__":
    main()
