#!/usr/bin/env node
/*
 * mergeStates() regression test — run before deploying ANY change that touches
 * load()/save()/mergeStates()/cloudPull()/scheduleCloudPush() or the S schema.
 *
 * Background: mindpullness originally used a last-write-wins full-document
 * overwrite for cloud sync (both at first launch and again in an incident
 * documented in HANDOFF_mindpullness_ClaudeCode.md §5). In both cases a device
 * with a *newer timestamp but emptier/older data* (e.g. a freshly onboarded
 * phone, logged in before real data existed on it) overwrote a device that had
 * real, older data. mergeStates() (index.html, added 2026-07) replaced that
 * with a field-level union/merge so a fresher-but-emptier state can never
 * erase older-but-real data. This script re-derives the exact failure
 * scenario and asserts it stays fixed.
 *
 * Usage: node scripts/test-sync-merge.js
 */
const fs = require("fs");
const path = require("path");
const os = require("os");

const indexPath = path.join(__dirname, "..", "index.html");
const html = fs.readFileSync(indexPath, "utf8");

// Grab every inline <script> block (no src=) and use the largest one — that's
// the app logic. Using a line-number slice would silently go stale as the
// file grows/shrinks.
const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (!blocks.length) { console.error("FAIL  no inline <script> block found in index.html"); process.exit(1); }
let code = blocks.reduce((a, b) => (b.length > a.length ? b : a), "");
code = code.replace(/\nboot\(\);\s*$/, "\n");
code += `\nmodule.exports = { mergeStates, DEFAULT, todayStr };\n`;

const tmpFile = path.join(os.tmpdir(), `mindpullness-sync-merge-test-${Date.now()}.js`);
fs.writeFileSync(tmpFile, code);

const stubEl = () => ({
  addEventListener(){}, classList:{add(){},remove(){},toggle(){},contains(){return false;}},
  querySelectorAll(){return [];}, querySelector(){return stubEl();},
  value:"", textContent:"", innerHTML:"", style:{}
});
global.document = {
  addEventListener(){},
  querySelector(){return stubEl();},
  querySelectorAll(){return [];},
  getElementById(){return stubEl();},
  createElement(){return stubEl();},
};
global.window = { scrollTo(){} };
global.firebase = undefined;
global.localStorage = { getItem(){return null;}, setItem(){}, removeItem(){} };
global.navigator = { clipboard: { writeText: async () => {} } };

let mergeStates, DEFAULT;
try {
  ({ mergeStates, DEFAULT } = require(tmpFile));
} finally {
  fs.unlinkSync(tmpFile);
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`PASS  ${name}`); pass++; }
  else { console.log(`FAIL  ${name} — ${detail || ""}`); fail++; }
}

// ---- Scenario A: 최초 출시 시 실제 발생했던 사고 + §5 재발 사고, 공통 재현 케이스 ----
// remote = 기존 기기에 실기록 2건 (과거 updatedAt)
// local  = 새 기기/새 온보딩 직후의 빈 상태 (지금 막 찍힌 최신 updatedAt)
{
  const remote = DEFAULT();
  remote.settings.onboardingDone = true;
  remote.settings.startDate = "2026-07-01";
  remote.entries = [
    { id:"e_1", createdAt:"2026-07-01T09:00:00.000Z", situation:"a", thought:"b", emotions:["불안"], intensity:70, body:[], behavior:"", step2:null, coachNote:"" },
    { id:"e_2", createdAt:"2026-07-02T09:00:00.000Z", situation:"c", thought:"d", emotions:["우울"], intensity:60, body:[], behavior:"", step2:null, coachNote:"" }
  ];
  remote.updatedAt = 1000;

  const local = DEFAULT();
  local.settings.onboardingDone = true;
  local.settings.startDate = "2026-07-05";
  local.entries = [];
  local.updatedAt = 999999;

  const merged = mergeStates(remote, local);
  check("A) 빈 신규 기기가 기존 기록을 지우지 않음 (entries 2건 유지)", merged.entries.length === 2, `got ${merged.entries.length}`);
  check("A) onboardingDone true 유지", merged.settings.onboardingDone === true);
}

