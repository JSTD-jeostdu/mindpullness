# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 1. 프로젝트 개요

- **이름**: mindpullness (mind + pull + ness — 마음을 건강한 상태로 붙잡아 당겨놓는다)
- **정체**: CBT·ACT 등 근거 기반 기법으로 구성한 **1인용 셀프케어 웹앱** (생각기록 + 거리두기 + 배움 코스 + 호흡 훈련 + PHQ-9/GAD-7 추적)
- **저장소**: https://github.com/JSTD-jeostdu/mindpullness
- **배포 주소**: https://jstd-jeostdu.github.io/mindpullness/ (GitHub Pages, main 브랜치 root)
- **파일 구성**: `index.html` 단일 파일 (HTML+CSS+JS 전부 포함, 약 100KB) + `README.md`
- **설계 원칙**: 서버 비용 0원, 단일 파일 유지, 프라이버시 우선, 안전 문구(진단 아님 고지·위기 안내 109/1577-0199) 절대 삭제 금지

## 2. 기술 아키텍처

- 순수 HTML/CSS/JS, 빌드 없음. 외부 의존성은 CDN 3종:
  - Pretendard(본문 폰트), Gowun Batang(제목 폰트)
  - Firebase **compat SDK 10.14.1** (app/auth/firestore) — modular(import) 방식 아님
- **저장 구조 (로컬 우선 + 클라우드 미러링)**:
  1. 모든 상태는 전역 객체 `S` 하나 → `localStorage["mindwork_data"]`에 JSON 직렬화
  2. `save()`가 호출될 때마다 `S.updatedAt = Date.now()` 스탬프 후 로컬 저장 + `scheduleCloudPush()`(1.5초 디바운스)로 Firestore에 문서 통째로 `set()`
  3. Firestore 문서 경로: `workbooks/{Google UID}` — **문서 1개에 전체 상태 저장**
  4. `cloudPull()`은 서버 문서를 로컬과 **필드 단위로 병합**(`mergeStates()`, 2026-07 수정)한 뒤 로컬·서버 양쪽에 반영한다. 단순 `updatedAt` 비교에 의한 전체 덮어쓰기는 새 기기의 빈 상태가 오래된 실제 데이터를 지우는 사고를 낸 적이 있어 폐기했다 — 다시 last-write-wins 방식으로 되돌리지 말 것.
  5. 보안 규칙: `request.auth.uid == uid`일 때만 read/write (이미 게시 완료)
- **인증**: Google 팝업 로그인(실패 시 redirect 폴백). config는 `FIREBASE_CONFIG` 상수로 파일 상단에 내장(공개되어도 무방한 값).
- Firebase 콘솔 설정 완료 상태: Firestore 규칙 게시 ✅ / Google 로그인 ✅ / 승인된 도메인(jstd-jeostdu.github.io) ✅

## 3. 데이터 모델 (`S`의 스키마)

```javascript
{
  version: 1,
  updatedAt: 1720000000000,            // save()마다 갱신
  settings: { userName, startDate, onboardingDone, lastCheckDate },
  entries: [{                           // 생각기록 (항목별 updatedAt은 없음)
    id: "e_타임스탬프", createdAt: ISO문자열,
    situation, thought, emotions: [문자열], intensity: 0~100,
    body: [문자열], behavior,
    step2: null | { q1, q2, q3, reappraisal, intensityAfter, traps: [문자열] },
    coachNote: 문자열
  }],
  lessons: { completed: [강번호], missionMemos: { "강번호": 메모 } },
  assessments: [{ id: "a_타임스탬프", date: "YYYY-MM-DD", type: "PHQ9"|"GAD7", answers: [숫자], total }],
  trainings: [{ date: ISO문자열, type, minutes }],   // 고유 id 없음 (date+type이 사실상의 키)
  activityDates: ["YYYY-MM-DD"],       // 스트릭 계산용
  values: { compass, weeklyPlan, hardDayCard }
}
```

## 4. 코드 구조 (index.html 내 주요 지점)

- 상단: `FIREBASE_CONFIG` 상수 → 데이터 상수(EMOTIONS/TRAPS/PHQ9/GAD7/LESSONS 28강/SCRIPTS)
- 상태: `load()` `save()` `markActivity()` / 유틸: `$` `esc()` `todayStr()` `toast()` `copyText()`
- **클라우드 모듈**: `CLOUD_ON` `cloudSetup()` `mergeStates()` `cloudPull()` `scheduleCloudPush()` `cloudLogin()` `cloudLogout()` `renderSync()` — 동기화 로직을 건드릴 땐 이 블록에서 작업
- 라우팅: `showTab()` + 렌더러 `renderHome/renderRecords/renderLearn/renderTrain/renderStats`
- 기록: `openWizard()`(STEP1) `openStep2()` `openDetail()` / 코치: `copyCoachPrompt()` `copyWeeklyPrompt()` `copyAssessPrompt()`
- 마음체크: `openAssess()` `submitAssess()` `showAssessResult()`(PHQ-9 9번 문항 ≥1 시 위기 안내 카드 — **수정 금지**)
- 부팅: `boot()` (온보딩 → cloudSetup 호출)

## 5. 최우선 원칙: 사용자 데이터 보호

이 앱은 사용자의 생각기록·감정·마음체크 결과 등 민감한 개인 데이터를 다룬다. **어떤 업데이트나
수정 작업을 하더라도 기존 사용자의 데이터가 유실되어서는 안 된다.**

