# Firestore Rules Guide

이 문서는 Firestore rules와 클라이언트 query가 일치하도록 유지하기 위한 운영 기준이다.

## Role 정의

| Role | 의미 |
| --- | --- |
| `super_admin` | 최고 관리자. 전체 설문, 응답, 사용자, 설정 관리 가능 |
| `admin` | 관리자. 전체 설문과 응답 운영 가능 |
| `creator` | 제작자. 본인 설문 생성, 수정, 응답 관리 가능 |
| `staff` | 직원 조회 권한. organization 설문 조회 중심 |
| `viewer` | 조회자. organization 설문 조회 중심 |

현재 코드에서는 `staff`가 `viewer`로 정규화될 수 있다. rules와 클라이언트의 role 정규화 정책은 항상 함께 확인한다.

## 권한 요약

| 기능 | super_admin | admin | creator | staff/viewer | 비로그인 |
| --- | --- | --- | --- | --- | --- |
| 공개 설문 읽기 | 가능 | 가능 | 가능 | 가능 | 가능 |
| private 설문 읽기 | 전체 가능 | 전체 가능 | 본인 설문 가능 | 불가 | 불가 |
| organization 설문 읽기 | 가능 | 가능 | 가능 | 가능 | 공개 상태만 |
| 설문 생성 | 가능 | 가능 | 가능 | 불가 | 불가 |
| 설문 수정 | 전체 가능 | 전체 가능 | 본인 설문 가능 | 불가 | 불가 |
| 설문 삭제 | 전체 가능 | 전체 가능 | 본인 설문 가능 | 불가 | 불가 |
| 설문 복제 | 가능 | 가능 | 접근 가능한 설문 기준 | 불가 | 불가 |
| 응답 제출 | 공개 설문 가능 | 공개 설문 가능 | 공개 설문 가능 | 공개 설문 가능 | 공개 설문 가능 |
| 전체 responses 조회 | 가능 | 가능 | 불가 | 불가 | 불가 |
| 설문별 responses 조회 | 가능 | 가능 | 본인 설문 가능 | organization 설문 가능 | 불가 |
| 응답 수정/처리상태 변경 | 가능 | 가능 | 본인 설문 가능 | 불가 | 불가 |
| 응답 삭제 | 가능 | 가능 | 제한적 가능 여부 확인 필요 | 불가 | 불가 |
| CSV 다운로드 | 가능 | 가능 | 본인 설문 가능 | 제한 | 불가 |
| Excel 다운로드 | 가능 | 가능 | 본인 설문 가능 | 제한 | 불가 |
| 결과보고서 읽기 | 전체 가능 | 전체 가능 | 본인 설문 가능 | organization 설문 가능 | 불가 |
| 결과보고서 작성/수정 | 가능 | 가능 | 본인 설문 가능 | 불가 | 불가 |
| 템플릿 읽기 | 가능 | 가능 | 활성 템플릿 가능 | 제한 | 불가 |
| 템플릿 생성 | 가능 | 가능 | 가능 | 불가 | 불가 |
| 템플릿 수정 | 가능 | 가능 | 사용 횟수 증가만 | 불가 | 불가 |
| quotaConfig 읽기 | 가능 | 가능 | 본인 또는 접근 가능 설문 | organization 설문 가능 | 공개 설문 가능 |
| quotaCounts 읽기 | 가능 | 가능 | 본인 또는 접근 가능 설문 | organization 설문 가능 | 공개 설문 가능 |
| quotaCounts 쓰기 | 관리자 또는 제출 트랜잭션 | 관리자 또는 제출 트랜잭션 | 제출 트랜잭션 | 제출 트랜잭션 | 제출 트랜잭션 |
| audit_logs 생성 | 접근 가능한 설문 기준 | 접근 가능한 설문 기준 | 본인 설문 기준 | 제한 | 불가 |
| audit_logs 조회 | 가능 | 가능 | 불가 | 불가 | 불가 |

## Query 설계 원칙

Firestore rules는 query 결과의 모든 문서가 허용된다는 것을 증명할 수 있어야 한다.

## Query Design Rules

### 절대 하지 말아야 하는 Query

아래 query는 admin/super_admin 전용으로 제한하거나, 가능하면 surveyId 기반으로 분해한다.

- creator/staff/viewer에서 `responses` 전체 조회
- creator/staff/viewer에서 `survey_reports` 전체 조회
- creator/staff/viewer에서 `audit_logs` 전체 조회
- staff/viewer에서 private 설문을 포함할 수 있는 `surveys` 전체 조회
- 권한 조건 없이 `survey_templates` 전체 조회
- report 목록에서 `surveyId` 없이 모든 문서를 가져온 뒤 클라이언트에서 필터링