// ---- Scenario B: 서로 다른 기록 1건씩 → 합집합 2건 ----
{
  const remote = DEFAULT();
  remote.updatedAt = 1000;
  remote.entries = [{ id:"e_1", createdAt:"2026-07-01T09:00:00.000Z", situation:"r", coachNote:"", step2:null, emotions:[], body:[], behavior:"", intensity:50 }];

  const local = DEFAULT();
  local.updatedAt = 2000;
  local.entries = [{ id:"e_2", createdAt:"2026-07-02T09:00:00.000Z", situation:"l", coachNote:"", step2:null, emotions:[], body:[], behavior:"", intensity:50 }];

  const merged = mergeStates(remote, local);
  check("B) 서로 다른 기록 union = 2건", merged.entries.length === 2, `got ${merged.entries.length}`);
  check("B) 양쪽 id 모두 존재", merged.entries.some(e=>e.id==="e_1") && merged.entries.some(e=>e.id==="e_2"));
}

// ---- Scenario C: 같은 id, local이 최신 → local(coachNote 수정) 버전 채택 ----
{
  const remote = DEFAULT();
  remote.updatedAt = 1000;
  remote.entries = [{ id:"e_1", createdAt:"2026-07-01T09:00:00.000Z", situation:"s", coachNote:"", step2:null, emotions:[], body:[], behavior:"", intensity:50 }];

  const local = DEFAULT();
  local.updatedAt = 5000;
  local.entries = [{ id:"e_1", createdAt:"2026-07-01T09:00:00.000Z", situation:"s", coachNote:"코치가 준 조언", step2:null, emotions:[], body:[], behavior:"", intensity:50 }];

  const merged = mergeStates(remote, local);
  check("C) 최신 쪽(local, coachNote 수정) 버전 채택", merged.entries[0].coachNote === "코치가 준 조언", `got "${merged.entries[0].coachNote}"`);
}

// ---- Scenario D: startDate는 더 이른 날짜(배움 코스 해금일 보존) ----
{
  const remote = DEFAULT(); remote.updatedAt=1000; remote.settings.startDate = "2026-07-10";
  const local = DEFAULT(); local.updatedAt=2000; local.settings.startDate = "2026-07-11";
  const merged = mergeStates(remote, local);
  check("D) startDate = 이른 날짜(2026-07-10)", merged.settings.startDate === "2026-07-10", `got ${merged.settings.startDate}`);

  const remote2 = DEFAULT(); remote2.updatedAt=2000; remote2.settings.startDate = "2026-07-11";
  const local2 = DEFAULT(); local2.updatedAt=1000; local2.settings.startDate = "2026-07-10";
  const merged2 = mergeStates(remote2, local2);
  check("D-역방향) startDate = 이른 날짜(2026-07-10)", merged2.settings.startDate === "2026-07-10", `got ${merged2.settings.startDate}`);
}

// ---- Scenario E: assessments/trainings/lessons/activityDates도 합집합으로 보존 ----
{
  const remote = DEFAULT();
  remote.updatedAt = 1000;
  remote.assessments = [{ id:"a_1", date:"2026-07-01", type:"PHQ9", answers:[1,1,1,1,1,1,1,1,1], total:9 }];
  remote.trainings = [{ date:"2026-07-01T09:00:00.000Z", type:"box", minutes:3 }];
  remote.lessons = { completed:[1,2], missionMemos:{ "1":"메모1" } };
  remote.activityDates = ["2026-07-01"];

  const local = DEFAULT();
  local.updatedAt = 999999;
  local.assessments = [];
  local.trainings = [];
  local.lessons = { completed:[], missionMemos:{} };
  local.activityDates = [];

  const merged = mergeStates(remote, local);
  check("E) assessments 보존", merged.assessments.length === 1);
  check("E) trainings 보존", merged.trainings.length === 1);
  check("E) lessons.completed 보존", merged.lessons.completed.length === 2, `got ${JSON.stringify(merged.lessons.completed)}`);
  check("E) activityDates 보존", merged.activityDates.length === 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
