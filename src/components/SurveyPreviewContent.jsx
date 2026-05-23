import { useMemo, useState } from 'react';
import MarkdownRenderer from './MarkdownRenderer';
import {
  BRANCH_ACTIONS,
  getQuestionOptionItems,
  getScaleQuestionConfig,
  isNonResponseQuestionType,
  isScaleQuestionType,
  OTHER_OPTION_VALUE,
  QUESTION_TYPES,
} from '../firebase/surveys';
import { buildQuestionDisplayMap } from '../utils/questionNumbering';
import { normalizeQuestionsAndSections } from '../utils/responseFlow';

function getQuestionKey(question, index) {
  return question?.id || `legacy-question-${index + 1}`;
}

function normalizeBranchAction(action) {
  if (action === BRANCH_ACTIONS.GO_TO || action === 'goToQuestion' || action === 'go_to_question') {
    return BRANCH_ACTIONS.GO_TO;
  }

  if (action === BRANCH_ACTIONS.END || action === 'submit') {
    return BRANCH_ACTIONS.END;
  }

  return BRANCH_ACTIONS.NEXT;
}

function getRuleOptionValue(rule = {}) {
  return rule.whenOption ?? rule.value ?? rule.answer ?? '';
}

function SurveyPreviewContent({ survey, actions = null, compact = false }) {
  const [answers, setAnswers] = useState({});
  const [otherInputs, setOtherInputs] = useState({});
  const normalizedFlow = useMemo(() => normalizeQuestionsAndSections(survey), [survey]);
  const questionDisplayMap = useMemo(
    () => buildQuestionDisplayMap(survey?.questions ?? [], survey?.sections ?? []),
    [survey?.questions, survey?.sections],
  );
  const questionById = normalizedFlow.questionById ?? new Map();
  const optionLabelByQuestionId = useMemo(() => {
    if (!survey) {
      return new Map();
    }

    return normalizedFlow.questions.reduce((result, question) => {
      const optionMap = new Map(
        getQuestionOptionItems(question, survey.optionQuotaCounts).map((option) => [
          String(option.value),
          option.label,
        ]),
      );

      if (question.allowOther) {
        optionMap.set(OTHER_OPTION_VALUE, '기타');
      }

      result.set(question.id, optionMap);
      return result;
    }, new Map());
  }, [normalizedFlow.questions, survey]);
  const groupedSections = useMemo(() => {
    const sectionToQuestionIdsMap = normalizedFlow.sectionToQuestionIdsMap ?? new Map();

    return (normalizedFlow.sections ?? []).map((section, index) => ({
      ...section,
      title: section.title || `섹션 ${index + 1}`,
      questions: (sectionToQuestionIdsMap.get(section.id) ?? [])
        .map((questionId) => questionById.get(questionId))
        .filter(Boolean),
    }));
  }, [normalizedFlow.sectionToQuestionIdsMap, normalizedFlow.sections, questionById]);

  const handleChange = (questionKey, value) => {
    setAnswers((current) => ({
      ...current,
      [questionKey]: value,
    }));
  };

  const handleMultipleChoiceChange = (questionKey, option, checked) => {
    setAnswers((current) => {
      const currentValues = Array.isArray(current[questionKey]) ? current[questionKey] : [];
      const nextValues = checked
        ? [...currentValues, option]
        : currentValues.filter((value) => value !== option);

      return {
        ...current,
        [questionKey]: nextValues,
      };
    });
  };

  const getBranchRows = (question) => {
    if (!question?.branching?.enabled) {
      return [];
    }

    const rows = (question.branching.rules ?? []).map((rule) => {
      const action = normalizeBranchAction(rule.action);
      const optionValue = String(getRuleOptionValue(rule));
      const optionLabel = optionLabelByQuestionId.get(question.id)?.get(optionValue) || optionValue || '조건 없음';

      if (action === BRANCH_ACTIONS.END) {
        return `${optionLabel} -> 설문 종료`;
      }

      if (action === BRANCH_ACTIONS.GO_TO && rule.targetQuestionId) {
        const targetQuestion = questionById.get(rule.targetQuestionId);
        const displayInfo = questionDisplayMap[rule.targetQuestionId];
        const targetLabel = displayInfo?.shortLabel
          ? `${displayInfo.shortLabel}. ${targetQuestion?.title ?? '대상 질문'}`
          : targetQuestion?.title ?? '대상 질문';

        return `${optionLabel} -> ${targetLabel}`;
      }

      return `${optionLabel} -> 다음 질문`;
    });

    if (
      question.branching.fallbackAction &&
      normalizeBranchAction(question.branching.fallbackAction) !== BRANCH_ACTIONS.NEXT
    ) {
      const action = normalizeBranchAction(question.branching.fallbackAction);
      const targetQuestion = questionById.get(question.branching.fallbackTargetQuestionId);
      const displayInfo = questionDisplayMap[question.branching.fallbackTargetQuestionId];
      const targetLabel = action === BRANCH_ACTIONS.END
        ? '설문 종료'
        : displayInfo?.shortLabel
          ? `${displayInfo.shortLabel}. ${targetQuestion?.title ?? '대상 질문'}`
          : targetQuestion?.title ?? '대상 질문';

      rows.push(`그 외 응답 -> ${targetLabel}`);
    }

    return rows.filter(Boolean);
  };

  const renderBranchInfo = (question) => {
    const rows = getBranchRows(question);

    if (rows.length === 0) {
      return null;
    }

    return (
      <div className="preview-branch-info">
        <strong>분기 정보</strong>
        {rows.map((row) => (
          <small key={`${question.id}-${row}`}>{row}</small>
        ))}
      </div>
    );
  };

  const renderOtherInput = (question, index, visible) => {
    if (!question.allowOther || !visible) {
      return null;
    }

    const questionKey = getQuestionKey(question, index);

    return (
      <input
        type="text"
        value={otherInputs[questionKey] ?? ''}
        onChange={(event) =>
          setOtherInputs((current) => ({ ...current, [questionKey]: event.target.value }))
        }
        placeholder="기타 내용을 입력해주세요."
      />
    );
  };

  const renderQuestionInput = (question, index) => {
    const questionKey = getQuestionKey(question, index);
    const value = answers[questionKey];
    const optionItems = getQuestionOptionItems(question, survey?.optionQuotaCounts);

    if (question.type === QUESTION_TYPES.DESCRIPTION_BLOCK) {
      return <div className="inline-note">{question.description || '안내 내용'}</div>;
    }

    if (question.type === QUESTION_TYPES.SECTION_TITLE) {
      return (
        <div className="section-block">
          <strong>{question.title}</strong>
          {question.description && <p>{question.description}</p>}
        </div>
      );
    }

    if (question.type === QUESTION_TYPES.LONG_TEXT) {
      return (
        <textarea
          rows="4"
          value={value ?? ''}
          onChange={(event) => handleChange(questionKey, event.target.value)}
          placeholder={question.placeholder || '응답을 입력해주세요.'}
        />
      );
    }

    if ([QUESTION_TYPES.PHONE, QUESTION_TYPES.EMAIL, QUESTION_TYPES.DATE, QUESTION_TYPES.TIME, QUESTION_TYPES.NUMBER].includes(question.type)) {
      const inputTypeMap = {
        [QUESTION_TYPES.PHONE]: 'tel',
        [QUESTION_TYPES.EMAIL]: 'email',
        [QUESTION_TYPES.DATE]: 'date',
        [QUESTION_TYPES.TIME]: 'time',
        [QUESTION_TYPES.NUMBER]: 'number',
      };

      return (
        <input
          type={inputTypeMap[question.type]}
          value={value ?? ''}
          onChange={(event) => handleChange(questionKey, event.target.value)}
          placeholder={question.placeholder || ''}
        />
      );
    }

    if (isScaleQuestionType(question.type)) {
      const scaleConfig = getScaleQuestionConfig(question);

      return (
        <div className="scale-choice-list">
          <div className="scale-choice-row">
            {scaleConfig.values.map((scaleValue) => (
              <label className="scale-choice-item" key={`${questionKey}-${scaleValue}`}>
                <input
                  checked={String(value ?? '') === String(scaleValue)}
                  name={`preview-${questionKey}`}
                  onChange={() => handleChange(questionKey, String(scaleValue))}
                  type="radio"
                />
                <span>{scaleValue}</span>
              </label>
            ))}
          </div>
          <div className="scale-label-row">
            <small>{scaleConfig.minLabel}</small>
            <small>{scaleConfig.maxLabel}</small>
          </div>
        </div>
      );
    }

    if (question.type === QUESTION_TYPES.SINGLE_CHOICE) {
      return (
        <>
          <div className="choice-list">
            {optionItems.map((option) => (
              <label className="response-choice-item" key={`${questionKey}-${option.value}`}>
                <input
                  checked={value === option.value}
                  name={`preview-${questionKey}`}
                  onChange={() => handleChange(questionKey, option.value)}
                  type="radio"
                />
                <span className="response-choice-text">{option.label}</span>
              </label>
            ))}
            {question.allowOther && (
              <label className="response-choice-item" key={`${questionKey}-other`}>
                <input
                  checked={value === OTHER_OPTION_VALUE}
                  name={`preview-${questionKey}`}
                  onChange={() => handleChange(questionKey, OTHER_OPTION_VALUE)}
                  type="radio"
                />
                <span className="response-choice-text">기타</span>
              </label>
            )}
          </div>
          {renderOtherInput(question, index, value === OTHER_OPTION_VALUE)}
        </>
      );
    }

    if (question.type === QUESTION_TYPES.MULTIPLE_CHOICE) {
      return (
        <>
          <div className="choice-list">
            {optionItems.map((option) => (
              <label className="response-choice-item" key={`${questionKey}-${option.value}`}>
                <input
                  checked={Array.isArray(value) ? value.includes(option.value) : false}
                  onChange={(event) =>
                    handleMultipleChoiceChange(questionKey, option.value, event.target.checked)
                  }
                  type="checkbox"
                />
                <span className="response-choice-text">{option.label}</span>
              </label>
            ))}
            {question.allowOther && (
              <label className="response-choice-item" key={`${questionKey}-other`}>
                <input
                  checked={Array.isArray(value) ? value.includes(OTHER_OPTION_VALUE) : false}
                  onChange={(event) =>
                    handleMultipleChoiceChange(questionKey, OTHER_OPTION_VALUE, event.target.checked)
                  }
                  type="checkbox"
                />
                <span className="response-choice-text">기타</span>
              </label>
            )}
          </div>
          {renderOtherInput(question, index, Array.isArray(value) ? value.includes(OTHER_OPTION_VALUE) : false)}
        </>
      );
    }

    if (question.type === QUESTION_TYPES.DROPDOWN) {
      return (
        <>
          <select value={value ?? ''} onChange={(event) => handleChange(questionKey, event.target.value)}>
            <option value="">선택해주세요</option>
            {optionItems.map((option) => (
              <option key={`${questionKey}-${option.value}`} value={option.value}>
                {option.label}
              </option>
            ))}
            {question.allowOther && <option value={OTHER_OPTION_VALUE}>기타</option>}
          </select>
          {renderOtherInput(question, index, value === OTHER_OPTION_VALUE)}
        </>
      );
    }

    if (question.type === QUESTION_TYPES.APPLICATION_SLOT_CHOICE) {
      return (
        <div className="slot-choice-list">
          {optionItems.map((option) => (
            <label
              className={`slot-choice-card ${value === option.value ? 'slot-choice-card-selected' : ''}`}
              key={`${questionKey}-${option.value}`}
            >
              <input
                checked={value === option.value}
                name={`preview-${questionKey}`}
                onChange={() => handleChange(questionKey, option.value)}
                type="radio"
              />
              <div className="slot-choice-body">
                <div className="slot-choice-heading">
                  <strong>{option.ageGroup || option.title || option.label}</strong>
                </div>
                <p>{[option.date, option.time].filter(Boolean).join(' ') || '일시 미정'}</p>
                <small>{option.place || '장소 추후 안내'}</small>
              </div>
            </label>
          ))}
        </div>
      );
    }

    if (question.type === QUESTION_TYPES.CONSENT_CHECKBOX || question.meta?.consentApproval) {
      return (
        <label className="consent-check-item">
          <input
            checked={Boolean(value)}
            onChange={(event) => handleChange(questionKey, event.target.checked)}
            type="checkbox"
          />
          <span>위 내용에 동의합니다.</span>
        </label>
      );
    }

    return (
      <input
        type="text"
        value={value ?? ''}
        onChange={(event) => handleChange(questionKey, event.target.value)}
        placeholder={question.placeholder || '응답을 입력해주세요.'}
      />
    );
  };

  const renderQuestion = (question) => {
    const index = normalizedFlow.questions.findIndex((item) => item.id === question.id);
    const displayInfo = questionDisplayMap[question.id];

    if (isNonResponseQuestionType(question.type)) {
      return (
        <div className="field preview-question-card" key={question.id}>
          {renderQuestionInput(question, index)}
        </div>
      );
    }

    return (
      <div className="field preview-question-card" key={question.id}>
        <span className="response-question-title">
          {displayInfo?.shortLabel && (
            <span className="response-question-number">{displayInfo.shortLabel}.</span>
          )}
          <span>{question.title || '제목 없는 질문'}</span>
          {question.required && <small className="required-mark"> * 필수</small>}
        </span>
        {question.description && <small>{question.description}</small>}
        {isScaleQuestionType(question.type) && (
          <small>
            {getScaleQuestionConfig(question)?.min}점부터 {getScaleQuestionConfig(question)?.max}점까지
            선택해주세요.
          </small>
        )}
        {renderQuestionInput(question, index)}
        {renderBranchInfo(question)}
      </div>
    );
  };

  return (
    <div className={`preview-content ${compact ? 'preview-content-compact' : ''}`}>
      <span className="eyebrow">설문 미리보기</span>
      <h1>{survey?.title || '제목 없는 설문'}</h1>
      {survey?.description && (
        <MarkdownRenderer className="response-survey-description" text={survey.description} />
      )}

      <div className="inline-note preview-notice">
        미리보기 화면입니다. 실제 응답은 저장되지 않습니다.
      </div>

      <div className="preview-section-list">
        {groupedSections.map((section, sectionIndex) => (
          <section className="preview-section-block" key={section.id}>
            <div className="preview-section-heading">
              <span>{sectionIndex + 1}페이지</span>
              <h2>{section.title || `섹션 ${sectionIndex + 1}`}</h2>
              {section.description && <p>{section.description}</p>}
            </div>
            <div className="response-form">
              {section.questions.length > 0 ? (
                section.questions.map((question) => renderQuestion(question))
              ) : (
                <div className="inline-note">이 페이지에 포함된 질문이 없습니다.</div>
              )}
            </div>
          </section>
        ))}
      </div>

      {actions && <div className="builder-footer preview-actions">{actions}</div>}
    </div>
  );
}

export default SurveyPreviewContent;
