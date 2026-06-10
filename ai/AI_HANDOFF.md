# AI 에이전트 인수인계

최종 업데이트: 2026-06-10

## 이 프로젝트를 처음 보는 AI가 반드시 알아야 할 것

- 영중 설문 플랫폼은 React + Vite + Firebase 기반 운영 서비스입니다.
- 운영 URL은 https://yeongjung-survey-platform.web.app 입니다.
- GitHub 저장소는 https://github.com/lth8210-sys/yeongjung-survey-platform.git 입니다.
- 기능 코드 변경 전에는 현재 코드 구조를 먼저 확인해야 합니다.
- 응답자 화면 문제는 실제 Firestore 데이터의 `questions`와 `sections` 구조 차이에서 자주 발생합니다.
- 문항을 숨기는 방식의 수정은 운영 사고로 이어질 수 있습니다.

## 최근 가장 중요한 이슈

- 템플릿 설문에서 객관식 이후 주관식/장문형 문항이 화면에 보이지 않고 자동 제출되는 문제가 있었습니다.
- 원인은 단일 원인이 아니라 `question.type` alias, section/page alias, `groupedSections`, 마지막 페이지 판단, 미방문 질문 방어가 함께 얽힌 문제였습니다.
- 현재는 다음 방어가 들어가 있습니다.
  - `normalizeQuestionType` alias 정규화
  - `sectionId`, `pageId`, `pageKey`, `sectionKey` alias 대응
  - `groupedSections` 누락 질문 구제
  - 마지막 페이지 판단 강화
  - 제출 전 미방문 질문 차단
  - `renderedQuestionIds` 섹션 진입 기준 안정화
  - production debug 로그/패널 숨김

## 수정 시 주의할 핵심 파일

- `src/pages/SurveyResponsePage.jsx`: 응답자 화면, 질문 렌더링, 제출 검증
- `src/utils/responseFlow.js`: visible flow, groupedSections, 분기 계산
- `src/firebase/surveyNormalize.js`: 질문 타입/질문 구조 정규화
- `src/firebase/surveyConstants.js`: 질문/폼/분기/상태 상수
- `src/firebase/surveys.js`: Firestore 설문/응답 저장, 삭제, 감사로그
- `src/pages/SurveyBuilderPage.jsx`: 템플릿 적용과 설문 저장
- `src/pages/SurveyResponsesAdminPage.jsx`: 응답 관리, 삭제, 다운로드
- `src/firebase/users.js`: 역할과 권한 함수
- `firestore.rules`: Firestore 권한 정책

## 응답 흐름 수정 시 반드시 확인할 것

- 모든 응답 대상 질문이 렌더링 대상인지 확인합니다.
- `shortText`, `longText`, `email`, `phone`, `consentCheckbox`, `singleChoice`, `multipleChoice`, `linearScale`, `applicationSlotChoice` 등을 모두 확인합니다.
- `short_text`, `long_text`, `textarea`, `paragraph`, `subjective` 같은 alias가 `normalizeQuestionType`에 포함되어 있는지 확인합니다.
- `groupedSections`에 질문이 들어가는지 확인합니다.
- `visibleQuestionIds`에 주관식 문항이 포함되는지 확인합니다.
- 마지막 페이지 판단이 선택형 기준으로만 되지 않는지 확인합니다.
- 미방문 질문 제출 차단이 유지되는지 확인합니다.
- 선택 주관식은 비워도 제출 가능해야 합니다.
- 필수 주관식은 비우면 제출 불가해야 합니다.

## Firestore rules 변경 시 주의사항

- `firestore.rules` 변경은 Hosting 배포만으로 반영되지 않습니다.
- Rules 변경 후에는 반드시 다음 중 하나를 실행해야 합니다.

```bash
firebase deploy --only firestore
```

또는 전체 배포:

```bash
firebase deploy
```

- `src/firebase/users.js`의 `SUPER_ADMIN_EMAILS`를 바꾸면 `firestore.rules`의 super admin 이메일 관련 함수도 함께 수정해야 합니다.
- 응답 삭제는 실제 delete가 아니라 soft delete update이므로 `responses` update 권한과 `audit_logs` create 권한을 함께 봐야 합니다.

## 배포 전 필수 명령어

```bash
npm run build
git diff --stat
```

Firestore Rules 변경이 있으면:

```bash
firebase deploy --only firestore
```

Hosting 배포:

```bash
firebase deploy --only hosting
```

## 금지사항

- 민감정보, API key, token, 실제 개인정보를 문서나 코드에 기록하지 마세요.
- 운영 설문 질문을 필터링해서 조용히 숨기지 마세요.
- 응답 삭제를 hard delete로 바꾸지 마세요.
- production에 raw questions, raw sections, groupedSections debug 로그를 노출하지 마세요.
- Firestore Rules를 수정하고 Hosting만 배포하지 마세요.
- 대규모 리팩토링을 작은 버그 수정과 섞지 마세요.
- 사용자 변경사항을 임의로 되돌리지 마세요.

## 다음 AI 작업 추천 순서

1. `ai/CURRENT_STATUS.md`와 `ai/RESPONSE_FLOW.md`를 먼저 읽습니다.
2. 관련 코드 파일을 `rg`로 찾고 실제 구현을 확인합니다.
3. 기능 수정 전 `npm run build` 현재 상태를 확인합니다.
4. 응답 흐름 수정이면 템플릿 설문과 실제 Firestore 데이터 구조를 함께 확인합니다.
5. 최소 변경으로 수정합니다.
6. `npm run build`를 다시 실행합니다.
7. 변경 파일과 `git diff --stat`을 보고합니다.
