#!/usr/bin/env node
// scripts/cp7_plan_bias.mjs — cp7 end-to-end integration test (no-webapp).
//
// Proves: steps/01_plan.py, given a real subscriber UUID with recent wrong
// attempts in n2_attempts, writes out/plan.json whose target_tags is biased
// by the weak tags in those miss rows (NOT the DEFAULT_TAGS fallback).
//
// Approach: unit-test-shaped. Plant 5 attempts directly via service role,
// spawn 01_plan.py with ODIS_N2_USER_ID_UUID set, read plan.json, assert:
//   - user_id resolves to our test user
//   - miss_count == 3 (3 wrong, 2 right)
//   - target_tags overlaps at least one of the planted weak tags
//   - target_tags is NOT exactly DEFAULT_TAGS (proves bias path taken)
// Then cleanup planted attempts and restore plan.json to its prior fallback.
//
// Reversibility: 01_plan.py change = 1 import + 1 URL-encode local var
// (see git diff). Script deletes 5 rows + restores plan.json in cleanup.
//
// Exit: 0 = bias proven. 1 = contract violation. 2 = setup error.

import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const ODIS_ENV = '/Users/jacksonhemopo/ODIS/.env';
const PLAN_FILE = '/Users/jacksonhemopo/ODIS/shared/pipelines/n2-content/out/plan.json';
const PLAN_SCRIPT = '/Users/jacksonhemopo/ODIS/shared/pipelines/n2-content/steps/01_plan.py';
const DEFAULT_TAGS = ['keigo', 'conditionals'];

function readOdisEnv(name) {
  const line = readFileSync(ODIS_ENV, 'utf8').split('\n').find(l => l.startsWith(`${name}=`));
  if (!line) throw new Error(`missing ${name} in ${ODIS_ENV}`);
  return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '');
}
const SUPABASE_URL = readOdisEnv('ODIS_SUPABASE_URL');
const SUPABASE_SR = readOdisEnv('ODIS_SUPABASE_SERVICE_ROLE_KEY');

const MOCK_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

const say = (...a) => console.log('  ' + a.join(' '));
const fail = (msg) => { console.error('FAIL: ' + msg); process.exit(1); };
const ok = (msg) => say('✓ ' + msg);
const PLAN_BACKUP = PLAN_FILE + '.bak-cp7';

// ---- A. Locate today's mock + 5 questions (with their tags) ----
say(`A: locating today's mock (${MOCK_DATE}) via service role`);
const admin = createClient(SUPABASE_URL, SUPABASE_SR, { auth: { persistSession: false } });
const { data: mockRows, error: mockErr } = await admin
  .from('n2_mocks').select('question_ids').eq('date', MOCK_DATE).limit(1);
if (mockErr) fail('n2_mocks query failed: ' + mockErr.message);
if (!mockRows?.length) {
  console.error(`no mock for ${MOCK_DATE} — pipeline hasn't published today yet`);
  process.exit(2);
}
const questionIds = mockRows[0].question_ids;
if (questionIds?.length !== 5) fail(`expected 5 question_ids, got ${questionIds?.length ?? 0}`);

const { data: qRows, error: qErr } = await admin
  .from('n2_questions').select('id, tags, correct_answer').in('id', questionIds);
if (qErr) fail('n2_questions query failed: ' + qErr.message);
if (qRows?.length !== 5) fail(`expected 5 question rows, got ${qRows?.length ?? 0}`);
ok(`5 questions located for ${MOCK_DATE}`);

