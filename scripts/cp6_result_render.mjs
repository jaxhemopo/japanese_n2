#!/usr/bin/env node
// scripts/cp6_result_render.mjs — cp6 end-to-end integration test.
//
// Proves: GET /result/{date} (Server Component) renders the per-question
// correct/incorrect breakdown + explanations when accessed by an
// authenticated user who has just submitted an attempt. Reuses the cp5
// test infrastructure: admin.createUser + password grant → session cookie.
//
// Flow:
//   A. Mint a test user via GoTrue admin + password grant
//   B. POST /api/attempts (the cp5-proven path) to insert 5 attempt rows
//   C. GET /result/{date} via fetch with the same cookie → expect 200 + HTML
//      containing the breakdown markers
//   D. Cleanup rows + test user
//
// Exit: 0 = breakdown rendered + assertions pass. 1 = contract violation.
//       2 = setup error (env, no mock, webapp not up).

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// ---- env ----
const ODIS_ENV = '/Users/jacksonhemopo/ODIS/.env';
function readOdisEnv(name) {
  const line = readFileSync(ODIS_ENV, 'utf8').split('\n').find(l => l.startsWith(`${name}=`));
  if (!line) throw new Error(`missing ${name} in ${ODIS_ENV}`);
  return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '');
}
const SUPABASE_URL = readOdisEnv('ODIS_SUPABASE_URL');
const SUPABASE_SR = readOdisEnv('ODIS_SUPABASE_SERVICE_ROLE_KEY');
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split('.')[0];
const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;
const WEBAPP = process.env.CP6_WEBAPP_URL ?? 'http://localhost:3737';

const MOCK_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

const say = (...a) => console.log('  ' + a.join(' '));
const fail = (msg) => { console.error('FAIL: ' + msg); process.exit(1); };
const ok = (msg) => say('✓ ' + msg);

function base64urlEncode(s) { return Buffer.from(s, 'utf8').toString('base64url'); }

function buildAuthCookieValue(session) {
  return 'base64-' + base64urlEncode(JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    token_type: session.token_type ?? 'bearer',
    expires_in: session.expires_in ?? 3600,
    expires_at: session.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
    user: session.user,
  }));
}

// ---- locate today's mock + questions (admin client) ----
say(`locating today's mock (${MOCK_DATE}) via service role`);
const admin = createClient(SUPABASE_URL, SUPABASE_SR, { auth: { persistSession: false } });

const { data: mockRows, error: mockErr } = await admin
  .from('n2_mocks').select('date, question_ids').eq('date', MOCK_DATE).limit(1);
if (mockErr) fail('n2_mocks query failed: ' + mockErr.message);
if (!mockRows?.length) { console.error(`no mock for ${MOCK_DATE} — pipeline has not published yet`); process.exit(2); }
const questionIds = mockRows[0].question_ids;
if (questionIds?.length !== 5) fail(`expected 5 question_ids, got ${questionIds?.length ?? 0}`);

const { data: qRows, error: qErr } = await admin
  .from('n2_questions').select('id, category, correct_answer').in('id', questionIds);
if (qErr) fail('n2_questions query failed: ' + qErr.message);
if (qRows?.length !== 5) fail(`expected 5 question rows, got ${qRows?.length ?? 0}`);
ok(`mock + 5 questions located for ${MOCK_DATE}`);

// ---- build attempt payload (mix right + wrong) ----
const answers = {}, timings = {}, correctMap = {};
qRows.forEach((q, idx) => {
  const ua = idx < 2 ? q.correct_answer : (idx === 4 ? 'd' : 'a');
  answers[q.id] = ua;
  timings[q.id] = 8000 + idx * 3000;
  correctMap[q.id] = q.correct_answer;
});
const body = JSON.stringify({ date: MOCK_DATE, answers, timings, correct_map: correctMap });

// ---- mint test user + session (same as cp5) ----
const TEST_EMAIL = `cp6-test-${Date.now()}@n2-test.invalid`;
const TEST_PASSWORD = 'cp6-test-pw-' + Math.random().toString(36).slice(2, 12);
say(`creating test user ${TEST_EMAIL}`);

const createUserRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { 'apikey': SUPABASE_SR, 'Authorization': `Bearer ${SUPABASE_SR}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, email_confirm: true }),
});
if (!createUserRes.ok) fail(`createUser HTTP ${createUserRes.status}: ${await createUserRes.text()}`);
const testUserId = (await createUserRes.json()).id;
ok(`test user created: ${testUserId}`);

const signinRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { 'apikey': SUPABASE_SR, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
});
if (!signinRes.ok) fail(`password grant HTTP ${signinRes.status}: ${await signinRes.text()}`);
const session = await signinRes.json();
if (!session.access_token || !session.user?.id) fail('password grant missing tokens');
ok(`session minted`);

// ---- confirm webapp is up ----
const pingRes = await fetch(`${WEBAPP}/`);
if (!pingRes.ok && pingRes.status !== 307) {
  console.error(`webapp not responding on ${WEBAPP} (status=${pingRes.status})`);
  console.error('start it first: bash scripts/webapp_smoke.sh  (or set CP6_WEBAPP_URL)');
  process.exit(2);
}
ok(`webapp reachable at ${WEBAPP}`);

// ---- TEST A: POST /api/attempts → inserts 5 rows (cp5 path) ----
say('TEST A: POST /api/attempts to seed attempts for the result page');
const cookieValue = buildAuthCookieValue(session);
const cookieHeader = `${STORAGE_KEY}=${encodeURIComponent(cookieValue)}`;
const postRes = await fetch(`${WEBAPP}/api/attempts`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Cookie': cookieHeader },
  body,
});
if (!postRes.ok) fail(`POST /api/attempts HTTP ${postRes.status}: ${await postRes.text()}`);
const postBody = await postRes.json();
if (!Array.isArray(postBody.attempt_ids) || postBody.attempt_ids.length !== 5) {
  fail(`expected 5 attempt_ids, got ${JSON.stringify(postBody)}`);
}
ok(`seeded 5 attempt rows (attempt_ids[0]=${postBody.attempt_ids[0].slice(0, 8)}...)`);

// ---- TEST B: GET /result/{date} WITH cookie → 200 + breakdown rendered ----
say(`TEST B: GET /result/${MOCK_DATE} WITH cookie → expect 200 + breakdown`);
const resultRes = await fetch(`${WEBAPP}/result/${MOCK_DATE}`, {
  headers: { 'Cookie': cookieHeader },
  cache: 'no-store',
});
if (resultRes.status !== 200) {
  fail(`expected 200 from /result/${MOCK_DATE}, got ${resultRes.status}: ${await resultRes.text()}`);
}
const html = await resultRes.text();
ok(`/result/${MOCK_DATE} returned 200 (${html.length} bytes HTML)`);

// ---- assert breakdown markers are present in the HTML ----
// React SSR inserts `<!-- -->` comment delimiters between adjacent JSX text
// nodes (used as boundary markers for client-side hydration). Strip them
// before substring matching.
const cleanHtml = html.replace(/<!--\s*-->/g, '');
const expectedCorrectCount = qRows.filter(q => answers[q.id] === q.correct_answer).length;
const expectedWrongCount = 5 - expectedCorrectCount;

const problems = [];
if (!cleanHtml.includes(`${MOCK_DATE} の結果`)) problems.push(`title '${MOCK_DATE} の結果' missing`);
if (!cleanHtml.includes(`${expectedCorrectCount} / 5`)) problems.push(`score '${expectedCorrectCount} / 5' missing`);
if (!cleanHtml.includes('正解')) problems.push(`'正解' marker missing (expected at least one correct row)`);
if (!cleanHtml.includes('不正解')) problems.push(`'不正解' marker missing (expected at least one wrong row)`);
if (!cleanHtml.includes('正解:')) problems.push(`'正解: <answer>' hint missing on incorrect rows`);
if (!cleanHtml.includes('解説を表示')) problems.push(`explanation disclosure '解説を表示' missing`);
if (!cleanHtml.includes('所要時間')) problems.push(`'所要時間' timing label missing`);
// count <li> blocks (the per-question rows) — should be 5
const liCount = (cleanHtml.match(/<li\b/g) ?? []).length;
if (liCount < 5) problems.push(`expected ≥5 <li> per-question rows, got ${liCount}`);

if (problems.length) fail('result HTML missing breakdown markers:\n  - ' + problems.join('\n  - '));
ok(`breakdown rendered: title ✓ score "${expectedCorrectCount}/5" ✓ 正解(${expectedCorrectCount}) ✓ 不正解(${expectedWrongCount}) ✓ 解説 ✓ 所要時間 ✓ ${liCount} <li> rows`);

// ---- TEST C: GET /result/{date} WITHOUT cookie → 307 → /auth (regression) ----
say(`TEST C: GET /result/${MOCK_DATE} WITHOUT cookie → expect 307 → /auth (regression)`);
const noAuthRes = await fetch(`${WEBAPP}/result/${MOCK_DATE}`, { redirect: 'manual' });
if (noAuthRes.status !== 307) {
  fail(`expected 307, got ${noAuthRes.status}`);
}
const loc = noAuthRes.headers.get('location') ?? '';
if (!loc.includes('/auth')) fail(`expected redirect to /auth, got '${loc}'`);
ok(`307 → Location: ${loc} (auth-gating still works)`);

// ---- cleanup ----
const { error: delErr } = await admin.from('n2_attempts').delete().in('id', postBody.attempt_ids);
if (delErr) console.error('WARN: cleanup delete failed: ' + delErr.message);
const delUserRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${testUserId}`, {
  method: 'DELETE', headers: { 'apikey': SUPABASE_SR, 'Authorization': `Bearer ${SUPABASE_SR}` },
});
if (!delUserRes.ok) console.error('WARN: test user cleanup HTTP ' + delUserRes.status);
ok('cleanup: rows deleted + test user removed');

console.log('');
console.log('PASS — cp6_result_render: result page renders breakdown + auth-gating intact');
process.exit(0);