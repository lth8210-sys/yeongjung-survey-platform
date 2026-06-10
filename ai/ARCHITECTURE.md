# 영중 설문 플랫폼 아키텍처

최종 업데이트: 2026-06-10

## 프로젝트 목적

영중종합사회복지관 직원이 직접 설문, 만족도 조사, 참여 신청서를 만들고 응답을 수집/관리할 수 있는 운영용 웹 플랫폼입니다.

## 기술 스택

- Frontend: React 19, React Router 7, Vite 7
- Backend/BaaS: Firebase Authentication, Firestore, Firebase Hosting
- Build/Deploy: `npm run build`, Firebase CLI
- 주요 의존성: `firebase`, `qrcode`, `react`, `react-dom`, `react-router-dom`

## 주요 디렉터리 구조

- `src/App.jsx`: 라우트 구성
- `src/pages/`: 화면 단위 페이지
- `src/components/`: 공통 UI와 질문 편집/미리보기 컴포넌트
- `src/contexts/AuthContext.jsx`: 로그인/권한 컨텍스트
- `src/firebase/`: Firestore 접근, 사용자/권한, 설문 상수/정규화
- `src/utils/responseFlow.js`: 응답자 화면의 visible flow 계산
- `src/data/formTemplates.js`: 템플릿 데이터
- `firestore.rules`: Firestore 보안 규칙
- `firestore.indexes.json`: Firestore 인덱스
- `ai/`: 운영/유지보수/AI 협업 문서

## 핵심 화면

- `/`: 홈
- `/surveys`: 공개 설문 목록
- `/surveys/:surveyId`, `/survey/:surveyId`: 응답자 화면
- `/admin`: 관리자 대시보드
- `/admin/surveys`: 관리자 설문 목록
- `/admin/surveys/new`: 새 설문 생성
- `/admin/surveys/:surveyId/edit`: 설문 수정
- `/admin/surveys/:surveyId/preview`: 설문 미리보기
- `/admin/surveys/:surveyId/responses`: 설문별 응답 관리
- `/admin/responses`: 최근 응답 관리
- `/admin/users`: 사용자 관리
- `/admin/audit-logs`: 감사로그
- `/admin/settings`: 관리자 설정

## 핵심 Firebase Collection 구조

- `users`: 사용자 계정, 역할, 상태
- `memberships`: 이메일 기반 사전 권한/소속 관리
- `surveys`: 설문 본문과 운영 설정
- `responses`: 제출된 응답
- `draftResponses`: 임시 저장 응답
- `audit_logs`: 응답 삭제, 다운로드 등 운영 로그
- `surveys/{surveyId}/applicationApplicantLocks`: 신청자 중복 방지 lock
- `surveys/{surveyId}/applicationSlotLocks`: 신청 슬롯 중복 방지 lock
- `surveys/{surveyId}/clientSubmitLocks`: 클라이언트 제출 중복 방지 lock

## survey 문서 구조 개요

주요 필드는 `src/firebase/surveys.js`와 `src/firebase/surveyNormalize.js` 기준입니다.

- `title`, `description`
- `status`: `draft`, `published`, `closed`, `deleted`
- `formType`: `targeted_survey`, `general_survey`, `targeted_participation_application`, `general_application`
- `questions`: 질문 배열
- `sections`: 섹션/페이지 배열
- `responseCount`: 삭제 응답 제외 기준으로 관리되는 응답 수
- `optionQuotaCounts`: 객관식/신청 슬롯 정원 카운트
- `ownerUid`, `ownerEmail`, `createdByUid`, `createdByEmail`
- `createdAt`, `updatedAt`
- 삭제 설문 관련: `deleted`, `deletedAt`, `deletedBy`

## response 문서 구조 개요

