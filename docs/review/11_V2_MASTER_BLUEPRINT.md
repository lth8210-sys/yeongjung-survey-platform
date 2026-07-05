# 11. V2 Master Blueprint — 영중 설문 플랫폼 v2.0 설계

> 목표: **현장 사용성 중심 · 안전한 응답데이터 구조 · 보고서 자동화 기반**
> 원칙: v1의 강점(실무 완결성·정원 트랜잭션·보고서 자동화·문서화 문화)을 **계승**하고, 구조적 리스크를 제거.

---

## 11.0 설계 3원칙

1. **신뢰 경계를 서버로 이동** — 클라이언트는 UI, 진실은 서버(Functions)와 규칙. 공개 write는 검증된 경로로만.
2. **단일 권한 소스** — role/status는 Custom Claims 하나로. 규칙·클라이언트가 같은 토큰을 읽는다.
3. **데이터는 버전과 함께** — 모든 핵심 문서에 `schemaVersion`. 진화 가능하고 복구 가능하게.

---

## 11.1 아키텍처 (v2)

```
[응답자/직원 브라우저]
      │  (App Check 토큰 필수)
      ▼
[React SPA]  ── UI·미리보기·초안 ──
      │
      ├── 공개 응답 제출 ─────────► [Cloud Function: submitResponse]
      │                                   │ 검증(크기·필수·정원·중복·유해성)
      │                                   │ 원자 처리: response 생성 + 증분집계 + lock
      │                                   ▼
      ├── 관리 CRUD ──► Firestore(Rules: Custom Claims 기반) ◄── 집계/PII 서브문서
      │
      └── 권한 변경 ──► [Cloud Function: setRole] ─► setCustomUserClaims
```

- **App Check**(reCAPTCHA Enterprise)로 모든 요청에 앱 무결성 토큰.
- **submitResponse Function**이 공개 제출의 유일한 경로 → 클라이언트 직접 write 차단(규칙에서 공개 create 제거 또는 Function 서비스계정만 허용).
- 관리 읽기/편집은 규칙 직접(Custom Claims)으로 저비용 유지.

---

## 11.2 데이터 모델 (v2)

### surveys (본문 — 편집 시에만 쓰기)
```
schemaVersion, title, description, tableBlocks,
draftQuestions[],   // 편집본
questions[],        // 게시본 (draft에서 명시적 publish 시 복사)
version,            // 게시 버전 (publish마다 +1)
sections[], formType, capabilities{branching,quota,duplicate,roster,processing},
visibility, ownerUid, ownerEmail,   // 소유자 2종만
status(draft/scheduled/published/closed/archived),
opensAt, closesAt, createdBy, updatedBy, createdAt, updatedAt
```
- 카운터·정원은 본문에서 제거 → 서브컬렉션으로.

### surveys/{id}/aggregates/summary (증분 집계 — O(1) 통계/보고서)
```
schemaVersion, responseCount, byQuestion{ [qid]: {optionCounts, scoreSum, scoreN} },
quotaTotal, lastResponseAt, updatedAt
```
### surveys/{id}/counters/* (분산 카운터)
### surveys/{id}/quotaConfig|quotaCounts (유지)

### responses (PII 제거된 상위 문서 — 통계/목록용)
```
schemaVersion, surveyId, version(submittedVersion), submittedAt,
answers[](비PII), quotaCell, status, deleted, responseMode,
visibleQuestionIds, skippedQuestionIds
```
### responses/{id}/private/pii (PII 격리 서브문서 — admin/owner만)
```
applicantName, applicantPhone(암호화 권장), applicantBirthDate,
applicantKeyHash(평문 금지), slotSelections, retentionUntil
```
- 소유자 스냅샷은 Function이 설문에서 파생해 세팅(클라이언트 위조 불가).

### survey_templates / survey_reports
- 각각 `schemaVersion`. 보고서에 **통계 스냅샷(JSON)** 필드 추가(시점 고정·재현성).

### users
- Firestore 문서는 프로필 정보만. **role/status의 진실은 Custom Claims**. 문서는 표시·관리 편의용 미러.

---

## 11.3 권한 모델 (v2)

| 주체 | 접근 |
|------|------|
| 익명 응답자 | 게시 설문 읽기 + submitResponse Function 호출(App Check) 만 |
| viewer | 조직공개 설문·**집계/통계**만. PII 응답 원본 ✖ |
| creator | 본인 소유 설문 CRUD + 본인 응답(집계·PII) |
| admin | 전체 설문·응답·집계·PII·유저·감사·보고서 |
| super_admin | admin + 시스템 설정·다른 admin 관리 |

- role/status = `request.auth.token.role` / `.status` (Claims). 규칙에서 `get(users)` 제거.
- PII 서브문서 접근은 admin + 소유 creator만. viewer·조직공개 경로에서 PII 차단.

---

## 11.4 설문 빌더 (v2 — 위저드)

1. **유형 선택**: 조사 / 신청 → 세부 프리셋. capabilities 불변식 자동 적용.
2. **문항 구성**: 좌 편집 / 우 실시간 응답자 미리보기. 질문블록·템플릿 삽입. **자동 draft 저장**.
3. **옵션**: 정원·중복방지·일정·동의 (고급 접힘, 변경 영향 안내).
4. **검토·게시**: 변경 diff 요약 → 명시적 "게시"(draft→questions, version++).

- 게시 후 편집은 "새 버전 편집" 모드 — 진행 중 응답 보호.

---

## 11.5 응답자 경험 (v2)

- 접근성 우선(08): ARIA 오류·필수, 네이티브 폼 시맨틱, 44px 터치, 16px 본문, 페이지 진행바·live 공지.
- 자동저장·멱등 제출·분기·정원 마감 안내(v1 계승).
- 제출은 Function 경유 — 서버가 정원·중복·크기 최종 검증.

---

## 11.6 보고서 자동화 (v2)

- 통계는 `aggregates/summary`에서 O(1) 로드.
- 문항별 **차트 이미지 렌더 → DOCX 삽입**.
- 보고서 저장 시 **통계 스냅샷 동봉** → 시점 일관성.
- 규칙기반 서술 유지 + (선택) Claude API 초안 보조(사람 검수 전제).

---

## 11.7 보안·운영 기반 (v2)

- App Check 전면, 공개 write는 Function만.
- 일일 Firestore export(GCS) + PITR.
- 감사로그: 삭제·권한변경·PII열람/반출은 **Function 서버 생성**.
- PII 보존기간(`retentionUntil`) + 자동 파기 스케줄.
- 자동화 테스트: 순수함수(Vitest) + Rules 에뮬레이터 + 핵심 흐름 E2E.

---

## 11.8 v1 → v2 매핑 요약

| v1 리스크 | v2 해법 |
|-----------|---------|
| 공개 create 무방비(RA-01/02) | App Check + submitResponse Function + 규칙 하드닝 |
| 권한 이중화(RA-07/08) | Custom Claims 단일 소스 |
| 게시 즉시 반영(RA-04) | draftQuestions/version 분리 + 명시 게시 |
| 백업 없음(RA-05) | 일일 export + PITR |
| PII 평문·과다(RA-06/09) | PII 서브문서 격리 + Claims 권한 |
| 감사 완전성(RA-10) | Function 서버 생성 |
| 핫 문서(RA-11) | 카운터/집계 서브문서 분리 |
| 통계 비용(RA-17) | 증분 집계 O(1) |
| CSV 인젝션(RA-03) | 셀 sanitize |
| 접근성(RA-18) | 응답자 우선 ARIA/터치/대비 |
| 테스트 없음(RA-14) | Vitest + Rules 에뮬 |
