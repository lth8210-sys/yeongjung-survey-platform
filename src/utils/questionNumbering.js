import { isNonResponseQuestionType } from '../firebase/surveys';

function getQuestionTitle(question = {}) {
  return question.title?.trim?.() || question.label?.trim?.() || '먼저 질문 제목을 입력해 주세요';
}

export function buildQuestionDisplayMap(questions = []) {
  const displayMap = {};
  let questionCounter = 0;

  (Array.isArray(questions) ? questions : []).forEach((question) => {
    if (!question?.id || isNonResponseQuestionType(question.type)) {
      return;
    }

    questionCounter += 1;

    const displayNumber = String(questionCounter);
    const title = getQuestionTitle(question);

    displayMap[question.id] = {
      displayNumber,
      shortLabel: displayNumber,
      title,
      label: `질문 ${displayNumber}. ${title}`,
    };
  });

  return displayMap;
}

export function getQuestionDisplayInfo(displayMap = {}, question = {}, fallbackIndex = 0) {
  if (question?.id && displayMap[question.id]) {
    return displayMap[question.id];
  }

  const displayNumber = String(fallbackIndex + 1);
  const title = getQuestionTitle(question);

  return {
    displayNumber,
    shortLabel: displayNumber,
    title,
    label: `질문 ${displayNumber}. ${title}`,
  };
}
