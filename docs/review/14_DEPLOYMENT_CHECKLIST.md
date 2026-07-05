# 14. Deployment Checklist — 배포 전 체크리스트 (v2 기준 보강)

> 기존 `docs/QA_CHECKLIST.md`는 **기능 회귀**에 충실하다. 그것을 대체하지 않고, 이 리뷰가 드러낸
> **보안·개인정보·데이터 안전·비용·접근성** 게이트를 추가한다. 아래 A~H는 QA_CHECKLIST 통과를 **전제**로 한다.

---

## A. 배포 게이트 (Release Gates) — 하나라도 미충족 시 배포 보류

### A1. 보안 게이트 🔴
- [ ] 공개 `responses` create 규칙에 `hasOnly()` 필드 화이트리스트 적용됨
- [ ] `answers` 개수·문자열 길이 상한이 규칙 또는 Function에서 강제됨
- [ ] Firebase App Check 활성화 + 공개 write 경로에 강제됨
- [ ] `status`/`deleted`/`quota` 등 운영 필드를 응답자가 임의 설정 불가
- [ ] 소유자 스냅샷(`surveyOwnerUid/Email`)이 서버/규칙에서 설문 문서와 대조되거나 서버가 세팅
- [ ] Rules 변경분에 대한 에뮬레이터 테스트 그린(권한 상승·격리 케이스 포함)

### A2. 개인정보 게이트 🔴
- [ ] PII가 화면·다운로드에서 마스킹됨(원본 반출은 admin 한정+사유+감사)
- [ ] `applicantKey` 등 식별자에 평문 PII 없음(해시)
- [ ] viewer/조직공개 경로에서 PII 응답 원본 접근 차단 확인
- [ ] 응답 debug 로깅에 PII 미포함(프로덕션 debug 제거)
- [ ] PII 보존기간·파기 정책이 개인정보 담당자 승인됨(v2)

### A3. 데이터 안전 게이트 🔴
- [ ] Firestore 일일 export(GCS) 스케줄 동작 확인
- [ ] PITR(Point-in-Time Recovery) 활성화됨
- [ ] 마이그레이션 스크립트는 dry-run→검증→백필 순서로 실행됨
- [ ] 응답 하드삭제 규칙 `allow delete: if false` 유지 확인
- [ ] 이번 배포의 마이그레이션에 롤백 절차 문서화됨

### A4. 비용·성능 게이트 🟠
- [ ] 대량 응답 설문에서 통계·목록이 증분집계(O(1)) 또는 페이지네이션으로 동작(전량 read 아님)
- [ ] 카운터 쓰기가 핫 문서 경합을 유발하지 않음(분산/서브문서)
- [ ] creator fan-out 쿼리 수가 설문 수에 따라 과도하지 않음(상한/캐시)

### A5. 접근성 게이트 🟠 (응답자 화면 대상)
- [ ] axe-core 자동 점검 심각(critical) 0
- [ ] 스크린리더(VoiceOver/NVDA)로 필수·오류·제출 흐름 확인
- [ ] 선택형 문항 키보드 조작 가능(네이티브/role)
- [ ] 터치 타깃 ≥44px, 본문 ≥16px, 200% 확대 시 레이아웃 유지

### A6. CSV/내보내기 게이트 🟠
- [ ] CSV/Excel 셀이 `= + - @ \t \r`로 시작 시 수식 인젝션 방지 처리됨
- [ ] 한글 BOM 유지(엑셀 호환)

---

## B. 빌드 & 규칙 (기존 유지)
- [ ] `npm run build` 성공, 신규 오류 없음
- [ ] Firestore rules dry-run 성공, index 오류 없음
- [ ] production logger 마스킹 / DEV path 표시 확인

## C. 권한 회귀 (Custom Claims 도입 후 필수)
- [ ] 권한 변경 시 `syncUserClaims` 호출·토큰 반영 확인
- [ ] super_admin/admin/creator/viewer/비로그인 접근 매트릭스 통과(QA_CHECKLIST 권한 절 전체)
- [ ] 내부 이메일 신규 로그인 시 자동 승격 아님(명시 승인 흐름) 확인
- [ ] permission-denied 경로 DEV 표시·PROD 마스킹 확인

## D. 핵심 흐름 스모크 (기존 유지 + 보강)
- [ ] 공개 제출(App Check 토큰 포함) 성공
- [ ] quota 제출 → 집계 증가 → 통계 반영 정합
- [ ] 응답 삭제 → 집계 보정(음수 방지) → 감사로그 서버 생성 확인
- [ ] 최근응답/설문별응답/보고서 목록 로드, CSV/Excel/DOCX 다운로드
- [ ] 게시 후 편집 → 새 버전 게시 → 진행 응답 미파손 확인(v2)

## E. 감사·추적
- [ ] 삭제·권한변경·PII 열람/반출이 감사로그(서버 생성)에 남음
- [ ] 감사로그 admin 조회 가능, update/delete 불가 확인

## F. 문서 동기화
- [ ] `KNOWN_ISSUES.md`·`TECH_DEBT.md`·`CHANGE_IMPACT_MATRIX.md` 갱신
- [ ] Rules-클라이언트 권한 정책표 최신
- [ ] 마이그레이션 실행 기록·정합 리포트 보관

## G. 모바일/브라우저 (기존 유지)
- [ ] Android Chrome / iPhone Safari(세로·가로) / iPad / Desktop
- [ ] 긴 질문·선택지 줄바꿈, 버튼 텍스트 넘침 없음

## H. Release Sign-Off
- [ ] 영향 분석 완료 · Build 성공 · Rules Compile 성공
- [ ] A1~A6 게이트 통과(또는 미적용 사유 승인 기록)
- [ ] QA 완료 · 운영 승인 · Commit · Push · Deploy · Smoke Test · 운영 확인

---

## 우선 적용 순서 (현 시점 권고)
지금 당장 기능 배포 전이라도 **A1(create 하드닝·App Check), A3(백업/PITR), A6(CSV 인젝션), A2(debug PII 제거)** 는
저비용·고효과이므로 **Phase 0에서 즉시** 체크리스트에 편입할 것. 나머지 게이트는 해당 기능이 v2 로드맵에서
구현되는 시점(13번 문서)에 활성화한다.
