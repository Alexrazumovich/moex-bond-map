#!/usr/bin/env python3
"""
Fetches bond ratings from corpbonds.ru and writes ratings.json.
Python equivalent of fetch_ratings_corpbonds.ps1 — used by GitHub Actions.
"""
import json, sys
import requests

URL     = "https://corpbonds.ru/screener/bonds"
BODY    = {"market-sector": ["corp", "muni"], "currency": ["SUR"]}
HEADERS = {"Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest"}

print("Fetching ratings from corpbonds.ru...")

try:
    resp = requests.post(URL, json=BODY, headers=HEADERS, timeout=60)
    resp.raise_for_status()
    bonds = resp.json()
except Exception as e:
    print(f"Error: {e}", file=sys.stderr)
    sys.exit(1)

print(f"Received: {len(bonds)} bonds")

ratings, with_rating, no_rating = {}, 0, 0
for bond in bonds:
    isin = bond.get("isin")
    if not isin:
        continue
    names = [r["ratingName"] for r in bond.get("ratings", []) if r.get("ratingName")]
    if names:
        ratings[isin] = "; ".join(names)
        with_rating += 1
    else:
        no_rating += 1

sorted_ratings = dict(sorted(ratings.items()))
with open("ratings.json", "w", encoding="utf-8") as f:
    json.dump(sorted_ratings, f, ensure_ascii=False, indent=2)

print(f"With rating:    {with_rating}")
print(f"Without rating: {no_rating}")
print(f"Written to ratings.json: {len(sorted_ratings)} entries")
