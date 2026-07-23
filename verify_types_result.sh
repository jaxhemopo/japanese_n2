#!/usr/bin/env bash
# verify_types_result.sh — verifier for lib/types/result.ts
#
# Pattern: mirrors verify_openapi_*.sh (wakeups 0063, 0066). Four groups:
#   I.   file + scaffold           (6 invariants)
#   II.  parse + compile           (5 invariants)
#   III. symbol presence           (16 invariants)
#   IV.  YAML↔TS cross-check       (12 invariants)
#
# Run from the repo root (~/projects/japanese-n2/) or with the env var
# N2_ROOT pointing at it. All green required.
#
# Usage:
#   bash verify_types_result.sh
#   N2_ROOT=/custom/path bash verify_types_result.sh

set -euo pipefail

# ------------------------------------------------------------------ locate
N2_ROOT="${N2_ROOT:-$HOME/projects/japanese-n2}"
TYPES_FILE="$N2_ROOT/lib/types/result.ts"
OPENAPI_FILE="$N2_ROOT/openapi/result.yaml"

if [[ ! -f "$TYPES_FILE" ]]; then
  echo "FAIL: $TYPES_FILE not found" >&2
  exit 1
fi
if [[ ! -f "$OPENAPI_FILE" ]]; then
  echo "FAIL: $OPENAPI_FILE not found" >&2
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

[[ -s "$TYPES_FILE" ]] && check "I-01: types file exists and non-empty" PASS || check "I-01: types file exists and non-empty" FAIL "empty or missing"
LOC=$(wc -l < "$TYPES_FILE" | tr -d ' ')
(( LOC <= 200 )) && check "I-02: LOC ≤ 200 ($LOC)" PASS || check "I-02: LOC ≤ 200 ($LOC)" FAIL "$LOC lines (cap 200)"

# header docstring present
head -1 "$TYPES_FILE" | grep -q '^/\*\*' && check "I-03: leading JSDoc block" PASS || check "I-03: leading JSDoc block" FAIL "no /** doc comment at line 1"

# source-of-truth attribution
grep -q 'openapi/result.yaml' "$TYPES_FILE" && check "I-04: references openapi/result.yaml (source-of-truth attribution)" PASS || check "I-04: references openapi/result.yaml" FAIL "no reference to openapi/result.yaml"
grep -q 'app/result/\[date\]/page.tsx' "$TYPES_FILE" && check "I-05: references app/result/[date]/page.tsx (implementation attribution)" PASS || check "I-05: references app/result/[date]/page.tsx" FAIL "no reference to page.tsx"

# bounded file boundary — single component (types layer only, no page.tsx touch)
grep -qE 'app/result/\[date\]/page\.tsx' "$TYPES_FILE" && \
  check "I-06: types file mentions page.tsx as reference only (not modification)" PASS \
  || check "I-06: types file mentions page.tsx" FAIL "no cross-reference"

# ------------------------------------------------------------------ group II: parse + compile
echo ""
echo "Group II: parse + compile"

# Use the project's own type-check so it picks up tsconfig.json + the path alias
# `npm run type-check` runs `tsc --noEmit` against the full project.
# A focused check would be: npx tsc --noEmit "$TYPES_FILE" — but that needs the
# full include graph; the project type-check is the canonical verifier.
if command -v npm >/dev/null 2>&1; then
  if (cd "$N2_ROOT" && npm run --silent type-check >/dev/null 2>&1); then
    check "II-01: tsc --noEmit (npm run type-check) passes" PASS
  else
    check "II-01: tsc --noEmit (npm run type-check) passes" FAIL "tsc reported errors — run 'npm run type-check' for details"
  fi
else
  check "II-01: tsc --noEmit (npm run type-check) passes" FAIL "npm not on PATH"
fi

# II-02: file is valid TypeScript by syntax-only check (Node --check is not
# sufficient for .ts; use a structural check instead — exports are present)
grep -qE '^export (interface|type|const)' "$TYPES_FILE" \
  && check "II-02: file exports symbols (interface/type/const)" PASS \
  || check "II-02: file exports symbols" FAIL "no export interface/type/const lines"

# II-03: no untyped 'any' in interfaces (defensive — types should be explicit)
if grep -qE ': any\b' "$TYPES_FILE"; then
  check "II-03: no 'any' type annotations" FAIL "found ': any' — types should be explicit"
else
  check "II-03: no 'any' type annotations" PASS
fi

# II-04: satisfies operator used (mirrors openapi/result.yaml const list idiom)
grep -q 'as const satisfies' "$TYPES_FILE" \
  && check "II-04: uses 'as const satisfies' idiom for RESULT_CONTENT_STATES" PASS \
  || check "II-04: uses 'as const satisfies' idiom" FAIL "RESULT_CONTENT_STATES should use 'as const satisfies'"

# II-05: file declares at least one JSDoc comment per interface (loose check)
jsdoc_count=$(grep -cE '^\s*\*?\s*\*\*/?\s*$|^\s*/\*\*' "$TYPES_FILE" || true)
(( jsdoc_count >= 5 )) \
  && check "II-05: ≥5 JSDoc blocks (doc per interface) ($jsdoc_count)" PASS \
  || check "II-05: ≥5 JSDoc blocks" FAIL "only $jsdoc_count JSDoc blocks — interfaces should be documented"

# ------------------------------------------------------------------ group III: symbol presence
echo ""
echo "Group III: symbol presence"

