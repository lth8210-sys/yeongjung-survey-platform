# Collection Dependency

Firestore collection과 화면/기능 의존관계를 정리한다. collection 구조를 바꾸거나 query를 바꾸기 전에 이 문서를 확인한다.

## Core Survey Flow

```text
users
  |
  | role / ownership
  v
surveys
  |
  | surveyId
  v
responses
  |
  | analytics input
  v
statistics
  |
  | report data
  v
survey_reports
  |
  | export
  v
Excel / DOCX
```

## Quota Flow

```text
surveys
  |
  | has subcollection
  v
quotaConfig
  |
  | defines matrix
  v
quotaCounts
  |
  | transaction update
  v
submitSurveyResponse()
```

## Template Flow

```text
surveys
  |
  | save as template
  v
survey_templates
  |
  | instantiate
  v
surveys
```

## Audit Flow

```text
admin action
  |
  | createAuditLog()
  v
audit_logs
```

감사로그 저장 실패는 화면 진입이나 주요 작업 성공을 막지 않아야 한다.

## Collection별 의존 기능

| Collection | 의존 화면 | 의존 기능 |
| --- | --- | --- |
| `users` | 로그인, 사용자 관리 | role, status, 권한 판정 |
| `surveys` | 설문 목록, 빌더, 공개 응답, 보고서 | 설문 구조, 공개 상태, 소유자 |
| `responses` | 응답 관리, 최근응답, 통계 | 제출 응답, 처리 상태, 다운로드 |
| `survey_reports` | 결과보고서 관리 | 보고서 저장, 복제, 삭제, DOCX |
| `survey_templates` | 새 폼 만들기, 템플릿 관리 | 템플릿 생성, 사용, 비활성화 |
| `audit_logs` | 감사로그 | 운영 추적, 장애 분석 |
| `quotaConfig` | 설문 빌더, 공개 응답, 응답 관리 | 목표 matrix, 마감 방식 |
| `quotaCounts` | 공개 응답, 응답 관리 | 누적 count, 부족 현황 |

## Query 의존관계

```text
creator role
  -> surveys owner query
  -> surveyId list
  -> responses by surveyId
  -> survey_reports by surveyId
```

```text
staff/viewer role
  -> surveys visibility == organization
  -> surveyId list
  -> responses by surveyId
  -> survey_reports by surveyId
```

```text
super_admin/admin role
  -> surveys full list
  -> responses full recent list
  -> survey_reports full list
```

## 변경 금지에 가까운 의존성

- `responses.surveyId`는 응답 관리, 통계, 보고서, 다운로드의 기준이다.
- `surveys.questions`는 응답 렌더링과 통계 계산의 기준이다.
- `quotaCounts`는 제출 트랜잭션과 삭제 보정 외 임의 수정하면 안 된다.
- `survey_reports.surveyId`는 보고서 권한과 목록 조회의 기준이다.
- `users.role`과 rules role 정규화는 함께 맞아야 한다.
