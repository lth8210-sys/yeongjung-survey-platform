# 13. Implementation Roadmap — 단계별 실행 계획

> 4개 페이즈. 각 항목: 리스크 ID · 산출물 · 난이도 · 선행조건. "안전망 먼저, 그 다음 구조."
> 규모(인원/시간)는 팀 상황에 맞게 조정 — 여기서는 **순서와 게이트**를 정의한다.

---

## Phase 0 — 안전망 & 긴급 완화 (Stabilize)
> 목표: 지금 규모에서 당장 위험한 것을 저비용으로 막고, 이후 작업의 안전망을 만든다.

| 작업 | 리스크 | 난이도 | 선행 |
|------|:------:|:------:|------|
| Firestore 일일 export(GCS) + PITR 활성화 | RA-05 | 낮 | — |
| CSV/Excel 셀 sanitize(`= + - @ \t \r` prefix) | RA-03 | 낮 | — |
| 응답 debug payload PII 로깅 제거 / DEV·마스킹 가드 | RA-12 | 낮 | — |
| 공개 `responses` create에 `hasOnly()` 필드 화이트리스트 + `answers.size()` 상한 + 문자열 길이 제한 | RA-01 | 중 | 규칙 QA |
| Firebase App Check(reCAPTCHA Enterprise) 활성화 | RA-01/02 | 중 | 앱 등록 |
| 순수 함수 Vitest 도입(responseFlow·normalize·quota·csv·analytics) | RA-14 | 낮~중 | — |
| Rules 에뮬레이터 테스트 스캐폴딩 | RA-14 | 중 | — |

**게이트 G0**: 위 완료 전에는 외부 대량 홍보·신규 대형 조사 오픈 보류 권고.

---

## Phase 1 — 권한 단일화 (Trust)
> 목표: KI 반복 장애의 근본(권한 이중화)을 제거. Custom Claims 단일 소스.

| 작업 | 리스크 | 난이도 | 선행 |
|------|:------:|:------:|------|
| M1 schemaVersion 백필 | RA-16 | 낮 | 백업 |
| M2 role/status 표준화 마이그레이션 | RA-07 | 중 | M1 |
| Function `syncUserClaims` + 권한변경 UI 연동 | RA-07 | 중 | M2 |
| M3 Claims 이관 + 규칙 dual-read→Claims 전환 | RA-07 | 높 | syncUserClaims |
| 내부 이메일 자동 creator 승격 → 명시 승인/viewer 하향 | RA-08 | 중 | Claims |
| 감사로그 핵심 이벤트 Function 서버 생성(삭제·권한·PII) | RA-10 | 중 | Functions |
| 슈퍼관리자 목록 설정/Claims 이관 | RA-20 | 낮 | Claims |

**게이트 G1**: 전 사용자 클레임 반영·판정 정합 리포트 통과 후 규칙 legacy 분기 제거.

---

## Phase 2 — 데이터 안전 & 성능 (Protect & Scale)
> 목표: PII 격리, 핫문서 해소, 통계 O(1). 고위험 데이터 이행.

| 작업 | 리스크 | 난이도 | 선행 |
|------|:------:|:------:|------|
| M4 소유자 필드 정본화(2종) | RA-15 | 중 | Phase1 |
| submitResponse Cloud Function(서버 검증·집계·lock) | RA-01/11 | 높 | App Check |
| M5 카운터/집계 서브문서 분리 + aggregates 백필 | RA-11/17 | 높 | submitResponse |
| 통계·보고서를 aggregates 읽기로 전환 | RA-17 | 중 | M5 |
| M6 PII 서브문서 격리 + applicantKey 해시화 | RA-06 | 높 | 백업 |
| viewer PII 응답 접근 차단(규칙) | RA-09 | 중 | M6 |
| PII 보존기간 + 자동 파기 스케줄(Function) | RA-06 | 중 | M6·담당승인 |
| 원본 CSV 반출 admin 한정 + 사유 + 감사 | RA-21 | 낮 | 감사Fn |

**게이트 G2**: 집계 정합 대사 통과, PII 잔존 0, 파기 정책 개인정보 담당자 승인.

---

## Phase 3 — 사용성 & 확장 (Delight & Extend)
> 목표: 현장 사용성·접근성·보고서 품질·확장성.

| 작업 | 리스크 | 난이도 | 선행 |
|------|:------:|:------:|------|
| M7 Draft/version + 명시 게시 흐름 | RA-04 | 높 | Phase1 |
| 빌더 위저드화 + 실시간 미리보기 + 자동저장 | RA-04(UX) | 높 | M7 |
| 응답자 접근성(ARIA 오류/필수·네이티브 폼·44px·16px·진행공지) | RA-18 | 중 | — |
| 색 대비 감사 + 공통 접근성 모달 | RA-18 | 중 | — |
| 응답형 matrix 문항 + 옵션 안정 id | RA-22/15 | 중 | schemaVersion |
| 보고서 통계 스냅샷 저장 + 차트 이미지 export→DOCX | 07 | 중 | aggregates |
| 폼타입 capabilities 불변식 | RA-19 | 낮 | — |
| surveys.js 리포지토리 분리(응답/감사/quota/draft) | D1 | 중 | 테스트 |
| formTemplates 코드→컬렉션 이관, 조직식별자 외부화 | D6 | 중 | — |

**게이트 G3**: 접근성 자동(axe)+수동(스크린리더) 통과, 회귀 스위트 그린.

---

## 진행 규율

- **한 페이즈 = 한 배포 사이클**로 묶지 말 것. 각 마이그레이션은 독립 배포 + `docs/RELEASE_PROCESS.md`·`CHANGE_IMPACT_MATRIX.md` 갱신.
- 각 작업 완료 시 `KNOWN_ISSUES.md`·`TECH_DEBT.md` 상태 업데이트(기존 문서화 문화 유지).
- Rules 변경 포함 작업은 반드시 에뮬레이터 테스트 + 배포 체크리스트(14) 동반.
- **의존 역전 금지**: Phase 2 고위험 이행은 Phase 0 백업·Phase 1 권한이 완료된 뒤에만.
