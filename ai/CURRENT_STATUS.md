# 영중 설문 플랫폼 현재 상태

최종 업데이트: 2026-06-10

## 현재 배포 상태

- React + Vite + Firebase 기반으로 운영 배포 중입니다.
- Firebase Hosting은 `dist/` 산출물을 서비스합니다.
- SPA 라우팅은 `firebase.json`의 rewrite 설정으로 모든 경로를 `/index.html`에 연결합니다.
- Firestore 보안 규칙은 `firestore.rules`, 인덱스는 `firestore.indexes.json`에서 관리합니다.

## Hosting URL

- https://yeongjung-survey-platform.web.app

## GitHub 저장소

- https://github.com/lth8210-sys/yeongjung-survey-platform.git

## 현재 주요 기능

- Google 로그인 기반 관리자 접근
- 홈/관리자 대시보드
- 설문 목록 및 설문 제작/수정
- 템플릿 기반 설문 생성
- 공개 응답 페이지: `/surveys/:surveyId`, `/survey/:surveyId`
- 응답 관리: `/admin/surveys/:surveyId/responses`
- 전체 최근 응답 관리: `/admin/responses`
- 응답 CSV 다운로드
- 응답 soft delete
- 응답 삭제 감사로그
- 사용자 관리: `/admin/users`
- 감사로그 조회: `/admin/audit-logs`
- 설문 미리보기: `/admin/surveys/:surveyId/preview`

## 최근 해결된 핵심 이슈

- 주관식/장문형 문항이 응답자 화면에서 누락되고 객관식 이후 자동 제출되던 문제를 보완했습니다.
- `short_text`, `long_text`, `text`, `textarea`, `paragraph`, `subjective` 등 legacy/템플릿 `question.type` 값을 `normalizeQuestionType`에서 표준 타입으로 정규화합니다.
- `sectionId`, `pageId`, `pageKey`, `sectionKey` alias 매칭 실패로 질문이 `groupedSections`에서 빠지는 문제를 구제합니다.
- 섹션에 매칭되지 않은 응답 대상 질문은 숨기지 않고 fallback 섹션에 포함하는 방향으로 처리합니다.
- 마지막 페이지 판단을 단순 섹션 수가 아니라 이후 렌더 가능한 질문 존재 여부 기준으로 강화했습니다.
- 제출 직전 미방문 렌더 가능 질문이 있으면 제출을 차단하고 해당 질문 섹션으로 이동합니다.

## 현재 안정화 완료 항목

- `renderedQuestionIds`는 질문 컴포넌트 마운트 기준이 아니라 현재 섹션 진입 기준으로 등록합니다.
- production에서는 `[SurveyResponseDebug]`, `[BLOCK_SUBMIT_UNVISITED_QUESTIONS]`, raw/grouped debug 로그와 임시 debug panel을 노출하지 않습니다.
- 응답 삭제는 실제 문서 삭제가 아니라 `deleted: true`, `deletedAt`, `deletedBy`, `hiddenFromDefaultList` 기반 soft delete입니다.
- 삭제된 응답은 기본 응답 목록, 통계, 다운로드에서 제외됩니다.
- 응답 삭제 시 `audit_logs`에 `action: response_delete`, `surveyId`, `responseId`, `deletedBy`, `deletedAt`을 기록합니다.
- 응답 삭제 권한은 `canDeleteResponses`, 응답 관리 권한은 `canManageSurveyResponses`로 사용자 관리 권한과 분리했습니다.
- 설문/질문 타입 상수는 `src/firebase/surveyConstants.js`, 정규화 유틸은 `src/firebase/surveyNormalize.js`로 분리했습니다.

## 남아 있는 주의사항

- `src/firebase/surveys.js`, `src/pages/SurveyResponsePage.jsx`, `src/pages/SurveyBuilderPage.jsx`는 여전히 큽니다. 기능 변경 시 영향 범위를 좁혀 수정해야 합니다.
- Firestore Rules와 `src/firebase/users.js`의 슈퍼관리자 이메일 목록은 동기화가 필요합니다.
- Firestore Rules 변경은 Hosting 배포만으로 반영되지 않습니다.
- 응답 흐름 수정 시 실제 운영 설문 데이터의 `questions`, `sections`, page/section alias를 함께 확인해야 합니다.
- `npm run build`는 통과해야 하며, 큰 chunk 경고는 현재 알려진 상태입니다.

## 다음 우선순위

- 운영 설문 1건 이상으로 객관식 -> 주관식 -> 제출 흐름을 수동 점검합니다.
- 응답 삭제 후 목록/통계/다운로드/audit log를 관리자 계정으로 확인합니다.
- 응답 흐름 관련 테스트 데이터를 문서화하거나 간단한 검증 스크립트를 추가하는 방안을 검토합니다.
- `SurveyResponsePage.jsx` 내부 응답 흐름 계산부를 작은 유틸로 점진 분리합니다.

## 바로 하지 않을 작업

- TypeScript 전환
- XState 등 상태머신 도입
- Cloud Functions 구조 변경
- Firestore 컬렉션 대개편
- 대규모 UI 개편
- repository 계층 전면 분리

## 운영 확인 체크 항목

- 공개 설문 URL이 열리는지 확인합니다.
- 객관식 뒤 주관식/장문형/개인정보 동의 문항이 순서대로 표시되는지 확인합니다.
- 선택 주관식은 비워도 제출 가능한지 확인합니다.
- 필수 주관식은 비우면 제출되지 않고 오류가 표시되는지 확인합니다.
- 마지막 질문 페이지 버튼이 `제출하기` 또는 `제출 및 저장`인지 확인합니다.
- 응답 저장 후 관리자 응답 목록에 반영되는지 확인합니다.
- 응답 삭제 후 목록/통계/다운로드에서 제외되는지 확인합니다.
- `audit_logs`에 `response_delete` 기록이 남는지 확인합니다.
