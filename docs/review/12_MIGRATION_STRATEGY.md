# 12. Migration Strategy — 데이터 · 구조 이행 전략

> 원칙: **운영 중단 없이, 되돌릴 수 있게, 검증하며.** 모든 이행은 ① 백업 → ② 이중 지원(dual-read) → ③ 백필 → ④ 검증 → ⑤ legacy 제거 순.

---

## 12.0 전제 — 이행 착수 전 필수

1. **자동 백업 켜기 먼저**: Firestore export(GCS) + PITR 활성화. 이행 중 롤백 지점 확보. (이게 없으면 어떤 마이그레이션도 시작 금지.)
2. **읽기 전용 스냅샷 확보**: 이행 스크립트 실행 전 수동 export 1회.
3. **에뮬레이터 리허설**: 모든 마이그레이션 스크립트는 Firestore 에뮬레이터에 프로덕션 복제본을 올려 먼저 실행·검증.

---

## 12.1 마이그레이션 목록 (의존 순)

| # | 이름 | 목적 | 위험 | 되돌리기 |
|---|------|------|:----:|----------|
| M1 | schemaVersion 백필 | 전 문서에 `schemaVersion:1` 부여 | 낮 | 필드 제거 |
| M2 | role/status 표준화 | legacy 8종 role·4필드 status를 표준값으로 | 중 | 백업 복원 |
| M3 | Custom Claims 이관 | users.role/status → 토큰 클레임 | 중 | 규칙 롤백 |
| M4 | 소유자 필드 정본화 | 6종 → `ownerUid`+`ownerEmail` | 중 | 병행 유지 |
| M5 | 카운터/집계 분리 | responseCount·optionQuota → 서브문서 + aggregates 백필 | **높** | dual-write |
| M6 | PII 서브문서 격리 | responses PII → `private/pii` + applicantKey 해시화 | **높** | 병행 유지 |
| M7 | Draft/version 도입 | draftQuestions·version 정립 | 중 | questions 유지 |
| M8 | 템플릿 버전화 | survey_templates schemaVersion + 정규화 | 낮 | — |

---

## 12.2 단계별 상세

### M1. schemaVersion 백필 (선행)
- 배치 스크립트로 `surveys/responses/survey_reports/survey_templates/users`에 `schemaVersion:1` 세팅.
- 정규화 함수가 `schemaVersion` 없으면 0으로 간주하도록 먼저 배포(dual-read).

### M2. role/status 표준화
- 스크립트: 각 users/memberships 문서의 role을 `normalizeUserRole` 결과로 덮어쓰고, status를 단일 `status` 필드로 통합(`isActive/active/is_active` 제거).
- **검증**: 이행 전후 각 사용자의 (role,status) 판정이 규칙·클라이언트에서 동일한지 스냅샷 비교.
- 완료 후에도 규칙의 legacy 분기는 **M3 이후에** 제거.

### M3. Custom Claims 이관
- Function `syncUserClaims(uid)`: users 문서의 표준 role/status를 `setCustomUserClaims`.
- 전 사용자 백필 실행 → 사용자 재로그인(또는 토큰 강제 갱신)로 클레임 반영.
- 규칙을 **Claims 우선, 없으면 기존 로직(fallback)** 으로 배포(dual-read). 전원 클레임 확인 후 fallback 제거.
- 권한 변경 UI가 이후 항상 `syncUserClaims` 호출하도록 수정.

### M4. 소유자 필드 정본화
- 스크립트: 각 survey의 owner를 `ownerUid`(없으면 createdByUid 등에서 파생)·`ownerEmail`로 채움. creator 쿼리·규칙을 2종만 쓰도록 축소.
- legacy 필드는 읽기만 유지하다 검증 후 제거.

### M5. 카운터/집계 분리 (고위험)
- **dual-write 기간**: 신규 응답 제출이 본문 `responseCount`와 새 `counters`/`aggregates`를 동시 갱신.
- 백필: 기존 응답을 설문별로 스캔해 `aggregates/summary` 생성(설문별 1회, 야간 배치).
- 통계 화면을 aggregates 읽기로 전환(비교 로그로 정합 확인).
- 정합 확인 후 본문 카운터 쓰기 중단 → submitResponse Function만 집계 갱신.

### M6. PII 격리 (고위험·개인정보)
- 스크립트: 각 response의 PII를 `responses/{id}/private/pii`로 복사, `applicantKey`를 해시로 치환, 상위 문서의 PII 필드 제거.
- **순서 주의**: 먼저 서브문서 생성·검증 → 화면/다운로드를 서브문서 읽기로 전환 → 상위 PII 제거.
- 규칙에서 상위 responses read를 viewer/조직공개까지 열되 PII 서브문서는 admin/owner로 제한.
- 보존기간(`retentionUntil`) 백필(기본값 정책 결정 필요 — 개인정보 담당자 승인).

### M7. Draft/version
- 스크립트: 기존 게시 설문의 `questions`를 `draftQuestions`에도 복사, `version:1` 부여.
- 빌더를 draft 편집 + 명시 게시로 전환. 응답 제출이 게시 `version`을 `submittedVersion`으로 기록.

### M8. 템플릿 버전화
- surveyData에 schemaVersion, 인스턴스화에 마이그레이션 훅.

---

## 12.3 이행 안전장치

- **모든 스크립트는 dry-run 모드 우선**(변경 건수·샘플 출력, 실제 쓰기 없음). `scripts/repairSurvey.mjs` 패턴을 확장해 재사용.
- **배치·재개 가능**: 커서 기반 페이지네이션 + 진행 상태 문서로 중단 재개.
- **정합 검증 리포트**: 이행 후 자동 대사(count 일치, PII 잔존 0, 판정 동일) 산출.
- **롤백 계획**: 각 M단계에 되돌리기 명시(위 표). 고위험(M5/M6)은 legacy 병행을 최소 1주 유지.

---

## 12.4 순서 요약 (권장)

```
M1 schemaVersion
  → M2 role/status 표준화 → M3 Claims 이관 (권한 안정화)
  → M4 소유자 정본화
  → M7 draft/version (게시 안전화)
  → M5 카운터/집계 (성능·비용) [고위험]
  → M6 PII 격리 (개인정보) [고위험]
  → M8 템플릿 버전
```
권한(M2/M3)을 먼저 안정화해야 이후 이행의 접근·감사가 신뢰 가능. 고위험 데이터 이행(M5/M6)은 백업·집계 검증 체계가 선 갖춰진 뒤 착수.
