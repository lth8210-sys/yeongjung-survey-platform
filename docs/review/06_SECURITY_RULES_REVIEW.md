# 06. Security & Rules Review — 보안 규칙 · 권한 구조

> 평가 축: Firestore Rules / 권한 구조 / 내부·외부 권한 분리 / 감사로그 / 개인정보 보호
> 특별 검토: ① 외부 응답자가 내부 데이터 접근 불가한가 ② 내부 직원 권한이 role/status로 안정 작동하는가

---

## 6.1 권한 모델 개요

- **역할**: `super_admin` > `admin` > `creator` > `viewer` (users.js `ROLE_PRIORITY`).
- **상태**: `active` / `pending` / `inactive` / `blocked`.
- **판정이 두 곳에 중복**:
  - 클라이언트: `AuthContext` + `users.js`(`normalizeUserRole`/`normalizeUserStatus`).
  - 규칙: `firestore.rules`(`resolvedRole`/`resolvedStatus`/`normalizeStoredRole`...).
- 내부 판정: 이메일 도메인 `@yeongjung.or.kr`(정규식) 또는 users 문서 존재.
- 슈퍼관리자: 이메일 화이트리스트 2개가 **3곳에 하드코딩**(users.js `SUPER_ADMIN_EMAILS`, 규칙 `isProtectedSuperAdminEmailValue`, `protectedSuperAdminEmail`).

---

## 6.2 특별 검토 ① — 외부 응답자의 내부 데이터 접근 차단 여부

### 결론: **읽기 격리는 대체로 견고. 단, 공개 write 표면이 무방비.**

**잘 막힌 것 ✅**
- `responses` read: `canReadManagedResponse` — 익명/외부는 role 없음 → 응답 조회 불가.
- `surveys` get: 게시 상태(`surveyStatusForRead`)만 공개, 나머지는 관리자/소유자/조직공개.
- `users`·`memberships`·`audit_logs`·`survey_reports`·`survey_templates`: 전부 내부·admin 전제. 외부 접근 불가.
- 응답자 draft(`draftResponses`)는 `userId == auth.uid` 본인만.

**취약한 것 ⚠️ — 공개 create 규칙 (`responses`)**
```
allow create: if
  request.resource.data.surveyId is string &&
  request.resource.data.surveyTitle is string &&
  request.resource.data.answers is list &&
  request.resource.data.respondent is map &&
  exists(surveys/{surveyId}) &&
  surveyStatusForResponse(...) &&
  responseCount 정확히 +1 &&
  status in ["published","closed"];
```
문제점:
1. **필드 화이트리스트 없음**: `hasOnly([...])` 미적용 → 응답자가 `answers`·`respondent` 외 **임의 필드**(예: 위조된 `surveyOwnerEmail`, `status`, `deleted`, `quota`)를 써넣을 수 있다. 읽기 권한(`isResponseOwner`)이 `surveyOwnerUid/Email`에 의존하므로, **제출자가 이 값을 임의 지정**할 수 있다는 것은 권한 판정의 신뢰 근거가 클라이언트 입력이라는 뜻.
2. **크기·개수 상한 없음**: `answers`가 list이기만 하면 됨 → 거대 문서·대량 제출로 비용/오염.
3. **App Check 없음**: 규칙은 "요청이 정식 앱에서 왔는지" 검증 불가. 봇/스크립트 직접 호출 차단 수단 없음.

### 위험도: **Critical**
### 개선 방향
- **create에 `hasOnly()` 필드 화이트리스트** + `answers.size() <= N` + 각 문자열 길이 상한.
- 소유자 스냅샷 필드는 **규칙에서 `get(surveys/{surveyId}).data.ownerUid`와 일치 강제**하거나, 아예 클라이언트가 못 쓰게 하고 Functions 트리거로 채움.
- **Firebase App Check 활성화**(reCAPTCHA Enterprise/v3) — 공개 write 진입점 보호.
- `status`·`deleted`·`quota` 등 운영 필드는 create 시 고정값만 허용.

### 우선순위: P1 / 난이도: 중

---

## 6.3 특별 검토 ② — role/status 안정성

### 결론: **작동하나 "안정적"이라기보다 "누적 방어로 겨우 일치".**

**구조적 취약점**
1. **판정 이중화**: 같은 정규화 로직이 JS와 규칙 언어로 2벌 존재. KI-001/003/004가 모두 "클라이언트는 되는데 규칙이 증명 못 함" 유형 → **본질적으로 이 이중화가 원인**.
2. **legacy 흡수 과다**: `normalizeStoredRole`이 한글/영문/변형 8종(`슈퍼관리자`, `superAdmin`, `staff`...) 흡수, status는 `status`/`isActive`/`active`/`is_active` 4개 필드 흡수(`hasActiveStatusFlag`). 표면이 넓어 **의도치 않은 활성화** 경로 존재 가능(예: 어떤 문서에 `active: true`가 남아 있으면 status 무관하게 active로 판정).
3. **도메인 기반 자동 creator 승격**: users 문서 없는 `@yeongjung.or.kr` 사용자는 규칙상 자동 `creator`+`active`(`resolvedRole`/`resolvedStatus`), 클라이언트도 동일(`upsertInternalUserProfile`의 `isAutoAssignedInternalDefault`). → **내부 이메일만 있으면 승인 절차 없이 설문 생성 권한**. 편의성과 보안의 트레이드오프이나, 퇴사자·계정 탈취 시 즉시 creator 권한.
4. **슈퍼관리자 3중 하드코딩**: 한 곳만 바꾸면 권한 불일치. 주석으로 "SYNC REQUIRED" 경고가 있으나 사람 의존.

