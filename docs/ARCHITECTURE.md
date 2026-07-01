# Architecture

영중폼은 React + Vite 클라이언트와 Firebase Firestore를 중심으로 동작하는 설문, 신청, 응답 관리 플랫폼이다.

## React 구조

주요 앱 구조는 `src/` 아래에 있다.

- `src/App.jsx`: 라우팅 정의
- `src/main.jsx`: React 앱 진입점
- `src/components/`: 공통 UI 컴포넌트
- `src/pages/`: 화면 단위 페이지
- `src/contexts/AuthContext.jsx`: 로그인, 사용자 role, 권한 상태
- `src/firebase/`: Firestore 접근 함수, 설문 정규화, 사용자 권한 유틸
- `src/utils/`: 통계, 보고서, 응답 흐름, 개인정보 마스킹 등 도메인 유틸
- `src/data/`: 템플릿과 질문 블록 데이터

## 주요 화면

- 공개 설문 목록: `/surveys`
- 공개 응답 화면: `/surveys/:surveyId`
- 관리자 대시보드: `/admin`
- 설문 관리: `/admin/surveys`
- 새 폼 만들기: `/admin/surveys/new`
- 설문 수정: `/admin/surveys/:surveyId/edit`
- 설문별 응답 관리: `/admin/surveys/:surveyId/responses`
- 최근 응답 관리: `/admin/responses`
- 결과보고서 관리: `/admin/reports`
- 설문 템플릿 관리: `/admin/templates`
- 감사로그: `/admin/audit-logs`

## Firebase 구조

Firebase는 다음 역할을 담당한다.

- Google Authentication
- Firestore 데이터 저장
- Firestore Security Rules 기반 권한 제어
- Firebase Hosting 배포 대상

## Firestore Collections

### users

직원 계정, role, 상태를 저장한다. 로그인 사용자의 관리자 접근과 role 판정에 사용된다.

### surveys

설문 본문과 운영 설정을 저장한다. 제목, 설명, 문항, 섹션, 상태, 공개 범위, 소유자, quota 설정 등이 포함된다.

### responses

제출된 응답을 저장한다. 설문 ID, 설문 제목, 응답 내용, 응답자 정보, 제출 시각, 처리 상태, 삭제 상태 메타데이터가 포함된다.

### survey_reports

결과보고서 저장본을 관리한다. 설문 ID, 보고서 제목, 기간, 작성자, 섹션 텍스트, 상태, 삭제 여부가 포함된다.

### survey_templates

재사용 가능한 설문 템플릿을 저장한다. 템플릿 이름, 설명, 분류, 설문 구조, 사용 횟수, 활성 상태가 포함된다.

### audit_logs

관리자 작업 로그를 저장한다. 설문, 응답, 보고서, 템플릿 관련 주요 작업을 추적한다. 저장 실패는 화면 진입을 막지 않아야 한다.

### surveys/{surveyId}/quotaConfig

quota 설문의 권역, 연령대, 목표 수, 마감 방식 설정을 저장한다.

### surveys/{surveyId}/quotaCounts

quota 설문의 현재 누적 카운트를 저장한다. 응답 제출과 삭제 처리에서 매우 민감하므로 임의 수정 금지 대상이다.

## 데이터 흐름

```text
설문 생성
↓
게시
↓
응답
↓
통계
↓
보고서
↓
다운로드
```

## 설문 생성 흐름

관리자가 새 폼 만들기 화면에서 설문 구조를 작성한다. 저장 시 `surveys` 문서와 필요한 quota 서브문서가 생성된다.

## 게시 흐름

설문 상태가 게시 상태가 되면 공개 응답 화면에서 읽을 수 있다. 운영 중인 문항 구조와 공개 상태는 응답 제출 가능 여부에 직접 영향을 준다.

## 응답 흐름

응답자는 공개 설문 화면에서 문항에 답하고 제출한다. 제출 시 `responses` 문서가 생성되고, 필요한 경우 `surveys.responseCount`, quota counts, 중복 방지 lock이 함께 갱신된다.

## 통계 흐름

관리자 응답 화면과 결과보고서 화면은 `responses`와 `surveys`의 문항 구조를 기반으로 통계를 계산한다. 기존 응답과 문항 ID 호환성이 중요하다.

## 보고서 흐름

결과보고서 화면은 설문과 응답 통계를 바탕으로 보고서 초안을 만들고 `survey_reports`에 저장한다.

## 다운로드 흐름

CSV, Excel, DOCX 다운로드는 설문 문항 구조와 응답 데이터를 조합한다. 개인정보 마스킹과 권한 체크를 반드시 유지해야 한다.

