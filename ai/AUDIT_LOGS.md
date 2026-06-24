# 감사로그 운영 가이드

최종 업데이트: 2026-06-24  
운영 기준: v0.36

## 1. 목적과 원칙

감사로그는 관리자와 제작자의 주요 운영 활동을 추적하기 위해 사용합니다.

- 컬렉션: `audit_logs`
- 조회 화면: `/admin/audit-logs`
- 기본 정렬: `createdAt` 내림차순
- 페이지 크기: 30건
- 필터: action, 설문 ID

자유의견 원문 전체, 개별 응답 내용, 보고서 본문 전체는 감사로그에 저장하지 않습니다.

## 2. 저장 구조

일반 감사로그는 `createAuditLog()`에서 다음 형태로 정규화해 저장합니다.

```text
audit_logs/{logId}
  action: string
  surveyId: string
  responseId: string | null
  actor:
    uid: string
    email: string
    displayName: string
  metadata: map
  createdAt: server timestamp
```

응답 삭제 트랜잭션은 다음 필드를 추가할 수 있습니다.

```text
  deletedBy:
    uid
    email
    displayName
  deletedAt: server timestamp
```

### payload 정규화

- `surveyId`와 action은 문자열로 저장합니다.
- `responseId`가 없으면 `null`입니다.
- `actor`의 세 필드는 항상 문자열입니다.
- metadata의 `undefined` 값은 제거합니다.
- metadata 배열은 문자열 배열로 변환합니다.
- metadata의 복잡한 객체는 문자열로 변환합니다.
- 동일 action과 동일 오류 코드의 저장 실패 경고는 화면 세션에서 한 번만 출력합니다.

감사로그 실패는 보고서 저장이나 다운로드 같은 본 기능을 중단시키지 않습니다.

## 3. 권한

| 작업 | 허용 역할 |
| --- | --- |
| 감사로그 생성 | 활성 `super_admin`, `admin`, `creator` |
| 감사로그 조회 | 활성 `super_admin`, `admin` |
| 감사로그 수정 | 불가 |
| 감사로그 삭제 | 불가 |

`creator`는 본인 활동 로그를 생성할 수 있지만 감사로그 관리자 화면에는 접근할 수 없습니다.

역할은 `users/{uid}` 문서의 `role`과 `status`를 기준으로 판정합니다. 슈퍼관리자 보호 이메일은 rules에서 `super_admin`, `active`로 우선 판정합니다.

## 4. 현재 action 목록

### 결과보고서

| action | 화면 표시 | 발생 시점 |
| --- | --- | --- |
| `report_settings_opened` | 결과보고서 설정 열람 | 응답 관리에서 설정 모달을 열 때 |
| `report_opened` | 결과보고서 열람 | 보고서 페이지가 열릴 때 |
| `report_edit_started` | 결과보고서 편집 시작 | 보고서 수정 모드 진입 |
| `report_saved` | 결과보고서 저장 | 편집 문구 저장 완료 |
| `report_summary_regenerated` | 결과보고서 자동문 재생성 | 규칙 기반 자동문 재생성 |
| `report_docx_downloaded` | 결과보고서 Word 다운로드 | 보고서 페이지에서 Word 생성 완료 |
| `report_print_clicked` | 결과보고서 인쇄/PDF 클릭 | 인쇄/PDF 실행 |
| `report_back_clicked` | 결과보고서 관리자 화면 복귀 | 관리자 화면으로 돌아가기 |
| `report_unsaved_print_attempt` | 결과보고서 저장 전 인쇄 시도 | 미저장 변경 상태에서 인쇄 시도 |
| `report_list_opened` | 결과보고서 관리 화면 열람 | `/admin/reports` 최초 진입 |
| `report_opened_from_list` | 목록에서 결과보고서 열람 | 목록의 열기 또는 PDF 작업 |
| `report_word_downloaded_from_list` | 목록에서 Word 다운로드 | 목록에서 Word 생성 완료 |
| `report_copied` | 결과보고서 복제 | 복사본 생성 완료 |
| `report_deleted` | 결과보고서 삭제 처리 | soft delete 완료 |

### 응답 관리 및 다운로드

| action | 화면 표시 | 발생 시점 |
| --- | --- | --- |
| `response_status_updated` | 상태 변경 | 응답 처리 상태 변경 |
| `response_admin_note_updated` | 메모 수정 | 관리자 메모 저장 |
| `response_anonymized` | 익명화 | 개인정보 응답 익명화 |
| `response_delete` | 영문 action 또는 응답 삭제 | 응답 soft delete 트랜잭션 |
| `responses_csv_downloaded` | CSV 다운로드 | 원본형·명단형·슬롯형 CSV 다운로드 |
| `statistics_excel_downloaded` | 통계 Excel 다운로드 | 통계 Excel 생성 완료 |

### 설문 템플릿

| action | 화면 표시 | 발생 시점 |
| --- | --- | --- |
| `survey_template_created` | 설문 템플릿 생성 | 기존 설문을 템플릿으로 저장 |
| `survey_template_updated` | 설문 템플릿 수정 | 템플릿명·설명·분류 수정 |
| `survey_template_used` | 설문 템플릿 사용 | 템플릿 기반 새 설문 저장 완료 |
| `survey_template_copied` | 설문 템플릿 복제 | 템플릿 복사본 생성 |
| `survey_template_disabled` | 설문 템플릿 비활성화 | 관리자가 템플릿을 비활성화 |
| `template_list_opened` | 설문 템플릿 목록 열람 | `/admin/templates` 최초 진입 |

