#!/usr/bin/env bash
# webapp_smoke.sh — proves the N2 webapp is runnable end-to-end.
#
# Closes the gap toward cp4 ("subscriber opens webapp, takes the mock,
# completes it") by verifying the local webapp build can be started and
# serves the landing page + /auth page over HTTP.
#
# What it does:
#   1. Sources ODIS/.env for NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
#      (the same Supabase project the pipeline writes to; no new secrets introduced).
#   2. Runs `npm run build` if .next/BUILD_ID is missing or older than any source file
#      (keeps the test honest: a stale .next would lie).
#   3. Starts `next start` on a fixed port (3737) in the background.
#   4. Polls the landing page and /auth until they return HTTP 200, with a timeout.
#   5. Verifies the landing page body contains the "N2 Daily Mock Exam" h1.
#   6. Verifies the /auth page body contains the magic-link form fields
#      (email input + submit button label).
#   7. Kills the next start process and prints a PASS/FAIL summary.
#
# Exit codes:
#   0 — all checks passed
#   1 — env missing, build failed, server didn't start, or page check failed
#
# Reverse: delete this file. No state mutated (build artifacts are .next/ which
# is gitignored; ODIS/.env untouched; n2_mocks / n2_attempts untouched).

set -euo pipefail

WEBAPP_DIR="/Users/jacksonhemopo/projects/japanese-n2"
ODIS_ENV="/Users/jacksonhemopo/ODIS/.env"
PORT="${WEBAPP_SMOKE_PORT:-3737}"
LOG_FILE="$(mktemp -t webapp_smoke.XXXXXX.log)"
PID_FILE="$(mktemp -t webapp_smoke.XXXXXX.pid)"
TIMEOUT_SECONDS=60
POLL_INTERVAL=1

cleanup() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      sleep 0.5
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
  fi
  # Belt-and-suspenders: kill anything still on PORT
  if command -v lsof >/dev/null 2>&1; then
    local pids
    pids="$(lsof -ti :"$PORT" 2>/dev/null || true)"
    if [[ -n "$pids" ]]; then
      echo "$pids" | xargs -r kill -9 2>/dev/null || true
    fi
  fi
}
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
say()  { echo "  $*"; }

echo "webapp_smoke.sh — N2 webapp runnability check"
say "webapp dir: $WEBAPP_DIR"
say "ODIS env:  $ODIS_ENV"
say "port:      $PORT"

# --- 1. Source ODIS/.env for the two NEXT_PUBLIC_ Supabase values ------------
if [[ ! -f "$ODIS_ENV" ]]; then
  fail "ODIS/.env not found at $ODIS_ENV (cannot source public Supabase creds)"
fi
# grep non-comment lines, then key=value pull — keeps shell safe (no source).
# Strip surrounding whitespace (ODIS/.env has a trailing space on the URL line,
# which the pipeline's _load_env() masks via .strip() — same fix here so the
# webapp build doesn't blow up with `Invalid URL: "...supabase.co /auth/v1"`).
SUPABASE_URL="$(grep -E '^ODIS_SUPABASE_URL=' "$ODIS_ENV" | head -1 | cut -d= -f2- | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//' | tr -d '"' | tr -d "'")"
SUPABASE_ANON="$(grep -E '^ODIS_SUPABASE_ANON=' "$ODIS_ENV" | head -1 | cut -d= -f2- | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//' | tr -d '"' | tr -d "'")"
if [[ -z "$SUPABASE_URL" || -z "$SUPABASE_ANON" ]]; then
  fail "ODIS_SUPABASE_URL and/or ODIS_SUPABASE_ANON missing from $ODIS_ENV"
fi
export NEXT_PUBLIC_SUPABASE_URL="$SUPABASE_URL"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="$SUPABASE_ANON"
say "sourced NEXT_PUBLIC_SUPABASE_URL=${SUPABASE_URL:0:32}..."
say "sourced NEXT_PUBLIC_SUPABASE_ANON_KEY (${#SUPABASE_ANON} chars)"

# --- 2. (Re)build if .next/BUILD_ID is stale or missing -----------------------
cd "$WEBAPP_DIR"
if [[ ! -f ".next/BUILD_ID" ]] || \
   find app lib -type f \( -name "*.ts" -o -name "*.tsx" \) -newer ".next/BUILD_ID" -print -quit 2>/dev/null | grep -q .; then
  say ".next stale or missing — running npm run build"
  if ! npm run build >>"$LOG_FILE" 2>&1; then
    echo "--- npm run build output ---" >&2
    tail -40 "$LOG_FILE" >&2
    fail "npm run build failed"
  fi
  say "build OK"
