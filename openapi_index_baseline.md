# verify_openapi_index.sh baseline — OpenAPI consolidation

**Date (UTC):** 2026-07-13T06:25:07Z
**Status:** PASS ✅
**Webapp dir:** `/Users/jacksonhemopo/projects/japanese-n2`
**OpenAPI dir:** `/Users/jacksonhemopo/projects/japanese-n2/openapi`
**Spec count:** 3

## Specs scanned
- `attempts.yaml` — openapi 3.0.4, version 0.1.0, title "N2 Daily Mock Exam — Attempts API"
- `auth.yaml` — openapi 3.0.4, version 0.1.0, title "N2 Daily Mock Exam — Auth API"
- `result.yaml` — openapi 3.0.4, version 0.1.0, title "N2 Daily Mock Exam — Result Page"

## Path sets
- `attempts.yaml` → /api/attempts,/api/attempts/{date}
- `auth.yaml` → /auth/callback
- `result.yaml` → /result/{date}

## Invariant groups
- I. file presence: 3/3 canonical specs present
- II. parse + structure: openapi 3.x + info.title + info.version + paths + schemas per spec
- III. version alignment: aligned (0.1.0)
- IV. title uniqueness: unique (N2 Daily Mock Exam — Attempts API,N2 Daily Mock Exam — Auth API,N2 Daily Mock Exam — Result Page)
- V. path-set disjointness: disjoint (4 paths)
- VI. path coverage: 4 total paths; 4 canonical surfaces (api/attempts + api/attempts/{date} + auth/callback + result/{date})
- VII. schema density: all specs ≥1 schema

## Result

**27/27 passed, 0 failed.**
