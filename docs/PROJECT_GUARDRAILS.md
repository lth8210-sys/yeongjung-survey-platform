# Project Guardrails

이 문서는 영중폼 운영 개발의 최상위 기준이다. Codex, Claude Code, 사람 개발자는 작업을 시작하기 전에 이 문서를 먼저 읽고 따라야 한다.

## 최우선 원칙

### Regression Zero

운영 중인 기능을 깨뜨리지 않는 것이 새 기능 개발보다 우선이다. 수정 범위가 작더라도 설문 생성, 응답 제출, 권한, 결과보고서, 다운로드, quota 중 하나라도 영향을 받을 수 있으면 회귀 테스트를 먼저 설계한다.

### Minimal Change

요구사항을 만족하는 가장 작은 변경만 한다. 관련 없는 리팩터링, 이름 변경, 파일 이동, 스타일 정리는 별도 작업으로 분리한다.

### Impact Analysis First

개발 전에 다음을 확인한다.

- 어떤 화면과 함수가 영향을 받는가
- 어떤 Firestore collection과 rules가 영향을 받는가
- 어떤 role이 영향을 받는가
- 기존 데이터와 호환되는가
- 실패 시 운영자가 어떻게 감지할 수 있는가

### Build Success Is Not Done

`npm run build` 성공은 최소 조건이다. 빌드가 성공해도 권한, 데이터 흐름, 응답 제출, 보고서, 다운로드 회귀가 남아 있으면 완료가 아니다.

### Commit After QA

커밋은 QA 체크리스트를 완료한 뒤에만 한다. 체크하지 않은 항목은 "미확인"으로 남기고, 그 이유를 커밋 메시지나 작업 보고에 적는다.

### Deploy After Operational Approval

배포는 운영 승인 후에만 한다. rules 변경, 응답 제출, 권한, quota, 결과보고서 관련 변경은 특히 dry-run과 운영 확인 계획이 필요하다.

## 절대 깨지면 안 되는 기능

다음 기능은 영중폼 운영의 핵심 기능이다. 변경 시 반드시 회귀 테스트를 수행한다.

- 설문 생성
- 설문 수정
- 설문 복제
- 설문 게시
- 설문 종료
- 일반 설문
- 만족도 조사
- 신청형
- Quota 설문
- 직원공유 설문
- 응답 제출
- 조건분기
- 기타 입력
- 최대 선택 개수
- Quota
- 결과보고서
- CSV
- Excel
- Creator 권한
- Staff 권한
- Viewer 권한
- Super Admin 권한

## 작업 전 확인

- 현재 브랜치를 확인한다.
- 작업 트리에 기존 변경이 있는지 확인한다.
- 사용자가 금지한 파일이나 영역이 있는지 확인한다.
- 어떤 Collection이 영향받는지 확인한다.
- 어떤 Query가 영향받는지 확인한다.
- 어떤 Firestore Rule이 영향받는지 확인한다.
- 어떤 Role이 영향받는지 확인한다.
- Firestore rules 변경 여부를 명확히 결정한다.
- 기존 데이터 구조 변경 여부를 명확히 결정한다.
- 변경 전 실제 실패 path나 재현 조건을 확보한다.

## Regression Risk Matrix

수정 기능이 아래 영역과 연결되면 반드시 해당 확인 항목을 수행한다.

| 수정 기능 | 영향 가능 기능 | 반드시 확인 |
| --- | --- | --- |
| 조건분기 | 응답 제출, 필수 응답, 페이지 흐름 | 공개 응답 제출 필수 |
| Quota | 응답 제출, quotaCounts, 결과보고서 | quota 제출과 보고서 필수 |
| 권한 | 설문 목록, 최근응답, 보고서, 템플릿 | role별 조회 필수 |
| 통계 | 응답 관리, Excel, 결과보고서 | Excel 다운로드 필수 |
| 보고서 | survey_reports, DOCX, 감사로그 | DOCX 다운로드 필수 |
| responses query | 최근응답, 설문별 응답, CSV | permission-denied path 확인 필수 |
| survey_reports query | 결과보고서 목록, 보고서 열람 | creator/private 접근 차단 필수 |
| survey_templates | 새 폼 만들기, 템플릿 관리 | active/inactive 권한 확인 필수 |
| audit_logs | 화면 진입, 운영 추적 | 저장 실패가 화면을 막지 않는지 확인 |
| 메뉴 라우팅 | 상단 navigation, 관리자 이동 | active 메뉴 하나만 표시 확인 |

## 운영 장애 재발방지 원칙

- `permission-denied`는 화면 메시지만 보지 말고 실제 Firestore path를 확인한다.
- `responses` 전체 조회는 admin/super_admin 외에는 금지한다.
- creator/staff/viewer 조회는 접근 가능한 `surveyId` 목록을 먼저 만든 뒤 `surveyId`별로 조회한다.
- `audit_logs` 저장 실패는 운영 화면 진입을 막지 않아야 한다.
- quota 관련 변경은 `quotaCounts` 증가, 감소, 음수 방지를 함께 확인한다.
- 보고서 변경은 `survey_reports` rules, DOCX 다운로드, 결과보고서 목록을 같이 확인한다.

## 작업 중 금지 사항

- 운영 데이터 직접 수정 금지
- 응답 제출 흐름 무단 변경 금지
- quotaCounts 임의 변경 금지
- responses 저장 구조 무단 변경 금지
- 권한 확대 무단 변경 금지
- 보고서 생성/다운로드 흐름 무단 변경 금지
- UI/UX 변경을 문서 작업에 끼워 넣기 금지
- unrelated formatting 금지

## 완료 기준

작업 완료 보고에는 최소한 다음을 포함한다.

- 변경 파일
- 변경 이유
- 권한 영향
- 데이터 영향
- rules 변경 여부
- 실행한 검증
- 실행하지 못한 검증과 이유
- commit/push/deploy 여부