else
  say ".next fresh — skipping rebuild"
fi

# --- 3. Start `next start` in background --------------------------------------
say "starting next start on port $PORT"
( PORT="$PORT" npm start >>"$LOG_FILE" 2>&1 & echo $! >"$PID_FILE" )

# --- 4. Wait for both pages to come up ----------------------------------------
ready=0
for ((i = 0; i < TIMEOUT_SECONDS; i += POLL_INTERVAL)); do
  if ! kill -0 "$(cat "$PID_FILE" 2>/dev/null)" 2>/dev/null; then
    echo "--- next start output ---" >&2
    tail -40 "$LOG_FILE" >&2
    fail "next start process exited prematurely"
  fi
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/" || true)"
  if [[ "$code" == "200" ]]; then
    ready=1
    break
  fi
  sleep "$POLL_INTERVAL"
done
if [[ "$ready" -ne 1 ]]; then
  echo "--- next start output ---" >&2
  tail -40 "$LOG_FILE" >&2
  fail "landing page did not return 200 within ${TIMEOUT_SECONDS}s"
fi
say "landing page returned 200 in ~${i}s"

# --- 5. Landing page content check --------------------------------------------
landing_body="$(curl -sf "http://localhost:$PORT/")"
if ! grep -q 'N2 Daily Mock Exam' <<<"$landing_body"; then
  echo "--- landing body (first 500 chars) ---" >&2
  head -c 500 <<<"$landing_body" >&2
  fail "landing page body missing expected 'N2 Daily Mock Exam' h1"
fi
say "landing page contains 'N2 Daily Mock Exam' h1"

# --- 6. /auth page content check ----------------------------------------------
auth_code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/auth")"
if [[ "$auth_code" != "200" ]]; then
  fail "/auth page returned $auth_code, expected 200"
fi
auth_body="$(curl -sf "http://localhost:$PORT/auth")"
if ! grep -q 'type="email"' <<<"$auth_body"; then
  fail "/auth page body missing <input type=\"email\"> field"
fi
if ! grep -q 'ログインリンクを送信' <<<"$auth_body" && ! grep -q 'signInWithOtp\|magic' <<<"$auth_body"; then
  fail "/auth page body missing magic-link submit button / hint"
fi
say "/auth page returned 200 and contains email input + magic-link CTA"

# --- 7. /today auth-gating check ---------------------------------------------
# Unauthenticated GET /today should 302/303 redirect to /auth.
today_code="$(curl -sf -o /dev/null -w '%{http_code}' "http://localhost:$PORT/today")"
today_location="$(curl -sf -I "http://localhost:$PORT/today" 2>/dev/null | grep -i '^Location:' | tr -d '\r' | sed 's/^[Ll]ocation: *//')"
if [[ "$today_code" != "302" && "$today_code" != "303" && "$today_code" != "307" ]]; then
  fail "/today returned $today_code, expected 302/303/307 (auth-gating redirect)"
fi
if [[ ! "$today_location" =~ /auth ]]; then
  fail "/today redirected to '$today_location', expected a path containing '/auth'"
fi
say "/today returned $today_code → Location: $today_location (auth-gating OK)"

# --- 8. /result/{date} auth-gating check ------------------------------------
# Unauthenticated GET /result/YYYY-MM-DD should 302/303 redirect to /auth.
# Use yesterday's date as a stable mock date that always exists.
MOCK_DATE="$(date -v-1d +%Y-%m-%d 2>/dev/null || echo "2026-07-13")"
result_code="$(curl -sf -o /dev/null -w '%{http_code}' "http://localhost:$PORT/result/$MOCK_DATE")"
result_location="$(curl -sf -I "http://localhost:$PORT/result/$MOCK_DATE" 2>/dev/null | grep -i '^Location:' | tr -d '\r' | sed 's/^[Ll]ocation: *//')"
if [[ "$result_code" != "302" && "$result_code" != "303" && "$result_code" != "307" ]]; then
  fail "/result/$MOCK_DATE returned $result_code, expected 302/303/307 (auth-gating redirect)"
fi
if [[ ! "$result_location" =~ /auth ]]; then
  fail "/result/$MOCK_DATE redirected to '$result_location', expected a path containing '/auth'"
fi
say "/result/$MOCK_DATE returned $result_code → Location: $result_location (auth-gating OK)"

# --- 9. Summary ----------------------------------------------------------------
echo "PASS — webapp_smoke.sh: build + next start + landing + /auth + /today redirect + /result redirect all green on :$PORT"
exit 0
