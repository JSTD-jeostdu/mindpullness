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

## 9. 하지 말 것

- 다중 파일 분리, 빌드 도구 도입, modular SDK 전환 (단일 파일 + compat 유지)
- Firestore 규칙·문서 경로 변경 (콘솔 재설정을 유발하므로)
- 안전 관련 UI/문구(온보딩 고지, PHQ-9 위기 카드, 데이터 관리의 상담전화 안내) 수정·삭제
- 28강 콘텐츠, 코치 프롬프트 템플릿 등은 명시적으로 요청받은 작업이 아니면 변경하지 않기
