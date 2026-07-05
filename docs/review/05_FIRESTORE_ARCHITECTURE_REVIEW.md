# 05. Firestore Architecture Review — 컬렉션 · 성능 · 비용 · 확장성

> 평가 축: Firestore 컬렉션 구조 안정성 / 성능·로딩 / 비용 증가 위험 / 문항 증가 시 성능 / 복구 가능성

---

## 5.1 구조 안정성 총평

컬렉션 경계(설문/응답/보고서/템플릿/감사/quota/lock)는 **잘 설계됨**. 문제는 구조가 아니라 **접근 패턴·카운터·집계·백업**에 있다.

---

## 5.2 핵심 이슈 A — 핫 문서(hot document) 경합

### 현재 상태
`submitSurveyResponse` 트랜잭션이 매 응답마다 `surveys/{id}` 본문 문서를 업데이트(`responseCount`, `optionQuotaCounts`, `status`, `updatedAt`).

### 문제점
- Firestore 단일 문서는 **지속 쓰기 ~1 write/sec** 권장 한도가 있다. 정원형 인기 신청(선착순 프로그램 접수)에서 동시 제출이 몰리면 트랜잭션 재시도·`aborted`·지연 폭증.
- `optionQuotaCounts`가 본문 문서에 있어, 옵션 정원 갱신도 같은 문서 경합에 포함.

### 위험도: **High** (선착순 신청 시나리오)
### 개선 방향
- **분산 카운터(sharded counter)** 또는 카운터 전용 서브문서로 이동.
- 옵션/셀 정원은 이미 서브컬렉션(`quotaCounts`)에 있으므로, `responseCount`도 동일 계층으로 내려 본문 문서 쓰기를 편집 시로 한정.

### 우선순위: P1 / 난이도: 중

---

## 5.3 핵심 이슈 B — 비용·남용 (특별 검토: Firestore 비용 폭증)

### 현재 상태
- 공개 `responses` create 규칙은 **인증 불필요**(공개 폼 특성상 정상). 그러나 App Check·rate limit·크기 제한이 없다.
- 통계·최근응답은 응답 문서를 **전량 읽어** 계산.

### 문제점 (Critical)
1. **무제한 쓰기 남용**: 봇이 공개 설문 URL로 응답을 무한 제출 → 문서 수·쓰기 과금 폭증, `responseCount`·정원 오염, 통계 왜곡. 방어 수단 없음.
2. **읽기 비용 선형 증가**: `fetchAllResponsesForSurveyExport`·`buildSurveyAnalytics`가 응답 전체를 읽음. 응답 1만 건 설문의 통계 1회 로드 = 1만 read. 관리자가 화면 열 때마다 반복.
3. **fan-out 읽기**: creator의 `fetchManagedRecentResponses`가 소유 설문 각각에 대해 개별 쿼리(N개 설문 → N 쿼리). 설문 많은 creator는 읽기 증폭.

### 위험도: **Critical** (남용) / High (선형 비용)
### 개선 방향
- **App Check(reCAPTCHA Enterprise) 필수화** + Functions 경유 제출로 rate limit.
- **증분 집계**: 응답 시 요약 카운터를 갱신(집계 문서 `surveys/{id}/analytics/summary`), 통계 화면은 요약 문서만 읽기 → O(1).
- 전체 원본 export는 관리자 명시 액션 + 페이지네이션 유지(이미 일부 구현).

### 우선순위: P1 / 난이도: 높음

---

## 5.4 핵심 이슈 C — 규칙 내 `get()`/`exists()` 읽기 비용

### 현재 상태
규칙 함수들이 판정 때마다 `userDoc()`(users/{uid})·설문 문서·membership 문서를 `get()`으로 조회. `canReadManagedResponse` 등은 응답 1건 읽을 때 설문 문서까지 재조회.

### 문제점
- 규칙 내 `get()`은 **과금되는 문서 읽기**이며, 응답 목록처럼 다건 평가 시 read가 곱해진다. creator가 응답 100건 조회 = 응답 100 read + 규칙이 유발하는 설문/유저 문서 read 다수.
- role/status를 매 요청 `get()`으로 재계산 → 지연·비용.

