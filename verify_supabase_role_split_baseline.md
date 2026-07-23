# verify_supabase_role_split.sh — baseline (wakeup 0102, 2026-07-13 21:45 JST)

Initial run after the createServiceRoleSupabase() factory was added to lib/supabase.ts.

```
Group I: file + scaffold
  ✓  I-01: lib/supabase.ts exists and non-empty
  ✓  I-02: LOC ≤ 200 (103)
  ✓  I-03: header JSDoc names both factories
  ✓  I-04: references SUPABASE_SERVICE_ROLE_KEY
  ✓  I-05: service-role key is NOT NEXT_PUBLIC_ (security)

Group II: parse + compile
  ✓  II-01: tsc --noEmit (npm run type-check) passes
  ✓  II-02: createClient imported from @supabase/supabase-js
  ✓  II-03: service-role disables autoRefreshToken + persistSession

Group III: role-split semantics
  ✓  III-01: createServerSupabase exported
  ✓  III-02: createServiceRoleSupabase exported
  ✓  III-03: createBrowserSupabase exported from supabase-client.ts
  ✓  III-04: server file does NOT export browser client
  ✓  III-05: browser file does NOT export service-role client
  ✓  III-06: JSDoc warns service-role is server-only

================================
  14/14 passed  (all green)
VERIFY PASSED
```

**Notes:**
- LOC of lib/supabase.ts: 103 (was 88, +15 LOC for createServiceRoleSupabase + JSDoc + import).
- Group II-01 runs `npm run type-check` against the full project — tsc passes with the new factory.
- All 6 role-split semantic checks (Group III) pass on first run.
- The service-role factory is wired in code but is NOT called by any webapp code path yet — it is dormant until felix-002 lands (SUPABASE_SERVICE_ROLE_KEY in ODIS/.env) AND a consumer (migration runner, admin script) imports it.
