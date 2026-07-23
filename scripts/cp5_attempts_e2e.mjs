#!/usr/bin/env node
// scripts/cp5_attempts_e2e.mjs — cp5 end-to-end integration test.
//
// Proves: POST /api/attempts (a) returns 401 without auth, (b) with a real
// Supabase session cookie inserts 5 per-question rows into n2_attempts, and
// (c) those rows match what we sent (user_id, question_id, user_answer,
// time_seconds, correct, challenge_id=null). Cleans up rows + test user.
//
// Reverse: nothing persistent left behind.
//
// Exit: 0 = both sub-tests pass + readback matches. 1 = contract violation.
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
const WEBAPP = process.env.CP5_WEBAPP_URL ?? 'http://localhost:3737';

const MOCK_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

const say = (...a) => console.log('  ' + a.join(' '));
const fail = (msg) => { console.error('FAIL: ' + msg); process.exit(1); };
const ok = (msg) => say('✓ ' + msg);

function base64urlEncode(s) { return Buffer.from(s, 'utf8').toString('base64url'); }

// @supabase/ssr v0.5+ cookie format: 'base64-' + base64url(JSON.stringify(session))
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

// ---- build attempt payload (mix right + wrong so `correct` is exercised) ----
// Q1,Q2 → correct_answer (right). Q3,Q4 → 'a' (wrong). Q5 → 'd' (wrong).
const answers = {}, timings = {}, correctMap = {};
qRows.forEach((q, idx) => {
  const ua = idx < 2 ? q.correct_answer : (idx === 4 ? 'd' : 'a');
  answers[q.id] = ua;
  timings[q.id] = 8000 + idx * 3000;  // 8,11,14,17,20 s
  correctMap[q.id] = q.correct_answer;
});
const body = JSON.stringify({ date: MOCK_DATE, answers, timings, correct_map: correctMap });

// ---- mint a test user + session via GoTrue admin + password grant ----
const TEST_EMAIL = `cp5-test-${Date.now()}@n2-test.invalid`;
const TEST_PASSWORD = 'cp5-test-pw-' + Math.random().toString(36).slice(2, 12);
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
ok(`session minted (access_token=${session.access_token.slice(0, 24)}...)`);

// ---- confirm webapp is up ----
const pingRes = await fetch(`${WEBAPP}/`);
if (!pingRes.ok && pingRes.status !== 307) {
  console.error(`webapp not responding on ${WEBAPP} (status=${pingRes.status})`);
  console.error('start it first: bash scripts/webapp_smoke.sh  (or set CP5_WEBAPP_URL)');
  process.exit(2);
}
ok(`webapp reachable at ${WEBAPP}`);

// ---- TEST A: 401 without cookie ----
say('TEST A: POST /api/attempts WITHOUT cookie → expect 401');
const noAuthRes = await fetch(`${WEBAPP}/api/attempts`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
});
if (noAuthRes.status !== 401) fail(`expected 401, got ${noAuthRes.status}: ${await noAuthRes.text()}`);
ok('401 returned as expected (auth gate works)');

// ---- TEST B: 200 with cookie + row lands ----
say('TEST B: POST /api/attempts WITH cookie → expect 200');
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
ok(`200 + 5 attempt_ids returned`);

// ---- readback n2_attempts via service role + verify all fields ----
const { data: attemptRows, error: attErr } = await admin
  .from('n2_attempts')
  .select('id, user_id, question_id, user_answer, correct, time_seconds, challenge_id')
  .in('id', postBody.attempt_ids);
if (attErr) fail('n2_attempts readback failed: ' + attErr.message);
if (attemptRows?.length !== 5) fail(`expected 5 rows in n2_attempts, got ${attemptRows?.length ?? 0}`);

const problems = [];
for (const q of qRows) {
  const row = attemptRows.find(r => r.question_id === q.id);
  if (!row) { problems.push(`no row for ${q.id}`); continue; }
  if (row.user_id !== testUserId) problems.push(`user_id mismatch for ${q.id}: ${row.user_id}`);
  if (row.user_answer !== answers[q.id]) problems.push(`user_answer mismatch for ${q.id}: got ${row.user_answer}`);
  if (row.challenge_id !== null) problems.push(`challenge_id should be null for ${q.id}: ${row.challenge_id}`);
  const expSec = Math.round(timings[q.id] / 1000);
  if (row.time_seconds !== expSec) problems.push(`time_seconds mismatch for ${q.id}: ${row.time_seconds} vs ${expSec}`);
  const expCorrect = answers[q.id] === q.correct_answer;
  if (row.correct !== expCorrect) problems.push(`correct mismatch for ${q.id}: ${row.correct} vs ${expCorrect}`);
}
if (problems.length) fail('row readback mismatch:\n  - ' + problems.join('\n  - '));
ok('all 5 rows match (user_id, question_id, user_answer, time_seconds, correct, challenge_id=null)');

// ---- cleanup ----
const { error: delErr } = await admin.from('n2_attempts').delete().in('id', postBody.attempt_ids);
if (delErr) console.error('WARN: cleanup delete failed: ' + delErr.message);
const delUserRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${testUserId}`, {
  method: 'DELETE', headers: { 'apikey': SUPABASE_SR, 'Authorization': `Bearer ${SUPABASE_SR}` },
});
if (!delUserRes.ok) console.error('WARN: test user cleanup HTTP ' + delUserRes.status);
ok('cleanup: rows deleted + test user removed');

console.log('');
console.log('PASS — cp5_attempts_e2e: 401 gate + 200 insert + DB readback all green');
process.exit(0);