## Critical Flow

아래 흐름은 영향 분석 없이 수정하면 안 된다.

```text
설문 생성
↓
게시
↓
응답 제출
↓
responses 생성
↓
quotaCounts 증가
↓
responseCount 증가
↓
통계 계산
↓
결과보고서
↓
CSV / Excel / DOCX
```

이 흐름 중 하나를 수정하면 공개 응답, 관리자 응답 관리, 최근응답, 통계, 결과보고서, 다운로드, 권한을 함께 확인한다.

## Critical Functions

| 함수 | 위치 | 역할 | 수정 시 확인 |
| --- | --- | --- | --- |
| `createSurvey` | `src/firebase/surveys.js` | 새 설문과 quota 서브문서 생성 | 설문 생성, 권한, quotaConfig, quotaCounts |
| `updateSurvey` | `src/firebase/surveys.js` | 설문 본문과 운영 설정 수정 | 설문 수정, 게시, draft/publish 호환 |
| `submitSurveyResponse` | `src/firebase/surveys.js` | 공개 응답 제출, response 생성, count 갱신 | 응답 제출, quotaCounts, responseCount |
| `deleteSurveyResponse` | `src/firebase/surveys.js` | 응답 삭제와 관련 count 보정 | 응답 관리, quotaCounts 음수 방지 |
| `fetchManagedSurveys` | `src/firebase/surveys.js` | role별 설문 목록 조회 | creator/staff/viewer 권한 |
| `fetchManagedRecentResponses` | `src/firebase/surveys.js` | 최근 응답 조회 | responses query, permission-denied |
| `fetchResponsesForSurvey` | `src/firebase/surveys.js` | 설문별 응답 조회 | surveyId query, pagination |
| `fetchManagedSurveyReports` | `src/firebase/surveys.js` | 결과보고서 목록 조회 | survey_reports query, role별 접근 |
| `saveSurveyReport` | `src/firebase/surveys.js` | 결과보고서 저장 | report rules, audit log |
| `createAuditLog` | `src/firebase/surveys.js` | 운영 감사로그 저장 | 실패 시 화면 차단 금지 |
| `fetchSurveyTemplates` | `src/firebase/surveyTemplates.js` | 템플릿 목록 조회 | active/inactive 권한 |
| `incrementSurveyTemplateUsage` | `src/firebase/surveyTemplates.js` | 템플릿 사용 횟수 증가 | creator 권한, rules |
| `buildSurveyAnalytics` | `src/utils/surveyAnalytics.js` | 통계 계산 | 보고서, Excel, 응답 관리 |
| `downloadStatisticsExcel` | `src/utils/statisticsExcel.js` | 통계 Excel 다운로드 | 문항 구조, 응답 데이터 |
| `buildReportDocx` | `src/utils/reportDocx.js` | DOCX 결과보고서 생성 | 보고서 섹션, 파일 다운로드 |

## 권한 의존 흐름

- `AuthContext`에서 role과 상태를 정규화한다.
- Firestore rules에서도 role과 상태를 다시 판정한다.
- 클라이언트 role이 맞아도 query가 rules에서 증명되지 않으면 `permission-denied`가 발생한다.
- 전체 collection list는 admin/super_admin 외에는 피한다.
- creator/staff/viewer는 `surveyId`, `ownerUid`, `ownerEmail`, `visibility` 기반 query를 우선한다.

## Runtime Flow

```text
Public User
  ↓
SurveyResponsePage
  ↓
submitSurveyResponse()
  ↓
responses
  ↓
quotaCounts
  ↓
responseCount
  ↓
SurveyResponsesAdminPage
  ↓
Statistics
  ↓
Survey Reports
  ↓
Excel
  ↓
DOCX
```

이 runtime flow는 공개 응답 제출부터 관리자 산출물까지 이어지는 운영 핵심 흐름이다. 한 단계의 변경은 뒤쪽 산출물 전체에 영향을 줄 수 있다.

## Role Flow

```text
Anonymous
  ↓
Public Survey
  ↓
Submit Response
```

```text
Creator
  ↓
Builder
  ↓
Responses
  ↓
Reports
```

```text
Admin / Super Admin
  ↓
All Surveys
  ↓
All Responses
  ↓
All Reports
  ↓
User Management
```

```text
Staff / Viewer
  ↓
Organization Surveys
  ↓
Organization Responses
  ↓
Read-only Operation
```

Role flow를 바꾸는 작업은 Firestore rules와 클라이언트 query를 함께 검증해야 한다.