### 위험도: High
### 개선 방향
- **Custom Claims로 role/status를 토큰에 이관** → 규칙이 `request.auth.token.role`을 직접 읽어 users 문서 `get()` 제거.
- 응답 문서에 신뢰 가능한(서버 세팅) `surveyOwnerUid`를 유지하되, 그 세팅을 Functions로 보장하면 규칙에서 설문 재조회 불필요.

### 우선순위: P1 / 난이도: 높음

---

## 5.5 인덱스 · 쿼리

### 현재 상태 (firestore.indexes.json)
복합 인덱스 6개: surveys(status+createdAt), responses(surveyId+submittedAt, surveyTitle+submittedAt), audit_logs 3종.

### 문제점
- `responses`를 `surveyTitle`로 조회하는 인덱스 존재 → **제목 기반 응답 조회**가 코드에 있다는 뜻(`fetchResponsesBySurveyTitle`). 제목은 가변·비고유 → 제목 변경 시 과거 응답과 매칭 실패. surveyId 기반으로 일원화 권장.
- creator fan-out 쿼리(`ownerUid`/`createdByUid`/`ownerEmail`... 6종)는 인덱스 자동(단일 필드)으로 커버되나, 쿼리 수 자체가 많음(5.3-3).

### 위험도: Medium
### 개선 방향: surveyTitle 쿼리 폐기, surveyId 단일화. 소유 판정 필드 2종화로 쿼리 수 축소.
### 우선순위: P2 / 난이도: 중

---

## 5.6 핵심 이슈 D — 백업 · 복구 (특별 검토: 실수 복구)

### 현재 상태
- 소프트삭제: 설문(`deleteSurvey`/`restoreSurvey`), 응답(`deleteSurveyResponse` — 규칙상 하드삭제 금지 `allow delete: if false`), 보고서(`softDeleteSurveyReport`).
- **자동 백업 없음**. `permanentlyDeleteSurvey`는 하드삭제 경로 존재.

### 문제점
- 응답은 하드삭제가 규칙으로 차단되어 안전하나, **설문 본문·quotaConfig·유저·membership은 실수로 덮어쓰면 이전 값 복구 불가**(버전 이력 없음).
- Firestore export가 스케줄되어 있지 않아 **랜섬/오조작/코드버그로 인한 대량 오염 시 복구 지점(PITR)이 없다**. (Firestore PITR은 별도 활성화 필요.)

### 위험도: **High**
### 개선 방향
- **일일 자동 export → GCS 버킷**(Cloud Scheduler + Firestore export) + **PITR(Point-in-Time Recovery) 활성화**.
- 설문/보고서에 편집 이력(변경 전 스냅샷) 또는 최소한 감사로그에 before/after 요약 저장.

### 우선순위: P1 / 난이도: 낮~중 (export 스케줄은 표준 절차)

---

## 5.7 문항 수 증가 시 성능 (특별 검토)

### 평가
- 문항이 많아지면 `surveys` 문서 크기↑(1MB 한계), 응답의 `answers` 배열↑, 통계 계산 O(문항×응답)↑.
- 분기 계산(`buildVisibleQuestionFlow`)은 문항 수에 비례하나 클라이언트 1회 계산이라 감내 가능.

### 위험도: Medium
### 개선 방향: 초대형 설문은 섹션 분할 저장 검토, 통계는 증분 집계로 문항×응답 재계산 제거.
### 우선순위: P2 / 난이도: 중

---

## 5.8 Firestore 요약표

| 이슈 | 위험도 | 개선 | 우선순위 | 난이도 |
|------|:------:|------|:--------:|:------:|
| A 핫 문서 카운터 경합 | High | 카운터 분리/분산 | P1 | 중 |
| B 공개 write 남용·비용 | Critical | App Check+증분집계 | P1 | 높 |
| C 규칙 get() 과금 | High | Custom Claims | P1 | 높 |
| 인덱스/제목쿼리 | Medium | surveyId 단일화 | P2 | 중 |
| D 백업·복구 부재 | High | 자동export+PITR | P1 | 낮~중 |
| 문항 증가 성능 | Medium | 증분집계 | P2 | 중 |