### 반드시 해야 하는 Query

- 응답 조회는 가능한 한 `where('surveyId', '==', surveyId)` 사용
- 보고서 조회는 가능한 한 `where('surveyId', '==', surveyId)` 사용
- creator 설문 목록은 `ownerUid`, `createdByUid`, `ownerEmail`, `createdByEmail` 기반 사용
- staff/viewer 설문 목록은 `where('visibility', '==', 'organization')` 사용
- organization 공유 데이터는 `visibility` 기반으로 먼저 제한
- 권한 오류 재현 시 DEV logger에서 실제 path 확인

### 허용하기 쉬운 query

- `where('surveyId', '==', surveyId)` 기반 responses 조회
- `where('surveyId', '==', surveyId)` 기반 survey_reports 조회
- `where('visibility', '==', 'organization')` 기반 surveys 조회
- owner UID/email로 제한된 surveys 조회

### 주의가 필요한 query

- `responses` 전체 collection list
- `survey_reports` 전체 collection list
- `survey_templates` 전체 collection list
- `audit_logs` 전체 collection list

전체 collection list는 `super_admin` 또는 `admin`에게만 허용하는 방향을 기본값으로 한다.

## Role별 조회 기준

### super_admin/admin

- 전체 surveys 조회 가능
- 전체 responses 최신순 조회 가능
- 전체 survey_reports 조회 가능
- 전체 audit_logs 조회 가능

### creator

- 본인 소유 surveys 조회 가능
- organization surveys 읽기 가능
- 최근 응답은 본인 소유 surveyId 목록을 먼저 구한 뒤 surveyId별 responses 조회
- 보고서는 본인 소유 surveyId별 survey_reports 조회
- private 타인 설문 응답과 보고서는 조회 불가

### staff/viewer

- organization surveys 조회 가능
- 최근 응답은 organization surveyId별 responses 조회
- 보고서는 organization surveyId별 survey_reports 조회
- private 설문 응답, 보고서, 수정 기능 불가

## Rules 변경 체크리스트

- role 정규화가 클라이언트와 일치하는가
- `superadmin`, `super_admin`, `superAdmin` 호환이 필요한가
- collection list query가 rules에서 증명 가능한가
- creator 권한이 타인 private 데이터로 확장되지 않았는가
- staff/viewer가 private 응답을 볼 수 없게 유지되는가
- 응답 제출 create rule이 깨지지 않았는가
- quotaCounts public write 조건이 응답 제출에 필요한 범위로만 제한되는가
- dry-run을 수행했는가

## Permission-denied 사례

| 사례 | 실패 path | 원인 | 해결 | 재발방지 |
| --- | --- | --- | --- | --- |
| creator 목록 조회 | `surveys` 또는 owner 조건 없는 query | rules가 본인 설문만 증명할 수 없음 | owner UID/email query로 분리 | creator 목록은 접근 가능한 조건별 query 사용 |
| 최근응답 실패 | `responses?orderBy=submittedAt.desc&limit=30` | 전체 responses list를 role별로 증명하기 어려움 | admin은 전체 허용, 그 외는 surveyId별 조회 | creator/staff/viewer는 surveyId 목록 기반 |
| 설문별 응답 실패 | `responses?surveyId=={surveyId}` | surveyId 접근권한 또는 survey 문서 권한 불일치 | survey 접근권한과 response rule 동시 확인 | 설문 조회와 응답 조회를 같은 role 기준으로 검증 |
| 결과보고서 목록 실패 | `survey_reports` | 전체 report list를 creator/staff가 증명할 수 없음 | surveyId별 report query | report 목록은 접근 가능한 surveyId로 분해 |
| audit_logs 실패 | `audit_logs` | 감사로그는 관리자 조회 중심 | 화면 진입과 감사로그 저장을 분리 | 감사로그 저장 실패는 warn 처리 |
| quota subdoc 실패 | `surveys/{id}/quotaConfig/main` | 상위 survey 접근권한 불일치 | `canReadSurveySubdoc` 기준 확인 | quota 화면은 survey 권한과 함께 QA |
| 템플릿 목록 실패 | `survey_templates` | active/inactive 조회 권한 차이 | active query와 admin 전체 query 구분 | creator는 활성 템플릿 중심으로 확인 |