`response_delete`는 현재 관리자 화면의 action 선택 목록에 별도 라벨이 없을 수 있으나 Firestore에는 action이 기록됩니다.

## 5. 주요 metadata

| 필드 | 용도 |
| --- | --- |
| `surveyTitle` | 설문명 |
| `reportId` | 보고서 문서 ID |
| `reportTitle` | 보고서 제목 |
| `reportPeriod` | 조사기간 |
| `target` | 조사대상 |
| `department` | 작성부서 |
| `sectionKeys` | 수정한 보고서 섹션 키 |
| `savedAt` | 저장 시각 |
| `copiedReportId` | 생성된 복사본 ID |
| `openMode` | 편집 또는 PDF 열기 방식 |
| `fromStatus`, `toStatus` | 응답 처리 상태 변경 |
| `downloadType` | CSV 종류 |
| `loadedCount` | 다운로드에 사용된 로드 건수 |
| `responseCount` | 통계 Excel 응답 수 |
| `anonymizedQuestionCount` | 익명화 문항 수 |
| `templateId` | 템플릿 문서 ID |
| `templateName` | 템플릿명 |
| `sourceSurveyId` | 템플릿의 원 설문 ID |
| `copiedTemplateId` | 생성된 템플릿 복사본 ID |

metadata에는 업무 추적에 필요한 식별자와 요약값만 저장합니다.

## 6. 감사로그 조회

1. `admin` 또는 `super_admin`으로 로그인합니다.
2. 상단 메뉴에서 `감사로그`를 선택합니다.
3. 작업 유형을 선택하거나 전체로 둡니다.
4. 특정 설문을 확인하려면 설문 ID를 입력하고 `적용`을 누릅니다.
5. 이전 기록은 목록 하단의 추가 로드 기능으로 조회합니다.

action과 설문 ID를 함께 사용한 쿼리는 Firestore 복합 인덱스가 필요할 수 있습니다.

## 7. Firestore rules 확인 사항

`audit_logs` create rules는 다음을 검사합니다.

- 현재 사용자가 활성 관리자 또는 제작자인가
- 허용된 최상위 필드만 있는가
- `action`, `surveyId`가 문자열인가
- `responseId`가 문자열 또는 `null`인가
- `actor`가 허용된 세 필드만 가진 map인가
- `metadata`가 map인가
- `createdAt`이 `request.time`인가
- 선택 필드 `deletedBy`, `deletedAt`의 타입이 올바른가

rules의 선택 필드 검사는 필드가 없는 일반 감사로그도 허용하도록 작성되어 있습니다.

## 8. `permission-denied` 해결

### 감사로그 생성 실패

1. 현재 계정의 `users/{uid}`를 확인합니다.
2. `role`이 `super_admin`, `admin`, `creator` 중 하나인지 확인합니다.
3. `status`가 `active`인지 확인합니다.
4. 운영 rules가 최신인지 확인합니다.
5. 다음 명령으로 rules를 배포합니다.

```bash
npx firebase deploy --only firestore:rules --dry-run
npx firebase deploy --only firestore:rules
```

6. 로그아웃·재로그인 후 다시 실행합니다.
7. 콘솔에서 action과 Firebase 오류 코드를 확인합니다.

### 감사로그 조회 실패

- 조회는 `admin` 이상만 허용됩니다.
- `creator` 계정이라면 저장은 가능하지만 `/admin/audit-logs` 조회는 불가합니다.
- `failed-precondition`이면 인덱스를 배포합니다.

```bash
npx firebase deploy --only firestore:indexes
```

### Hosting과 rules 버전 불일치

코드에서 payload를 변경했지만 Hosting만 배포하거나, rules만 변경하고 배포하지 않으면 오류가 지속될 수 있습니다.

```bash
npm run build
npx firebase deploy --only hosting
npx firebase deploy --only firestore:rules
```

## 9. 운영 점검 체크리스트

- 결과보고서 설정 모달 열기 후 `report_settings_opened`가 생성되는가
- 보고서 편집 시작 후 `report_edit_started`가 생성되는가
- 저장 후 `report_saved`가 생성되는가
- Word 다운로드 후 올바른 Word action이 생성되는가
- PDF 실행 후 `report_print_clicked`가 생성되는가
- 통계 Excel 다운로드 후 응답 수 metadata가 기록되는가
- 응답 삭제 시 `response_delete`, `deletedBy`, `deletedAt`이 기록되는가
- 자유의견 원문이나 보고서 본문 전체가 metadata에 없는가
- `creator`는 로그 생성이 가능하고 감사로그 화면 접근은 차단되는가
- 동일 permission 오류가 콘솔에 반복 출력되지 않는가

## 10. 현재 감사 범위의 제한

현재 action 목록은 결과보고서, 응답 처리 및 다운로드 중심입니다. 로그인·로그아웃과 모든 설문 생성·수정·상태 변경이 감사로그에 항상 기록된다고 가정하면 안 됩니다. 추가 감사 범위가 필요할 경우 action 정의, 화면 라벨, rules 허용 구조와 운영 문서를 함께 갱신해야 합니다.
