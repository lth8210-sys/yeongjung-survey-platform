# 03. Information Architecture Review — 정보 구조 · 데이터 모델 리뷰

> 평가 축: 컬렉션 구조 / 문항 유형 / 척도·선택지·표 문항 / 응답 저장 구조 / 템플릿과 응답 분리

---

## 3.1 컬렉션 지도

```
users                     직원 계정(role/status/membershipId)
memberships               사전등록(이메일 = 문서ID, 승인 기준)
surveys                   설문 본문 + 운영설정 + 소유자 + responseCount
 ├ quotaConfig/main       권역×연령대 목표 매트릭스
 ├ quotaCounts/main       권역×연령대 누적 카운트  ← 민감(임의수정 금지)
 ├ applicationApplicantLocks/{hash}    1인 중복방지 lock
 ├ applicationSlotLocks/{...}          슬롯 중복방지 lock
 └ clientSubmitLocks/{hash}            제출 멱등성 lock
responses                 제출 원본(answers/respondent/quota/status/deleted)
survey_reports            결과보고서 저장본(sections 텍스트)
survey_templates          재사용 설문 구조 스냅샷
audit_logs                관리자 작업 로그
draftResponses            응답자 임시저장(서버측; userId 기준)
```

### 평가
- **분리 자체는 합리적**: 설문/응답/보고서/템플릿/감사가 명확히 나뉘어 있고, quota를 서브컬렉션으로 뺀 것은 좋은 결정(응답 트랜잭션에서 경합 최소화).
- lock 3종을 서브컬렉션으로 분리해 멱등성·중복방지를 문서 존재로 표현한 것도 견고.

---

## 3.2 `surveys` 문서 — 비대·혼재

### 현재 상태
한 문서에 다음이 모두 들어감: 제목/설명/`tableBlocks`/`questions`/`draftQuestions`/`sections`/`optionQuotaCounts`/상태/가시성/7개 기능 플래그/일정/소유자 스냅샷/`responseCount`/템플릿 메타데이터.

### 문제점
- **문서 크기·쓰기 경합**: `optionQuotaCounts`와 `responseCount`가 같은 문서에 있어, 모든 응답 제출이 설문 본문 문서를 업데이트한다. 인기 설문에서 **1초 1건 쓰기 한도(핫 문서)** 경합 가능.
- **소유자 판정 필드가 6종**(`ownerUid`, `createdByUid`, `ownerId`, `userId`, `ownerEmail`, `createdByEmail`, `createdBy.uid/email`). 규칙 `isSurveyOwner`도 동일하게 6종을 OR로 검사 → 어느 것이 정본인지 불명확, 위조·불일치 표면 넓음. (코드 주석에 이미 "ownerId/userId 필드 없음"이라 쿼리 제거한 흔적 있음 = 필드 난립 증거.)
- `questions`와 `draftQuestions` 둘 다 존재하나 게시 흐름이 이를 구분해 쓰지 않음(02.4 참조).

### 위험도: **High**
### 개선 방향
- **카운터 분리**: `responseCount`·`optionQuotaCounts`를 `surveys/{id}/counters/main` 서브문서 또는 분산 카운터로 이동. 본문 문서는 편집 시에만 쓰기.
- **소유자 필드 정본화**: `ownerUid`+`ownerEmail` 2종만 정본으로 채택, 나머지는 마이그레이션 후 폐기. 규칙도 2종만 검사.

### 우선순위: P1 / 난이도: 중

---

## 3.3 `responses` 문서 — 스냅샷 과다 · PII 평문

### 현재 상태 (submitSurveyResponse L2728~)
한 응답 문서에 저장되는 필드: `surveyId`, `surveyTitle`, `clientSubmitId`, `surveyType`, `surveyOwnerEmail/Uid`, `surveyCreatedByEmail/Uid`, `surveyDeleted`, `answers`, `status`, `responseMode`, `visibleQuestionIds`, `visibleSectionIds`, `skippedQuestionIds`, `quota`, `respondent{applicantName, applicantPhone, applicantBirthDate, applicantKey, slotSelections...}`, `respondentName`, `respondentPhone`, `selectedSlotLabel`, ...

### 문제점
- **PII 평문 저장 + 중복 저장**: 이름·전화가 `answers[]`, `respondent.applicantName/Phone`, 최상위 `respondentName/respondentPhone` **3중**으로 평문 저장. 익명화 시 3곳을 모두 덮어야 하고(`anonymizeResponsePii`가 실제로 3곳 처리), 한 곳이라도 누락되면 PII 잔존.
- **`applicantKey`에 원본 PII 포함**: `phone:010-...` 또는 `name-birth:홍길동::19900101` 평문. lock ID는 해시(`hashString`)지만 응답 문서의 `applicantKey`는 평문 → 익명화 대상.
- **소유자 스냅샷이 클라이언트 제공**: 제출 시 클라이언트가 `surveyOwnerUid/Email`을 써넣고, **읽기 권한(`isResponseOwner`)이 이 값에 의존**. 생성 규칙은 이 필드를 검증하지 않음(06 참조).
- `answers` 크기 상한 없음 → 문서당 1MB 한계까지 오염 가능.