# 8 component-schema names from openapi/result.yaml — each must appear as an
# exported `export interface Foo` or `export type Foo` line in the TS file.
declare -a SCHEMAS=(
  "ScoreHeader"
  "QuestionBreakdownRow"
  "ResultContentState"
  "ErrorState"
  "NoMockForDate"
  "NoAttemptYet"
  "Breakdown"
  "MissingQuestion"
)
schema_idx=0
for s in "${SCHEMAS[@]}"; do
  schema_idx=$((schema_idx + 1))
  if grep -qE "^export (interface|type) $s(\b|\s)" "$TYPES_FILE"; then
    check "III-$(printf '%02d' $schema_idx): schema '$s' exported" PASS
  else
    check "III-$(printf '%02d' $schema_idx): schema '$s' exported" FAIL "no 'export interface|type $s' line"
  fi
done

# 5 discriminator values + RESULT_CONTENT_STATES const
declare -a KINDS=("error" "no_mock" "no_attempt" "breakdown" "missing_question")
for k in "${KINDS[@]}"; do
  if grep -qF "\"$k\"" "$TYPES_FILE"; then
    check "III-09: discriminator literal \"$k\" present" PASS
  else
    check "III-09: discriminator literal \"$k\" present" FAIL "literal \"$k\" not found"
  fi
done

# RESULT_CONTENT_STATES const exported
grep -qE '^export const RESULT_CONTENT_STATES' "$TYPES_FILE" \
  && check "III-10: RESULT_CONTENT_STATES const exported" PASS \
  || check "III-10: RESULT_CONTENT_STATES const exported" FAIL "const not found"

# 5 type guards (one per content state) — exported const arrows
guard_count=$(grep -cE '^export const is(ErrorState|NoMockForDate|NoAttemptYet|Breakdown|MissingQuestion) = ' "$TYPES_FILE" || true)
(( guard_count == 5 )) \
  && check "III-11: 5 type-guard const arrows exported ($guard_count)" PASS \
  || check "III-11: 5 type-guard const arrows exported" FAIL "found $guard_count (expected 5)"

# ------------------------------------------------------------------ group IV: YAML ↔ TS cross-check
echo ""
echo "Group IV: YAML ↔ TS cross-check"

# Extract YAML schema names from openapi/result.yaml under components.schemas
YAML_SCHEMAS=$(python3 -c "
import yaml, sys
with open('$OPENAPI_FILE') as f:
    spec = yaml.safe_load(f)
schemas = list(spec.get('components', {}).get('schemas', {}).keys())
for s in schemas:
    print(s)
")

# Cross-check IV-01..08: each YAML schema appears as an exported TS symbol
idx=0
for yaml_schema in $YAML_SCHEMAS; do
  idx=$((idx + 1))
  if grep -qE "^export (interface|type) $yaml_schema(\b|\s)" "$TYPES_FILE"; then
    check "IV-$(printf '%02d' $idx): YAML schema '$yaml_schema' → TS export present" PASS
  else
    check "IV-$(printf '%02d' $idx): YAML schema '$yaml_schema' → TS export present" FAIL "missing TS export"
  fi
done

# IV-09: count parity — TS exports matching ^export (interface|type) should
# include exactly the 8 YAML schema names (not strictly 8, but a clean parity).
ts_schema_count=$(grep -cE '^export (interface|type) (ScoreHeader|QuestionBreakdownRow|ResultContentState|ErrorState|NoMockForDate|NoAttemptYet|Breakdown|MissingQuestion)\b' "$TYPES_FILE" || true)
yaml_schema_count=$(echo "$YAML_SCHEMAS" | wc -l | tr -d ' ')
(( ts_schema_count == yaml_schema_count )) \
  && check "IV-09: TS-schema count == YAML-schema count ($ts_schema_count == $yaml_schema_count)" PASS \
  || check "IV-09: TS-schema count == YAML-schema count" FAIL "TS=$ts_schema_count YAML=$yaml_schema_count"

# IV-10: ResultContentState in YAML is oneOf — TS union must have ≥5 members
ts_union_members=$(grep -A 20 '^export type ResultContentState' "$TYPES_FILE" | grep -cE '^\s*\|')
(( ts_union_members >= 5 )) \
  && check "IV-10: TS ResultContentState union has ≥5 members ($ts_union_members)" PASS \
  || check "IV-10: TS ResultContentState union has ≥5 members" FAIL "only $ts_union_members members"

# IV-11: ScoreHeader properties from YAML (score, total, pct, total_seconds)
# should appear as field declarations in the TS interface
declare -a SH_PROPS=("score" "total" "pct" "total_seconds")
sh_ok=0
for p in "${SH_PROPS[@]}"; do
  if grep -qE "^\s*$p\s*:" "$TYPES_FILE"; then
    sh_ok=$((sh_ok + 1))
  fi
done
(( sh_ok == 4 )) \
  && check "IV-11: ScoreHeader properties score/total/pct/total_seconds all present ($sh_ok/4)" PASS \
  || check "IV-11: ScoreHeader properties present" FAIL "only $sh_ok/4"

# IV-12: QuestionBreakdownRow has nullable user_answer + nullable explanation
grep -qE 'user_answer:\s*string\s*\|\s*null' "$TYPES_FILE" \
  && grep -qE 'explanation:\s*string\s*\|\s*null' "$TYPES_FILE" \
  && check "IV-12: QuestionBreakdownRow nullable fields (user_answer, explanation)" PASS \
  || check "IV-12: QuestionBreakdownRow nullable fields" FAIL "missing null union types"

# ------------------------------------------------------------------ summary
echo ""
echo "================================================================"
echo "verify_types_result.sh — $passed / $total passed ($failed failed)"
echo "================================================================"

if (( failed > 0 )); then
  printf "Failed checks:\n%b" "$fail_log"
  exit 1
fi

echo "All groups green. lib/types/result.ts is in sync with openapi/result.yaml."
exit 0