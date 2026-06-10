# 기술부채 및 리팩토링 계획

최종 업데이트: 2026-06-10

## 현재 주요 기술부채

- 설문 저장/조회/응답/삭제/통계 로직이 `src/firebase/surveys.js`에 많이 모여 있습니다.
- 응답자 화면의 로딩, 흐름 계산, 검증, 렌더링이 `src/pages/SurveyResponsePage.jsx`에 집중되어 있습니다.
- 설문 제작 화면의 템플릿 적용, 질문 편집, 저장 로직이 `src/pages/SurveyBuilderPage.jsx`에 집중되어 있습니다.
- Firestore 데이터 구조가 legacy field와 최신 field를 함께 지원합니다.
- 운영 이슈 대응 과정에서 debug/방어 로직이 빠르게 추가되어 용어 정리가 더 필요합니다.

## surveys.js 비대화 문제

- 현재 역할:
  - 설문 CRUD
  - 응답 저장
  - 응답 조회/검색
  - 응답 삭제 soft delete
  - quota count 보정
  - audit log 기록
  - 통계/요약 유틸
  - draft response 처리
- 이미 일부 상수/정규화는 분리됐지만 repository 단위 분리는 아직입니다.
- 다음 분리 후보:
  - `surveyResponsesRepository`
  - `surveyAuditRepository`
  - `surveyDraftRepository`
  - `surveyQuotaUtils`

## SurveyResponsePage.jsx 비대화 문제

- 현재 역할:
  - 공개 설문 로딩
  - 응답 상태 관리
  - visible flow 계산
  - 섹션 이동
  - 필수 검증
  - 미방문 질문 제출 차단
  - 질문 타입별 렌더링
  - draft 저장/삭제
- 다음 분리 후보:
  - `useSurveyResponseFlow`
  - `useSurveyResponseDraft`
  - `useSurveySubmitGuard`
  - 질문 타입별 렌더 컴포넌트

## SurveyBuilderPage.jsx 비대화 문제

- 현재 역할:
  - 신규/수정 설문 로딩
  - 템플릿 적용
  - 질문/섹션 편집
  - 저장 payload 생성
  - 미리보기/공개 URL 처리
- 다음 분리 후보:
  - `useSurveyBuilderState`
  - `useTemplateApply`
  - `surveyBuilderPayload`
  - 질문/섹션 편집 액션 reducer

## 이미 분리 완료된 항목

- `src/firebase/surveyConstants.js`
  - `QUESTION_TYPES`
  - `FORM_TYPES`
  - `BRANCH_ACTIONS`
  - 응답 상태/처리 상태 상수
- `src/firebase/surveyNormalize.js`
  - `normalizeQuestionType`
  - `normalizeQuestion`
  - `normalizeQuestions`
  - `isAnswerEmpty`
  - `isNonResponseQuestionType`
  - scale/option 정규화 유틸
- `src/utils/responseFlow.js`
  - 응답 visible flow 계산

## 단기 리팩토링 후보

- 응답 흐름에서 page/section alias 매칭 유틸 이름 정리
- `SurveyResponsePage.jsx`의 debug 데이터 생성부를 DEV 전용 helper로 분리
- 응답 삭제 quota 보정 로직에 작은 단위 테스트 또는 검증 스크립트 추가
- 템플릿 생성 후 질문/섹션 매칭 결과를 확인하는 개발용 체크 함수 추가
- README와 `ai/` 문서의 배포 절차 최신화 유지

## 중기 리팩토링 후보

- `surveys.js`에서 응답 관련 함수 분리
- `SurveyResponsePage.jsx`에서 질문 렌더러 분리
- `SurveyBuilderPage.jsx`의 템플릿 적용 로직 분리
- Firestore Rules와 클라이언트 권한 함수의 정책 문서화/테이블화
- 운영 설문 샘플 기반 회귀 테스트 추가

## 장기 리팩토링 후보

- 데이터 모델 버전 필드 도입
- 응답 흐름 엔진을 독립 모듈로 분리
- 관리자 통계 계산과 다운로드 로직 분리
- Cloud Functions 도입 검토
- TypeScript 전환 검토
- 테스트 자동화 체계 정비

## 지금 하지 않을 것

- TypeScript 즉시 전환
- XState 또는 별도 상태머신 도입
- Firestore 컬렉션 구조 대개편
- Cloud Functions 강제 도입
- UI 디자인 전면 개편
- 전체 repository 계층 일괄 분리

## 리팩토링 원칙

- 운영 중인 응답 흐름을 먼저 보존합니다.
- 한 번에 큰 파일을 갈아엎지 않고 검증 가능한 단위로 줄입니다.
- legacy 설문 데이터와 최신 템플릿 데이터를 모두 지원해야 합니다.
- 질문을 숨기는 방향의 최적화는 금지합니다.
- Firestore Rules 변경이 포함되면 배포 절차와 운영 확인 항목을 함께 갱신합니다.
- production debug 노출 금지 원칙을 유지합니다.