### 위험도: **High** (개인정보)
### 개선 방향
- PII를 `responses/{id}/private/pii` 서브문서로 분리하고 접근을 admin+owner로 더 좁게 제한. 통계·목록은 PII 없는 상위 문서만 읽게.
- `applicantKey`는 항상 해시로만 저장(평문 제거).
- 소유자 스냅샷은 **서버(Functions) 또는 규칙의 `get()`으로 설문 문서에서 파생**시켜 클라이언트 위조 차단.
- `answers` 항목 수·문자열 길이 상한을 규칙/서버에서 강제.

### 우선순위: P1 / 난이도: 중~높음

---

## 3.4 문항 유형 구조

### 현재 상태 (16종, surveyConstants.js)
텍스트(shortText/longText/email/phone/date/time/number), 척도(linearScale/ratingScale/npsScale), 선택(singleChoice/multipleChoice/dropdown/applicationSlotChoice), 동의(consentCheckbox), 비응답 블록(descriptionBlock/sectionTitle).

### 평가 / 문제점
- 커버리지 양호. `SELECTABLE`·`NON_RESPONSE`·`SCALE` 집합으로 유형별 처리 분기 명확.
- **표(matrix/grid) 문항이 진짜 문항이 아님**: `tableBlocks`는 설문 본문에 **표시용 정적 표**로만 존재(`SurveyTableBlocks` 렌더). 응답 가능한 행렬형 문항(예: 항목별 5점척도 표)은 없음 → 복지 만족도 조사에서 흔한 "문항 매트릭스"를 개별 척도 문항 나열로 대체해야 함.
- 파일 업로드 문항 없음(신청서 첨부 불가).

### 위험도: Medium
### 개선 방향: 응답형 matrix 문항 유형 추가(각 셀이 척도/선택), 파일 업로드는 Firebase Storage 연동으로 별도 설계.
### 우선순위: P2 / 난이도: 중

---

## 3.5 척도 · 선택지 정규화

### 현재 상태
`surveyNormalize.js`가 척도 config(`getScaleQuestionConfig`), 선택지(`sanitizeQuestionOptions`), 기타옵션(`OTHER_OPTION_VALUE = '__other__'`)을 정규화. 옵션별 정원(`optionQuotaCounts`)과 슬롯 선택을 지원.

### 문제점
- 선택지 값과 라벨이 문자열 동일시되는 부분이 있어(정원 키가 `buildOptionQuotaKey(questionId, optionValue)`), **라벨을 수정하면 기존 응답·정원 키가 어긋남**. 옵션에 안정적 `id`가 없다.
- 척도 답변 포맷팅(`formatScaleAnswer`)이 통계·다운로드 여러 경로에서 재구현될 위험.

### 위험도: Medium
### 개선 방향: 옵션에 불변 `id` 부여(값/라벨과 분리), 정원·응답 키를 id 기반으로.
### 우선순위: P2 / 난이도: 중(마이그레이션 수반)

---

## 3.6 템플릿 ↔ 응답 데이터 분리 (특별 검토 항목)

### 결론: **분리는 되어 있으나 버전 경계가 없다.**
- `survey_templates.surveyData`(설문 구조 스냅샷)와 `responses`(실제 응답)는 서로 다른 컬렉션 — **혼입 위험 없음**. ✅
- 그러나 템플릿 스냅샷도, 응답도 `schemaVersion`이 없어, 앱이 질문 구조를 바꾸면 과거 스냅샷/응답 해석이 조용히 깨질 수 있음.

### 위험도: Medium
### 개선 방향: 템플릿·응답·설문 모두 `schemaVersion` 부여 + 정규화 함수가 버전 인지.
### 우선순위: P2 / 난이도: 중

---

## 3.7 정보구조 요약표

| 항목 | 현재 | 위험도 | 개선 | 우선순위 |
|------|------|:------:|------|:--------:|
| surveys 문서 비대·핫문서 | 카운터 혼재 | High | 카운터 서브문서 분리 | P1 |
| 소유자 필드 6종 난립 | OR 검사 | High | 2종 정본화 | P1 |
| responses PII 3중 평문 | 평문 저장 | High | PII 서브컬렉션+해시 | P1 |
| 응답형 matrix/파일 문항 없음 | 미지원 | Medium | 유형 추가 | P2 |
| 옵션 안정 id 없음 | 값=키 | Medium | id 부여 | P2 |
| schemaVersion 부재 | 없음 | Medium | 전 컬렉션 버전화 | P2 |
