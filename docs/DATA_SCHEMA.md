# Data Schema

영중폼 운영 데이터 구조를 collection별로 정리한다. 이 문서는 실제 운영 데이터와 Firestore rules, query 설계를 함께 확인하기 위한 기준이다.

## users

직원 계정, 권한, 상태를 관리한다.

| Field | 의미 |
| --- | --- |
| `uid` | Firebase Auth 사용자 UID |
| `email` | 사용자 이메일. 내부 계정과 super admin 판정에 사용 |
| `displayName` | 화면에 표시할 이름 |
| `role` | `super_admin`, `admin`, `creator`, `viewer` 등 권한 |
| `status` | `active`, `pending`, `inactive`, `blocked` 등 계정 상태 |
| `source` | 계정 생성 또는 동기화 출처 |
| `membershipId` | 사전 등록 membership과 연결되는 ID |
| `createdAt` | 사용자 문서 생성 시각 |
| `updatedAt` | 사용자 문서 수정 시각 |

## surveys

설문 본문, 운영 설정, 권한 소유자를 저장하는 핵심 collection이다.

| Field | 의미 |
| --- | --- |
| `title` | 설문 제목 |
| `description` | 설문 안내 문구 |
| `status` | `draft`, `published`, `closed`, `deleted` 등 운영 상태 |
| `visibility` | `private` 또는 `organization` |
| `questions` | 운영 설문 문항 배열 |
| `sections` | 페이지/섹션 구조 |
| `responseCount` | 제출된 응답 수 |
| `ownerUid` | 설문 소유자 UID |
| `ownerEmail` | 설문 소유자 이메일 |
| `createdBy` | 생성자 메타데이터 |
| `createdAt` | 생성 시각 |
| `updatedAt` | 수정 시각 |
| `quotaEnabled` | 전체 정원 제한 사용 여부 |
| `maxResponses` | 최대 응답 수 |

### Future

| Field | 의미 |
| --- | --- |
| `draftQuestions` | 편집 중인 문항. 운영 문항 `questions`와 분리 예정 |
| `version` | 게시 버전 번호. 응답 버전관리와 연결 예정 |

## responses

응답자가 제출한 원본 응답을 저장한다.

| Field | 의미 |
| --- | --- |
| `surveyId` | 연결된 설문 ID |
| `surveyTitle` | 제출 시점 설문 제목 |
| `answers` | 응답 배열 또는 응답 데이터 |
| `respondent` | 응답자 메타데이터 |
| `submittedAt` | 제출 시각 |
| `quota` | quota 매칭 결과 |
| `deleted` | 삭제 처리 여부 |
| `surveyOwnerUid` | 설문 소유자 UID 스냅샷 |
| `surveyOwnerEmail` | 설문 소유자 이메일 스냅샷 |
| `applicationStatus` | 신청 처리 상태 |
| `adminNote` | 관리자 메모 |

### Future

| Field | 의미 |
| --- | --- |
| `submittedVersion` | 응답자가 제출한 설문 게시 버전 |

## survey_reports

결과보고서 저장본을 관리한다.

| Field | 의미 |
| --- | --- |
| `surveyId` | 연결된 설문 ID |
| `title` | 보고서 제목 |
| `periodStart` | 분석 시작일 |
| `periodEnd` | 분석 종료일 |
| `period` | 표시용 기간 |
| `target` | 조사 대상 |
| `department` | 담당 부서 |
| `author` | 작성자 |
| `reportDate` | 보고서 작성일 |
| `sections` | 보고서 섹션별 본문 |
| `status` | `draft` 또는 `final` |
| `deleted` | 삭제 처리 여부 |
| `createdBy` | 생성자 메타데이터 |
| `updatedBy` | 수정자 메타데이터 |
| `createdAt` | 생성 시각 |
| `updatedAt` | 수정 시각 |

## survey_templates

재사용 가능한 설문 구조를 저장한다.

| Field | 의미 |
| --- | --- |
| `name` | 템플릿 이름 |
| `description` | 템플릿 설명 |
| `category` | 템플릿 분류 |
| `surveyData` | 설문 구조와 운영 설정 스냅샷 |
| `sourceSurveyId` | 원본 설문 ID |
| `copiedFromTemplateId` | 복사 원본 템플릿 ID |
| `usageCount` | 사용 횟수 |
| `active` | 활성 여부 |
| `createdBy` | 생성자 메타데이터 |
| `updatedBy` | 수정자 메타데이터 |
| `createdAt` | 생성 시각 |
| `updatedAt` | 수정 시각 |

## audit_logs

운영 중 주요 관리자 동작을 기록한다.

| Field | 의미 |
| --- | --- |
| `action` | 수행한 작업 이름 |
| `surveyId` | 연결된 설문 ID |
| `responseId` | 연결된 응답 ID |
| `actor` | 작업자 메타데이터 |
| `metadata` | 작업별 추가 정보 |
| `createdAt` | 로그 생성 시각 |
| `deletedBy` | 삭제 관련 작업자 메타데이터 |
| `deletedAt` | 삭제 관련 시각 |

## quotaConfig

경로: `surveys/{surveyId}/quotaConfig/main`

| Field | 의미 |
| --- | --- |
| `enabled` | quota 사용 여부 |
| `totalTarget` | 전체 목표 응답 수 |
| `baseYear` | 연령 계산 기준연도 |
| `regionMode` | 권역 계산 방식 |
| `closeMode` | 목표 도달 시 처리 방식 |
| `ageGroups` | 연령대 정의 |
| `regions` | 권역과 행정동 정의 |
| `matrix` | 권역 x 연령대 목표 수 |
| `updatedAt` | 수정 시각 |

## quotaCounts

경로: `surveys/{surveyId}/quotaCounts/main`

| Field | 의미 |
| --- | --- |
| `total` | 전체 누적 응답 수 |
| `cells` | 권역 x 연령대 누적 응답 수 |
| `updatedAt` | 수정 시각 |

## Collection 관계

```text
users
  ↓ owns / manages
surveys
  ↓ receives
responses
  ↓ feeds
statistics
  ↓ writes
survey_reports
  ↓ exports
Excel / DOCX
```

```text
surveys
  ↓ configures
quotaConfig
  ↓ counted by
quotaCounts
  ↓ updated during
submitSurveyResponse
```

```text
surveys
  ↓ can become
survey_templates
  ↓ instantiate
surveys
```
