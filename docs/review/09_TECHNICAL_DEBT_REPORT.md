# 09. Technical Debt Report — 기술부채 상세

> 참고: `ai/TECH_DEBT.md`(팀 자체 부채 인식)를 존중하되, 외부 감사 관점에서 재평가·우선순위화.

---

## 9.1 부채 인벤토리 (규모 기준)

| 파일 | 라인 | 책임 과다 | 위험도 |
|------|----:|-----------|:------:|
| `src/firebase/surveys.js` | 4,483 | CRUD·응답·삭제·quota·감사·통계·draft·분기 전부 | **High** |
| `src/pages/SurveyResponsesAdminPage.jsx` | 2,889 | 통계·목록·필터·CSV·명단·슬롯·처리상태 | High |
| `src/pages/SurveyBuilderPage.jsx` | 2,621 | 로딩·템플릿·편집·payload·미리보기 | High |
| `src/pages/SurveyResponsePage.jsx` | 2,353 | 로딩·흐름·검증·렌더·draft (27 useState) | High |
| `src/components/QuestionEditor.jsx` | 1,281 | 16종 문항 편집 | Medium |
| `src/data/formTemplates.js` | 1,211 | 데이터(문제 아님, 단 코드로 하드코딩) | Low |
| `src/utils/surveyAnalytics.js` | 814 | 통계+문장생성 혼재 | Medium |

**총 소스 ~27,000줄, 상위 4개 파일이 ~12,300줄(45%)에 집중.** = 변경 위험이 소수 파일에 응집.

---

## 9.2 부채 유형별 진단

### D1. God module — `surveys.js`
- 60+ export가 한 파일. 응답/감사/quota/draft/분기가 상호 결합.
- **영향**: 응답 로직 한 줄 수정이 통계·삭제·보고서에 파급(ARCHITECTURE.md의 "Critical Flow"가 이를 인정). 회귀 테스트 없이 손대기 어려움.
- **개선**: 팀이 이미 계획한 `surveyResponsesRepository`/`surveyAuditRepository`/`surveyQuotaUtils`/`surveyDraftRepository` 분리 실행. 순수 함수(분기·정규화)는 이미 분리됨 → **부수효과 있는 Firestore 접근부**를 먼저 도메인 repository로.
- 위험도: High / 우선순위: P1 / 난이도: 중(점진 분리)

### D2. Legacy 호환 누적
- role 8종 문자열, status 4개 필드(`status/isActive/active/is_active`), 설문 소유자 6종 필드, `LEGACY_PUBLISHED_STATUSES`, survey status `active`(legacy) 등.
- **영향**: 규칙·클라이언트 양쪽에서 매 판정마다 분기. 신규 개발자 인지부하↑, 의도치 않은 활성화/권한 경로 위험(06.3).
- **개선**: **일회성 데이터 마이그레이션**으로 표준값 정규화 → legacy 분기 제거(12 참조).
- 위험도: High / 우선순위: P1 / 난이도: 중

### D3. 권한 로직 이중 구현
- `users.js`(JS)와 `firestore.rules`(규칙 DSL)에 같은 판정이 2벌. 동기화가 사람 주석("SYNC REQUIRED")에 의존.
- **개선**: Custom Claims 단일 소스(06.3). 최소한 규칙-클라이언트 정책을 **표로 문서화**(팀 계획에 이미 있음).
- 위험도: High / 우선순위: P1 / 난이도: 높음

### D4. 테스트 부재
- `package.json`에 테스트 러너·스크립트 없음. 회귀 방어가 전무.
- **영향**: quota 보정·분기 계산·정규화처럼 복잡·순수한 로직조차 자동 검증 없음. 운영 장애(KI 시리즈)가 반복.
- **개선**: 순수 함수부터 Vitest 도입 — `responseFlow`, `surveyNormalize`, quota 유틸, `escapeCsvValue`, 통계. + Firestore Rules 에뮬레이터 테스트(`@firebase/rules-unit-testing`).
- 위험도: **High** / 우선순위: P1 / 난이도: 낮~중

### D5. 프로덕션 디버그 노출
- `console.debug('[SurveyResponsePage] submit payload', {answers, payload...})` — 응답 payload(PII 포함) 콘솔 출력. `logger.js` 존재하나 일부 직접 console 사용.
- **개선**: 전 구간 `logger` 경유 + DEV 가드 + PII 마스킹. 프로덕션 빌드에서 debug 제거.
- 위험도: Medium(보안 측면 High) / 우선순위: P1 / 난이도: 낮

### D6. 순수 데이터의 코드 하드코딩
- `formTemplates.js`(1,211줄) 서식, 조직 도메인·슈퍼관리자 이메일이 코드/규칙에 상수.
- **개선**: 서식은 `survey_templates` 컬렉션으로 이관(운영자가 UI로 관리), 조직 식별자는 설정.
- 위험도: Low~Medium / 우선순위: P2 / 난이도: 중

### D7. 타입 안전성 부재 (JS + PropTypes 없음)
- 19개 필드 규칙(reportCreate 등)을 손으로 맞춰야 하는데 타입 검증이 런타임 규칙에만 존재.
- **개선**: 장기적으로 TypeScript. 단기적으로 핵심 데이터 팩토리에 스키마 검증(zod 등) 또는 JSDoc 강화.
- 위험도: Medium / 우선순위: P2 / 난이도: 높음(전환)

---

## 9.3 부채 상환 우선순위 (외부 감사 관점)

| 순위 | 항목 | 이유 |
|:---:|------|------|
| 1 | D4 테스트 도입(순수함수+Rules) | 이후 모든 리팩토링의 안전망. 없으면 나머지가 위험 |
| 2 | D5 debug/PII 로깅 제거 | 즉시·저비용·보안 직결 |
| 3 | D3+D2 권한 단일화·legacy 정리 | KI 반복 장애의 근본 원인 |
| 4 | D1 surveys.js 분리 | 변경 위험 분산 |
| 5 | D6/D7 데이터 외부화·타입 | 장기 유지보수성 |

### 원칙 (팀 기존 원칙 계승)
- 운영 응답 흐름 보존 우선, 큰 파일 일괄 교체 금지, legacy·최신 데이터 동시 지원(마이그레이션 완료 전까지), 질문 숨김 최적화 금지, Rules 변경 시 배포 절차·확인 동반.
