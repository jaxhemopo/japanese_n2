#!/usr/bin/env bash
# verify_supabase_role_split.sh — verifier for lib/supabase.ts role split.
#
# Pattern: mirrors verify_types_result.sh (webapp shell verifier). Three groups:
#   I.   file + scaffold           (5 invariants)
#   II.  parse + compile           (3 invariants)
#   III. role-split semantics      (6 invariants)
#
# All green required.
#
# Usage:
#   bash verify_supabase_role_split.sh
#   N2_ROOT=/custom/path bash verify_supabase_role_split.sh

set -euo pipefail

# ------------------------------------------------------------------ locate
N2_ROOT="${N2_ROOT:-$HOME/projects/japanese-n2}"
SUPABASE_FILE="$N2_ROOT/lib/supabase.ts"
BROWSER_FILE="$N2_ROOT/lib/supabase-client.ts"

if [[ ! -f "$SUPABASE_FILE" ]]; then
  echo "FAIL: $SUPABASE_FILE not found" >&2
  exit 1
fi
if [[ ! -f "$BROWSER_FILE" ]]; then
  echo "FAIL: $BROWSER_FILE not found" >&2
  exit 1
fi

# ------------------------------------------------------------------ counters
total=0
passed=0
failed=0
fail_log=""

check() {
  local name="$1"
  local result="$2"  # "PASS" or "FAIL"
  local detail="${3:-}"
  total=$((total + 1))
  if [[ "$result" == "PASS" ]]; then
    passed=$((passed + 1))
    printf "  \033[32m✓\033[0m  %s\n" "$name"
  else
    failed=$((failed + 1))
    fail_log+="  ✗ $name — $detail\n"
    printf "  \033[31m✗\033[0m  %s — %s\n" "$name" "$detail"
  fi
}

# ------------------------------------------------------------------ group I: file + scaffold
echo ""
echo "Group I: file + scaffold"

[[ -s "$SUPABASE_FILE" ]] && check "I-01: lib/supabase.ts exists and non-empty" PASS || check "I-01: lib/supabase.ts exists and non-empty" FAIL "empty or missing"
LOC=$(wc -l < "$SUPABASE_FILE" | tr -d ' ')
(( LOC <= 200 )) && check "I-02: LOC ≤ 200 ($LOC)" PASS || check "I-02: LOC ≤ 200 ($LOC)" FAIL "$LOC lines (cap 200)"

# header JSDoc mentions BOTH factories
grep -q 'createServerSupabase' "$SUPABASE_FILE" && \
  grep -q 'createServiceRoleSupabase' "$SUPABASE_FILE" && \
  check "I-03: header JSDoc names both factories" PASS || \
  check "I-03: header JSDoc names both factories" FAIL "header must mention both createServerSupabase + createServiceRoleSupabase"

# SUPABASE_SERVICE_ROLE_KEY referenced (not NEXT_PUBLIC_)
grep -q 'SUPABASE_SERVICE_ROLE_KEY' "$SUPABASE_FILE" && \
  check "I-04: references SUPABASE_SERVICE_ROLE_KEY" PASS || \
  check "I-04: references SUPABASE_SERVICE_ROLE_KEY" FAIL "no reference to SUPABASE_SERVICE_ROLE_KEY"

# Service-role env is NOT prefixed NEXT_PUBLIC_ (security invariant)
if grep -qE 'NEXT_PUBLIC_SUPABASE_SERVICE_ROLE' "$SUPABASE_FILE"; then
  check "I-05: service-role key is NOT NEXT_PUBLIC_ (security)" FAIL "service-role env var is exposed to browser — critical security bug"
else
  check "I-05: service-role key is NOT NEXT_PUBLIC_ (security)" PASS
fi

# ------------------------------------------------------------------ group II: parse + compile
echo ""
echo "Group II: parse + compile"