### 5-1. 사고 기록 (반복되지 않도록 원인을 기억할 것)

- **최초 출시 시점**: 클라우드 동기화가 `updatedAt` 단순 비교에 의한 **전체 덮어쓰기
  (last-write-wins)** 방식이었다. "새로 생긴 빈 상태가 `updatedAt`만 더 최신"이라는 이유로 기존의
  실제 데이터를 통째로 지우고 서버에 덮어써버리는 구조적 결함이 출시 초기부터 있었다.
- **재발 사고 (2026-07)**: 데스크탑에서 온보딩+로그인+기록 → 서버 정상 저장. 이후 **모바일에서
  로그인 전에 온보딩을 먼저 진행**해 "방금 찍힌 최신 `updatedAt`을 가진 빈 데이터"가 생성됨 →
  로그인 시 `cloudPull()`이 "로컬(모바일의 빈 상태)이 서버보다 최신"이라 판단해 **빈 데이터로
  서버를 덮어씀** → 데스크탑도 그 빈 상태를 받아 로컬까지 덮어써 실제 기록이 유실됐다. 상세 경위는
  `HANDOFF_mindpullness_ClaudeCode.md` §5 참고.
- **근본 원인은 두 사고가 동일**: "타임스탬프가 더 최신"이라는 것과 "데이터가 더 진짜/많다"는 것을
  동일시한 것. 빈 상태도 `updatedAt`만큼은 항상 가장 최신일 수 있다는 점이 함정이었다.
- **수정**: `mergeStates(remote, local)` 함수(index.html, §2-4)를 도입해 전체 덮어쓰기를
  **필드 단위 병합**으로 교체했다. entries/assessments/trainings는 id(또는 date+type) 기준
  합집합, 충돌 시에만 최신 쪽 채택, `onboardingDone`은 둘 중 하나라도 true면 true, `startDate`는
  더 이른 날짜를 유지하는 식이다. **다시 last-write-wins(단순 `updatedAt` 비교 후 통째로
  set()/교체)로 되돌리지 말 것** — 겉보기엔 코드가 더 단순해 보여도 정확히 이 사고를 재현하는
  구조다.

### 5-2. 배포 전 검증 명령어

동기화/저장 로직(`load()` `save()` `mergeStates()` `cloudPull()` `scheduleCloudPush()`)이나
`S` 스키마(§3)를 조금이라도 건드린 변경은 배포 전 반드시 아래를 실행하고 전부 PASS인지 확인한다.

```bash
node scripts/test-sync-merge.js
```

이 스크립트는 `index.html`의 인라인 스크립트를 그대로 추출해 `mergeStates()`를 로드하고, 최초
출시 사고와 2026-07 재발 사고를 그대로 재현한 시나리오(빈 신규 기기가 기존 기록을 지우는지 여부)를
포함한 회귀 테스트를 돌린다. 문법 오류가 있으면 `require()` 단계에서 즉시 실패하므로 간이
문법 검증도 겸한다. 새로운 병합 규칙을 추가하면 이 스크립트에도 시나리오를 함께 추가한다.

작업 시 반드시 지킬 것:

- **저장/동기화 로직(`load()` `save()` `mergeStates()` `cloudPull()` `scheduleCloudPush()` 등)을
  건드릴 때는 특히 신중하게**: 전체 덮어쓰기(overwrite)로 되돌리지 말고, 필드 단위 병합 원칙을
  유지한다. "새 기기의 빈 상태"가 "기존의 실제 데이터"를 이길 수 있는 코드 경로가 생기지 않는지
  항상 확인한다.
- **데이터 모델(§3 `S`의 스키마)을 변경할 때**: 필드를 삭제하거나 이름을 바꾸면 기존
  `localStorage`/Firestore에 저장된 구버전 데이터가 깨질 수 있다. 필드 추가는 안전하지만, 기존
  필드의 삭제·이름 변경·타입 변경 전에는 마이그레이션 경로(구버전 데이터를 읽어 새 스키마로
  변환)를 함께 설계한다.
- **로컬 스토리지 키(`mindwork_data`)나 Firestore 문서 경로(`workbooks/{uid}`)는 변경하지 않는다**
  — 변경 시 기존 사용자는 자신의 데이터에 접근할 수 없게 된다.
- **파괴적 조작(문서 `set()`으로 전체 교체, `localStorage.removeItem`, 데이터 초기화 버튼 등)을
  추가·수정할 때는** 사용자의 명시적 확인 없이 실행되지 않도록 하고, 가능하면 실행 전 되돌릴 수
  있는 경로(백업·내보내기)를 우선 안내한다.
- 배포 전 `node scripts/test-sync-merge.js`(§5-2)를 실행해 전부 PASS인지 확인한다.
- 확신이 서지 않으면 실제로 배포하기 전에 사용자에게 알리고 확인을 받는다.

## 6. 하지 말 것

- 다중 파일 분리, 빌드 도구 도입, modular SDK 전환 (단일 파일 + compat 유지)
- Firestore 규칙·문서 경로 변경 (콘솔 재설정을 유발하므로)
- 안전 관련 UI/문구(온보딩 고지, PHQ-9 위기 카드, 데이터 관리의 상담전화 안내) 수정·삭제
- 28강 콘텐츠, 코치 프롬프트 템플릿 등은 명시적으로 요청받은 작업이 아니면 변경하지 않기
- 사용자 데이터 유실 위험이 있는 변경(§5 참고)을 검증 없이 배포하기