### 위험도: **High**
### 개선 방향
- **단일 권한 소스 = Custom Claims**: 관리자가 승인/역할변경 시 Functions가 `setCustomUserClaims({role, status})`. 규칙·클라이언트가 토큰만 신뢰 → 이중화·get() 제거.
- legacy 정규화는 **일회성 마이그레이션**으로 데이터를 표준값으로 정리 후, 규칙에서 legacy 분기 제거.
- 도메인 자동 승격 폐지 또는 "자동 viewer(pending)"로 하향 — 명시 승인 후 creator.
- 슈퍼관리자 목록을 단일 설정 문서/Claims로 이관.

### 우선순위: P1 / 난이도: 높음 (마이그레이션 수반)

---

## 6.4 내부 직원 권한 분리 (creator / admin / viewer)

### 현재 상태 — 대체로 합리적
- `creator`: 본인 소유 설문 + 조직공개(`organization`) 설문 읽기, 본인 것만 편집. 응답도 소유/편집 가능 설문만.
- `admin`/`super_admin`: 전체 설문·응답·유저·감사·보고서.
- `viewer`: 조직공개 설문 읽기 전용.

### 문제점
- creator의 소유 판정이 6개 필드 OR → 위조·불일치 표면(03.2).
- `viewer`가 조직공개 설문의 **응답까지** 읽을 수 있음(`canReadManagedResponse` → `canReadSurveyByIdWithAccess` → 조직공개면 true). 즉 조회자도 조직공개 설문의 **개인정보 포함 응답 원본**을 볼 수 있다. 의도된 것인지 확인 필요 — 복지 응답엔 PII가 흔하므로 **최소권한 위반 소지**.

### 위험도: **High** (viewer의 PII 응답 접근)
### 개선 방향: 조직공개는 "설문/통계 공개"까지로 제한하고, PII 포함 응답 원본은 admin/owner로 한정. PII를 서브컬렉션 분리(03.3)하면 자연스럽게 해결.
### 우선순위: P1 / 난이도: 중

---

## 6.5 감사로그(audit_logs) 구조

### 현재 상태
- create 규칙이 필드 스키마를 엄격히 강제(`hasOnly`, actor.uid/email/displayName 타입, `createdAt == request.time`). update/delete 금지. **좋은 설계.**
- 단, create 조건이 `canCreateAuditLog()` = `canEditSurveyById(surveyId)`. → **로그를 남기려면 해당 설문 편집권이 있어야 함**.

### 문제점
- **감사로그가 클라이언트에서 생성**됨. 즉 실패해도 조용히 무시(`createAuditLog`의 catch)되고, 악의적 클라이언트는 아예 안 남길 수 있다. → 감사로그는 "선의의 기록"일 뿐 **부인방지(non-repudiation) 보장 없음**.
- read가 `isAtLeastAdmin()` → creator는 자기 설문 감사로그도 못 봄(추적성 제한).
- `surveyId` 없는 이벤트는 아예 로그 생략(`createAuditLog` early return) → **응답 삭제 외 유저관리·권한변경 등 조직 차원 이벤트가 감사 대상에서 누락**.

### 위험도: **High** (감사 신뢰성)
### 개선 방향: 핵심 감사(삭제·권한변경·PII열람/다운로드)는 **Functions에서 서버 생성** → 클라이언트가 못 지우고 못 건너뜀. 유저/권한 이벤트도 surveyId 없이 기록 가능하게 스키마 확장.
### 우선순위: P1 / 난이도: 중

---

## 6.6 개인정보 · 민감정보 보호 (특별 검토)

### 현재 상태
- 화면 마스킹(`privacy.js`: 이름/전화/주소), 다운로드 마스킹(`maskResponsesForDownload`), 응답 익명화(`anonymizeResponsePii`).

### 문제점
- **저장은 평문**: 마스킹은 표시 계층만. Firestore에는 이름·전화·생년월일·주소가 평문(03.3). DB 유출 시 그대로 노출.
- **동의(consent) 처리**: `detectPrivacyQuestions`/`validatePrivacyConsent` 존재하나, 동의 없는 PII 수집을 구조적으로 막지는 않음(빌더에서 강제 아님).
- **다운로드 감사**: CSV 다운로드는 `responses_csv_downloaded` 감사 있음(좋음). 단 클라이언트 생성이라 6.5 한계 동일.
- **보존기간 정책 없음**: 응답·PII의 자동 파기 스케줄 없음. 개인정보보호법상 목적 달성 후 파기 의무 대응 수단 부재.

### 위험도: **High**
### 개선 방향
- PII 서브컬렉션 분리 + 접근 최소화 + (가능하면) 애플리케이션 레벨 암호화 또는 최소한 접근 로깅.
- 동의 문항 필수화(신청/조사 formType별) 규칙화.
- 보존기간 필드 + 자동 파기(Functions 스케줄 + `anonymizeResponsePii` 재사용).

### 우선순위: P1 / 난이도: 중~높음

---

## 6.7 보안 요약표

| 항목 | 위험도 | 개선 | 우선순위 |
|------|:------:|------|:--------:|
| 공개 responses create 무방비 | **Critical** | hasOnly+크기제한+App Check | P1 |
| role/status 이중화·legacy 과다 | High | Custom Claims 단일화 | P1 |
| 내부 이메일 자동 creator 승격 | High | 명시 승인·하향 | P1 |
| viewer의 PII 응답 접근 | High | PII 분리·권한 축소 | P1 |
| 감사로그 클라이언트 생성 | High | Functions 서버 생성 | P1 |
| PII 평문 저장·보존정책 없음 | High | 분리·암호화·파기 | P1 |
| 슈퍼관리자 3중 하드코딩 | Medium | 설정/Claims 이관 | P2 |