- `surveyId`, `surveyTitle`
- `answers`: `{ questionId, questionTitle, questionType, answer }` 형태의 응답 배열
- `respondent`: 제출 경로 등 클라이언트 정보
- `submittedAt`, `createdAt`, `updatedAt`
- `visibleQuestionIds`, `visibleSectionIds`, `skippedQuestionIds`
- `clientSubmitId`
- 처리 상태 관련 필드
- soft delete 관련: `deleted`, `hiddenFromDefaultList`, `deletedAt`, `deletedBy`

## template -> survey 생성 흐름

- 템플릿 원본은 `src/data/formTemplates.js`에 있습니다.
- 설문 제작 화면은 `src/pages/SurveyBuilderPage.jsx`입니다.
- 템플릿 질문은 `normalizeQuestions`를 거쳐 표준 질문 구조로 정리됩니다.
- 섹션은 `normalizeSurveySections`, 질문-섹션 연결은 `alignQuestionsToSections`를 통해 보정됩니다.
- 저장 전 질문은 `sanitizeSurveyQuestions`, 섹션은 `sanitizeSurveySections`를 통과합니다.

## response 저장 흐름

- 응답자 화면은 `src/pages/SurveyResponsePage.jsx`입니다.
- 설문 로드는 `getPublicSurvey`를 사용합니다.
- 질문/섹션 구조는 `normalizeQuestionsAndSections`와 `buildVisibleQuestionFlow`를 통해 렌더링 가능한 흐름으로 변환됩니다.
- 제출 전 필수 응답과 미방문 질문을 검증합니다.
- 저장은 `submitSurveyResponse`에서 Firestore transaction으로 처리합니다.
- 저장 시 `responses` 문서 생성, `surveys.responseCount` 증가, 필요 시 quota/lock 갱신이 함께 처리됩니다.

## soft delete 구조

- 응답 삭제 함수: `deleteSurveyResponse(responseId, deletedBy)`
- 실제 Firestore delete가 아니라 `responses/{responseId}`를 update합니다.
- 설정 필드: `deleted: true`, `hiddenFromDefaultList: true`, `deletedAt`, `deletedBy`, `updatedAt`
- 삭제 시 `surveys.responseCount`는 `Math.max(0, current - 1)`로 감소합니다.
- 객관식/신청 슬롯 카운트는 삭제 응답의 선택값 기준으로 감소하며 음수 방어가 필요합니다.
- 이미 삭제된 응답은 transaction 내부에서 재삭제하지 않습니다.

## audit log 구조

- collection: `audit_logs`
- 응답 삭제 시 생성되는 필드:
  - `action: response_delete`
  - `surveyId`
  - `responseId`
  - `actor`
  - `deletedBy`
  - `deletedAt`
  - `metadata`
  - `createdAt`
- 감사로그 화면: `/admin/audit-logs`

## 권한 구조

- 역할 상수는 `src/firebase/users.js`의 `USER_ROLES`입니다.
- 역할: `super_admin`, `admin`, `creator`, `viewer`
- `canCreateSurveys`: creator 이상
- `canManageAllSurveys`: admin 이상
- `canManageUsers`: admin 이상
- `canDeleteResponses`: admin 이상
- `canManageSurveyResponses`: admin 이상
- `canDownloadResponses`: creator 이상
- Firestore Rules의 super admin 이메일 목록과 `src/firebase/users.js`의 `SUPER_ADMIN_EMAILS`는 함께 관리해야 합니다.

## 설계 원칙

- 운영 설문 응답 데이터가 사라지지 않도록 삭제는 기본적으로 soft delete를 사용합니다.
- 응답자 화면에서는 알 수 없는 `question.type`도 숨기지 않고 fallback 렌더링해야 합니다.
- 질문은 `sectionId`, `pageId`, `pageKey`, `sectionKey` alias를 고려해 섹션과 매칭합니다.
- 매칭 실패 질문도 버리지 않고 fallback 섹션에 포함합니다.
- production에서는 내부 설문 구조 debug 로그와 debug panel을 노출하지 않습니다.
- Firestore Rules 변경은 반드시 별도 배포해야 합니다.