# II-01: tsc --noEmit (npm run type-check) passes against the whole project
if command -v npm >/dev/null 2>&1; then
  if (cd "$N2_ROOT" && npm run --silent type-check >/dev/null 2>&1); then
    check "II-01: tsc --noEmit (npm run type-check) passes" PASS
  else
    check "II-01: tsc --noEmit (npm run type-check) passes" FAIL "tsc reported errors — run 'npm run type-check' for details"
  fi
else
  check "II-01: tsc --noEmit (npm run type-check) passes" FAIL "npm not on PATH"
fi

# II-02: @supabase/supabase-js createClient is imported (service-role needs it)
grep -qE "from '@supabase/supabase-js'" "$SUPABASE_FILE" && \
  grep -qE '\bcreateClient\b' "$SUPABASE_FILE" && \
  check "II-02: createClient imported from @supabase/supabase-js" PASS || \
  check "II-02: createClient imported from @supabase/supabase-js" FAIL "createServiceRoleSupabase must use createClient from @supabase/supabase-js"

# II-03: service-role factory suppresses autoRefreshToken + persistSession
grep -q 'autoRefreshToken: false' "$SUPABASE_FILE" && \
  grep -q 'persistSession: false' "$SUPABASE_FILE" && \
  check "II-03: service-role disables autoRefreshToken + persistSession" PASS || \
  check "II-03: service-role disables autoRefreshToken + persistSession" FAIL "service-role client should be session-less"

# ------------------------------------------------------------------ group III: role-split semantics
echo ""
echo "Group III: role-split semantics"

# III-01: createServerSupabase is exported
grep -qE '^export function createServerSupabase' "$SUPABASE_FILE" && \
  check "III-01: createServerSupabase exported" PASS || \
  check "III-01: createServerSupabase exported" FAIL "no 'export function createServerSupabase' line"

# III-02: createServiceRoleSupabase is exported
grep -qE '^export function createServiceRoleSupabase' "$SUPABASE_FILE" && \
  check "III-02: createServiceRoleSupabase exported" PASS || \
  check "III-02: createServiceRoleSupabase exported" FAIL "no 'export function createServiceRoleSupabase' line"

# III-03: createBrowserSupabase is exported from browser-safe file
grep -qE "^export function createBrowserSupabase" "$BROWSER_FILE" && \
  check "III-03: createBrowserSupabase exported from supabase-client.ts" PASS || \
  check "III-03: createBrowserSupabase exported from supabase-client.ts" FAIL "browser client must live in lib/supabase-client.ts"

# III-04: server file does NOT export the browser client (separation of concerns)
if grep -qE '^export.*createBrowserSupabase' "$SUPABASE_FILE"; then
  check "III-04: server file does NOT export browser client" FAIL "createBrowserSupabase must not be exported from server file"
else
  check "III-04: server file does NOT export browser client" PASS
fi

# III-05: browser file does NOT export service-role client (security)
if grep -qE '^export.*createServiceRoleSupabase' "$BROWSER_FILE"; then
  check "III-05: browser file does NOT export service-role client" FAIL "createServiceRoleSupabase must not be exported from browser-safe file (security)"
else
  check "III-05: browser file does NOT export service-role client" PASS
fi

# III-06: JSDoc warns that service-role is server-only / must not leak client-side
if grep -A 20 'createServiceRoleSupabase' "$SUPABASE_FILE" | grep -qE "use client|client-side|RLS|row-level security"; then
  check "III-06: JSDoc warns service-role is server-only" PASS
else
  check "III-06: JSDoc warns service-role is server-only" FAIL "JSDoc on createServiceRoleSupabase must warn about server-only / RLS-bypass"
fi

# ------------------------------------------------------------------ summary
echo ""
echo "================================"
printf "  %d/%d passed" "$passed" "$total"
if (( failed > 0 )); then
  printf "  (%d FAILED)\n" "$failed"
  echo ""
  echo "Failures:"
  printf "%b" "$fail_log"
  echo ""
  echo "VERIFY FAILED"
  exit 1
fi
echo "  (all green)"
echo "VERIFY PASSED"
exit 0