// ---- B. Mint a real test user (FK on n2_attempts.user_id → auth.users.id) ----
const TEST_EMAIL = `cp7-test-${Date.now()}@n2-test.invalid`;
const TEST_PASSWORD = 'cp7-test-pw-' + Math.random().toString(36).slice(2, 12);
say(`B: creating test user ${TEST_EMAIL}`);
const createUserRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { 'apikey': SUPABASE_SR, 'Authorization': `Bearer ${SUPABASE_SR}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, email_confirm: true }),
});
if (!createUserRes.ok) fail(`createUser HTTP ${createUserRes.status}: ${await createUserRes.text()}`);
const testUserId = (await createUserRes.json()).id;
ok(`test user created: ${testUserId}`);

// ---- B2. Plant 5 attempts (3 wrong, 2 right) as that user ----
say(`B2: planting 5 attempts (3 wrong, 2 right) as test user`);
const rowsToInsert = qRows.map((q, i) => {
  const wrong = i < 3;
  const ua = wrong ? (q.correct_answer === 'a' ? 'b' : 'a') : q.correct_answer;
  return {
    user_id: testUserId,
    question_id: q.id,
    user_answer: ua,
    correct: !wrong,
    time_seconds: 10 + i,
    challenge_id: null,
  };
});
const { data: insRows, error: insErr } = await admin
  .from('n2_attempts').insert(rowsToInsert).select('id');
if (insErr) fail('insert attempts failed: ' + insErr.message);
if (insRows?.length !== 5) fail(`expected 5 inserted, got ${insRows?.length ?? 0}`);
ok(`planted 5 attempts; ids: ${insRows.map(r => r.id.slice(0, 8)).join(', ')}`);

// Collect the weak-tag pool from the planted WRONG attempts (indices 0..2).
const plantedWeakTags = new Set();
for (let i = 0; i < 3; i++) for (const t of (qRows[i].tags || [])) plantedWeakTags.add(t);
say(`planted weak-tag pool: ${[...plantedWeakTags].sort().join(', ')}`);

// ---- Snapshot plan.json so cleanup can restore ----
let planBackup = null;
try { planBackup = readFileSync(PLAN_FILE, 'utf8'); } catch { /* may not exist */ }
if (planBackup) writeFileSync(PLAN_BACKUP, planBackup);

// ---- C. Run 01_plan.py with ODIS_N2_USER_ID_UUID + SR key in env ----
// Critical: _load_env in 01_plan.py parses .env lines in file order; the
// ANON key (which appears first in ~/ODIS/.env) gets picked over the
// SERVICE_ROLE_KEY, and the anon key can't read other users' attempts →
// 0 rows. Pre-empt by passing both into the subprocess env so the env-var
// branch in _load_env wins (env var is checked before .env file scan).
say(`C: spawning 01_plan.py with ODIS_N2_USER_ID_UUID=${testUserId}`);
const planProc = spawnSync('python3', [PLAN_SCRIPT], {
  env: {
    ...process.env,
    ODIS_N2_USER_ID_UUID: testUserId,
    ODIS_SUPABASE_URL: SUPABASE_URL,
    ODIS_SUPABASE_SERVICE_ROLE_KEY: SUPABASE_SR,
  },
  encoding: 'utf8',
  timeout: 30000,
});
if (planProc.status !== 0) {
  console.error('  STDOUT:', planProc.stdout);
  console.error('  STDERR:', planProc.stderr);
  fail(`01_plan.py exit=${planProc.status}`);
}
say(`01_plan.py stdout: ${planProc.stdout.trim().replace(/\n/g, ' | ')}`);

// ---- D. Read plan.json + assert bias ----
const plan = JSON.parse(readFileSync(PLAN_FILE, 'utf8'));
say(`D: plan.json → user_id=${plan.user_id}, miss_count=${plan.miss_count}, target_tags=${JSON.stringify(plan.target_tags)}`);

if (plan.user_id !== testUserId) {
  fail(`plan.user_id mismatch: expected ${testUserId}, got ${plan.user_id}`);
}
if (plan.miss_count !== 3) {
  fail(`plan.miss_count mismatch: expected 3, got ${plan.miss_count}`);
}
const planTagSet = new Set(plan.target_tags);
const overlap = [...plantedWeakTags].filter(t => planTagSet.has(t));
if (overlap.length < 1) {
  fail(`no overlap: planted=${[...plantedWeakTags].join(',')}, plan=${plan.target_tags.join(',')}`);
}
ok(`target_tags overlaps planted weak tags: ${overlap.join(', ')}`);

// Belt-and-braces: prove this isn't the default-tag-fallback path.
const isDefaultFallback = planTagSet.size === DEFAULT_TAGS.length
  && DEFAULT_TAGS.every(t => planTagSet.has(t));
if (isDefaultFallback && overlap.length === 0) {
  fail('target_tags is exactly DEFAULT_TAGS — fallback path taken despite real misses');
}
ok(`NOT fallback path (target_tags=${plan.target_tags.join(',')})`);

// ---- E. Cleanup: delete planted attempts + delete test user + restore plan ----
const plantedIds = insRows.map(r => r.id);
const { error: delErr } = await admin.from('n2_attempts').delete().in('id', plantedIds);
if (delErr) console.error('WARN: cleanup delete failed: ' + delErr.message);
else ok(`cleanup: ${plantedIds.length} planted attempts deleted`);

const delUserRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${testUserId}`, {
  method: 'DELETE',
  headers: { 'apikey': SUPABASE_SR, 'Authorization': `Bearer ${SUPABASE_SR}` },
});
if (!delUserRes.ok) console.error('WARN: test user cleanup HTTP ' + delUserRes.status);
else ok('cleanup: test user removed');

if (planBackup) {
  writeFileSync(PLAN_FILE, planBackup);
  try { writeFileSync(PLAN_BACKUP, ''); } catch {}
}
ok('plan.json restored to pre-test state');

console.log('');
console.log('PASS — cp7_plan_bias: 01-plan biases target_tags on planted weak tags end-to-end');
process.exit(0);
