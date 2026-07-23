#!/usr/bin/env python3
"""Lighthouse scanner for N2 Daily Mock Exam (japanese-n2.vercel.app).
Wraps `npx lighthouse@12` with the Chrome path, parses JSON, emits scores +
failing audits + Core Web Vitals. Driven by the measured-audit skill.

Usage: python3 .lh-scan.py [mobile|desktop]
"""
import json, os, subprocess, sys, time
from pathlib import Path

URL = "https://japanese-n2.vercel.app"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
OUT_DIR = Path(__file__).parent

def run_lh(form_factor):
    flags = ["--quiet", "--chrome-flags=--headless --no-sandbox"]
    if form_factor == "desktop":
        flags += ["--form-factor=desktop",
                  "--screenEmulation.mobile=false",
                  "--screenEmulation.width=1440",
                  "--screenEmulation.height=900",
                  "--screenEmulation.deviceScaleFactor=1",
                  "--throttling.cpuSlowdownMultiplier=1"]
    json_path = OUT_DIR / f".lh-latest-{form_factor}.json"
    cmd = ["npx", "--yes", "lighthouse@12", URL, *flags,
           "--output=json", "--output-path=" + str(json_path),
           "--only-categories=performance,accessibility,best-practices,seo",
           "--max-wait-for-load=45000"]
    env = os.environ.copy(); env["CHROME_PATH"] = CHROME
    res = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=240)
    if res.returncode != 0:
        print("LIGHTHOUSE FAILED:", res.stderr[-2000:], file=sys.stderr); sys.exit(1)
    return json.load(open(json_path))

def main():
    ff = sys.argv[1] if len(sys.argv) > 1 else "mobile"
    d = run_lh(ff)
    print(f"## Lighthouse scan ({ff}) — {time.strftime('%Y-%m-%d %H:%M JST')}")
    print("\n### Scores")
    for k in ("performance","accessibility","best-practices","seo"):
        s = d["categories"][k]["score"]
        score = int(s*100) if s is not None else "n/a"
        marker = "🟢" if s is not None and s >= 0.95 else ("🟡" if s is not None and s >= 0.85 else "🔴")
        print(f"- {marker} {k:18s} {score}")
    print("\n### Core Web Vitals")
    for k, label in [("largest-contentful-paint","LCP"),
                     ("cumulative-layout-shift","CLS"),
                     ("total-blocking-time","TBT"),
                     ("first-contentful-paint","FCP"),
                     ("speed-index","Speed Index")]:
        a = d["audits"].get(k, {})
        v = a.get("numericValue"); unit = a.get("numericUnit","")
        if v is None: continue
        v_str = f"{int(v)} ms" if unit == "millisecond" else (f"{v:.3f}" if unit == "unitless" else f"{v:.0f} {unit}")
        print(f"  {label:12s} {v_str}  (score={a.get('score')})")
    print("\n### Failing audits")
    has_fail = False
    for cat in ("performance","accessibility","best-practices","seo"):
        for ref in d["categories"][cat]["auditRefs"]:
            audit = d["audits"][ref["id"]]
            score = audit.get("score")
            if score is None or score >= 1: continue
            has_fail = True
            snippet = ""
            items = audit.get("details", {}).get("items", [])
            if items:
                node = items[0].get("node", {}) if isinstance(items[0], dict) else {}
                snippet = node.get("selector") or (node.get("snippet","")[:160] if isinstance(node.get("snippet"), str) else "")
            line = f"- [{cat[:4].upper()}] {ref['id']}: {audit['title']}"
            if snippet: line += f"\n    → {snippet}"
            print(line)
    if not has_fail: print("- (none — all audits pass)")

if __name__ == "__main__":
    main()
