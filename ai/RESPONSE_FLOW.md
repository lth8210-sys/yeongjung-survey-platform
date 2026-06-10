# 응답자 화면 응답 흐름

최종 업데이트: 2026-06-10

## 응답 흐름의 핵심 원칙

- 모든 응답 대상 질문은 필수 여부와 무관하게 화면에 표시되어야 합니다.
- 선택형 질문만 기준으로 페이지 진행이나 마지막 페이지 판단을 하면 안 됩니다.
- 주관식, 장문형, 전화번호, 이메일, 개인정보 동의, 신청 슬롯형도 모두 흐름 계산 대상입니다.
- 섹션/페이지 매칭에 실패한 질문도 숨기지 않습니다.
- 아직 화면 흐름상 방문하지 않은 질문이 있으면 제출을 막습니다.

## normalizeQuestionType 역할

- 위치: `src/firebase/surveyNormalize.js`
- 목적: 템플릿/legacy 데이터의 다양한 `question.type` 값을 표준 타입으로 통일합니다.
- 주요 alias:
  - `short_text`, `short`, `text`, `input`, `subjective_short` -> `shortText`
  - `long_text`, `long`, `textarea`, `paragraph`, `subjective`, `subjective_long` -> `longText`
  - `single_choice`, `radio`, `choice` -> `singleChoice`
  - `multiple_choice`, `checkbox`, `checkboxes` -> `multipleChoice`
  - `application_slot_choice`, `application_slot`, `slot` -> `applicationSlotChoice`
  - `consent_checkbox`, `consent`, `privacy_consent` -> `consentCheckbox`
- 알 수 없는 타입은 `shortText`로 fallback됩니다.

## visibleFlow 역할

- 생성 위치: `src/utils/responseFlow.js`
- 사용 위치: `src/pages/SurveyResponsePage.jsx`
- 역할:
  - 현재 응답값 기준으로 표시 가능한 질문 흐름을 계산합니다.
  - 조건부 분기, 종료 조건, 건너뛴 질문을 계산합니다.
  - `visibleQuestionIds`, `visibleSectionIds`, `skippedQuestionIds`, `groupedSections`, `termination` 정보를 제공합니다.

## groupedSections 역할

- 응답자 화면에서 실제 페이지 단위로 렌더링할 섹션 배열입니다.
- 각 섹션은 `questions` 배열을 포함합니다.
- 마지막 페이지 여부, 다음 섹션 이동, 현재 섹션 질문 렌더링의 기준입니다.
- `groupedSections`에 질문이 빠지면 화면 누락과 자동 제출 위험이 생기므로 응답 흐름 수정 시 가장 먼저 확인해야 합니다.

## section/page alias 처리 방식

질문과 섹션은 다음 값을 alias로 비교합니다.

- 질문: `sectionId`, `pageId`, `pageKey`, `sectionKey`
- 섹션: `id`, `key`, `pageId`, `pageKey`, `sectionKey`

템플릿 생성이나 legacy 데이터에서 서로 다른 필드에 같은 의미의 값이 저장될 수 있으므로, 한 필드만 기준으로 매칭하면 안 됩니다.

## 고아 질문/미분류 질문 구제 방식

- 질문이 어떤 섹션과도 매칭되지 않으면 버리지 않습니다.
- 응답 대상 질문이 `groupedSections`에서 빠지면 fallback 섹션 또는 마지막 질문 섹션에 포함해야 합니다.
- 이 원칙은 특히 템플릿으로 생성된 설문에서 주관식 문항이 누락되는 문제를 막기 위한 방어선입니다.

## 마지막 페이지 판단 기준

- 단순히 `currentSectionIndex === groupedSections.length - 1`만 보면 안 됩니다.
- 현재 이후에 실제 렌더 가능한 질문이 남아 있는지가 기준입니다.
- 뒤쪽에 주관식/선택 주관식/개인정보 동의 문항이 있으면 버튼은 제출이 아니라 다음이어야 합니다.
- 응답자 화면에서는 `isLastReachableSection`, `nextQuestionSectionIndex`, `remainingActiveResponseQuestions` 류의 계산을 함께 사용합니다.

## 미방문 질문 제출 차단 방식

- 제출 직전 `allRenderableQuestions`와 `renderedQuestionIds`를 비교합니다.
- 아직 방문하지 않은 렌더 가능 질문이 있으면 `submitSurveyResponse`를 호출하지 않습니다.
- 개발 환경에서는 `[BLOCK_SUBMIT_UNVISITED_QUESTIONS]` 로그를 남깁니다.
- production에서는 로그를 남기지 않지만 제출 차단은 그대로 유지합니다.
- 차단 시 첫 미방문 질문이 포함된 섹션으로 이동하고 안내 메시지를 표시합니다.

## renderedQuestionIds 안정화 방식

- 과거에는 질문 컴포넌트가 실제 DOM에 마운트됐는지에 가까운 방식으로 오탐 위험이 있었습니다.
- 현재는 현재 섹션에 진입하면 그 섹션의 렌더 가능 질문 ID를 visited 처리합니다.
- 느린 기기, 모바일, 긴 설문에서 렌더 타이밍 때문에 제출이 막히는 상황을 줄입니다.
- 아직 흐름상 도달하지 않은 뒤쪽 질문은 visited 처리되지 않으므로 제출 차단은 유지됩니다.

## 주관식 문항 누락 방지 원칙

- `shortText`, `longText`, `email`, `phone`, `date`, `time`, `number`는 모두 렌더링 대상입니다.
- `textarea`, `paragraph`, `subjective` 등 legacy 타입은 `longText`로 정규화합니다.
- 알 수 없는 타입은 숨기지 말고 기본 텍스트 입력처럼 처리해야 합니다.
- 필수가 아닌 주관식도 화면에는 반드시 표시되어야 하며, 비워도 제출 가능해야 합니다.
- 필수 주관식은 비어 있으면 제출되지 않아야 합니다.

## 조건부 분기 처리 개요

- 분기 상수는 `src/firebase/surveyConstants.js`의 `BRANCH_ACTIONS`, `CONDITION_OPERATORS`, `CONDITION_COMBINATORS`를 사용합니다.
- 분기 계산은 `src/utils/responseFlow.js`에서 응답값과 조건을 비교해 visible flow를 구성합니다.
- 종료 분기가 있으면 `visibleFlow.termination`에 메시지가 담깁니다.
- 분기 수정 시 선택형뿐 아니라 비선택형 질문이 뒤에 남아 있는지 확인해야 합니다.

## 향후 리팩토링 방향

- `SurveyResponsePage.jsx`의 흐름 계산, 검증, 렌더링을 작은 훅/유틸로 점진 분리합니다.
- page/section alias 매칭을 단일 유틸 함수로 고정합니다.
- 운영 설문 샘플 기반의 응답 흐름 회귀 테스트를 추가합니다.
- `visibleFlow`, `groupedSections`, `renderedQuestionIds`의 역할 이름을 더 명확히 정리합니다.
- 단, 운영 안정화 중에는 상태머신 도입이나 대규모 구조 변경은 피합니다.
