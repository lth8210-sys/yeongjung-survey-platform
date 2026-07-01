---
name: stabilization-phase1
description: 운영 안정화 1단계 — 개인정보 마스킹, 로거, 다운로드 권한 개선 (2026-07-01)
metadata:
  type: project
---

2026-07-01 완료된 1단계 운영 안정화 작업.

**새 파일:**
- `src/utils/privacy.js` — maskName, maskPhone, maskAddress, maskAnswerByQuestion, maskResponsesForDownload
- `src/utils/logger.js` — DEV: 그대로 출력, PROD: uid/email/path/payload/stack → [MASKED]

**수정 파일:**
- `src/firebase/surveys.js` — logFirestoreReadDenied에 logger.error 적용
- `src/pages/SurveyListPage.jsx` — 설문 목록 조회 실패 console.error → logger.error
- `src/pages/SurveyResponsePage.jsx` — submit permission-denied: logger.error 적용, PROD 사용자 메시지 변경
- `src/pages/RecentResponsesPage.jsx` — 목록 respondentName/Phone → maskName/maskPhone
- `src/pages/SurveyResponsesAdminPage.jsx` — 명단형/슬롯명단/카드뷰 마스킹, 다운로드 shouldMaskDownload 로직

**다운로드 권한:**
- shouldMaskDownload = !['super_admin','admin'].includes(role) && !isSurveyOwner(survey)
- CSV(원본/명단/슬롯): creator 비소유/viewer → PII 답변 마스킹
- Excel: maskResponsesForDownload로 answers 전처리 후 downloadStatisticsExcel 호출

**Firestore Rules:** 변경 없음 (isCreatorEmail() levelup 유지, 2단계에서 제거 예정)

**PROD 에러 메시지 변경:**
- permission-denied 시 사용자에게: "응답 제출 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요."
- DEV에서는 기존 진단 메시지 유지

**creator 설문목록 누락 수정 (2026-07-01):**
- `src/firebase/users.js` upsertInternalUserProfile의 `isAutoAssignedInternalDefault` 조건 1줄 수정
- 변경: `resolveStoredUserStatus === PENDING` → `(resolveStoredUserStatus === PENDING || !existingData.role)`
- 효과: status=active + role=null/'' 인 기존 내부 계정도 creator/active로 자동 복구
- 보존: role='viewer'로 명시된 계정, preregistered/membershipId 계정은 변경 없음
- Firestore rules 변경 없음, isCreatorEmail allowlist 변경 없음

**Why:** 개인정보 보호 (화면 목록 마스킹) + 운영 로그 민감정보 노출 방지 + 다운로드 권한 세분화 + creator 설문목록 누락 복구
**How to apply:** commit/push/deploy 전에 levelup, ihp1004, yeah 계정 실제 동작 테스트 필수
