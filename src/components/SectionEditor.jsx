import { useMemo, useState } from 'react';
import {
  CONDITION_COMBINATORS,
  CONDITION_OPERATORS,
  createConditionId,
  isNonResponseQuestionType,
} from '../firebase/surveys';
import { getQuestionDisplayInfo } from '../utils/questionNumbering';

function createEmptyCondition(questionId = '') {
  return {
    id: createConditionId(),
    questionId,
    operator: CONDITION_OPERATORS.EQUALS,
    value: '',
  };
}

function getSectionRuleSummary(section, questions, questionDisplayMap = {}) {
  const questionMap = new Map(
    questions.map((question, index) => [
      question.id,
      getQuestionDisplayInfo(questionDisplayMap, question, index).label,
    ]),
  );
  const summaries = [];

  if (!section.visibilityConditions?.length) {
    summaries.push('항상 보이기');
  } else if (
    section.visibilityConditions.length === 1 &&
    section.visibilityCombinator === CONDITION_COMBINATORS.AND
  ) {
    const condition = section.visibilityConditions[0];
    const questionLabel = questionMap.get(condition.questionId) ?? '선택한 질문';

    if (condition.operator === CONDITION_OPERATORS.EQUALS) {
      summaries.push(`${questionLabel}의 답이 "${condition.value || '설정 필요'}"이면 보여줌`);
    } else if (condition.operator === CONDITION_OPERATORS.NOT_EQUALS) {
      summaries.push(`${questionLabel}의 답이 "${condition.value || '설정 필요'}"이 아니면 보여줌`);
    } else {
      summaries.push(`보여주기 기준 1개 설정됨`);
    }
  } else {
    summaries.push(`보여주기 기준 ${section.visibilityConditions.length}개 설정됨`);
  }

  if (section.terminationEnabled) {
    if (
      section.terminationConditions?.length === 1 &&
      section.terminationCombinator === CONDITION_COMBINATORS.AND
    ) {
      const condition = section.terminationConditions[0];
      const questionLabel = questionMap.get(condition.questionId) ?? '선택한 질문';
      summaries.push(
        `${questionLabel}의 답이 "${condition.value || '설정 필요'}"이면 여기서 종료`,
      );
    } else {
      summaries.push(`종료 기준 ${section.terminationConditions?.length ?? 0}개 설정됨`);
    }
  }

  return summaries;
}

function SectionEditor({
  section,
  sections = [],
  index,
  questions = [],
  questionDisplayMap = {},
  formType = '',
  isFirst,
  isLast,
  onChange,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  onMergeWithPrevious,
  onRemove,
}) {
  const [showMenu, setShowMenu] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const availableQuestions = questions.filter((question) => !isNonResponseQuestionType(question.type));
  const titledQuestions = availableQuestions.filter((question) => question.title?.trim?.());
  const selectableQuestions = titledQuestions.length > 0 ? titledQuestions : availableQuestions;
  const questionOptions = selectableQuestions.map((question, questionIndex) => ({
    id: question.id,
    label: getQuestionDisplayInfo(
      questionDisplayMap,
      question,
      questions.findIndex((item) => item.id === question.id),
    ).label,
  }));
  const ruleSummaries = useMemo(
    () => getSectionRuleSummary(section, availableQuestions, questionDisplayMap),
    [section, availableQuestions, questionDisplayMap],
  );
  const sectionQuestionCount = questions.filter((question) => question.sectionId === section.id).length;
  const pageEndLabel =
    section.pageEndAction === 'go_to_section'
      ? `특정 페이지로 이동: ${
          sections.find((item) => item.id === section.pageEndTargetSectionId)?.title || '페이지 선택 필요'
        }`
      : section.pageEndAction === 'submit'
        ? '설문 제출'
        : section.pageEndAction === 'end'
          ? '설문 종료'
          : '다음 페이지로 이동';
  const primaryQuestionId = questionOptions[0]?.id ?? '';
  const primaryVisibilityCondition = section.visibilityConditions?.[0] ?? createEmptyCondition(primaryQuestionId);
  const easyVisibilityMode =
    !section.visibilityConditions?.length
      ? 'always'
      : primaryVisibilityCondition.operator === CONDITION_OPERATORS.NOT_EQUALS
        ? 'hide_when'
        : 'show_when';
  const primaryTerminationCondition =
    section.terminationConditions?.[0] ?? createEmptyCondition(primaryQuestionId);
  const isApplicationBranching = String(formType).includes('application');
  const quickTemplates = isApplicationBranching
    ? [
        {
          label: '영유아 선택 시 보호자 정보',
          description: '영유아 신청자에게만 보호자 연락처와 동의 정보를 추가로 받습니다.',
          example: '영유아를 고르면 보호자 정보 페이지를 보여줍니다.',
          type: 'show',
          value: '영유아',
          title: '보호자 정보',
        },
        {
          label: '초등학생 선택 시 학년 질문',
          description: '초등학생 신청자에게만 학년, 학교 관련 질문을 이어서 보여줍니다.',
          example: '초등학생을 고르면 학년 정보 페이지를 보여줍니다.',
          type: 'show',
          value: '초등학생',
          title: '학년 정보',
        },
        {
          label: '오전반 선택 시 오전 안내',
          description: '오전반 신청자에게만 오전 준비사항과 안내를 보여줍니다.',
          example: '오전반을 고르면 오전 안내 페이지를 보여줍니다.',
          type: 'show',
          value: '오전반',
          title: '오전 안내',
        },
        {
          label: '비대상자면 종료',
          description: '신청 대상이 아닌 경우 더 진행하지 않고 안내 문구로 마무리합니다.',
          example: '비대상 응답이면 여기서 신청을 종료합니다.',
          type: 'end',
          value: '아니오',
          title: '비대상 안내',
          message: '현재 신청 대상이 아니어서 접수를 종료합니다.',
        },
      ]
    : [
        {
          label: '예라고 답한 사람만 추가 질문 보기',
          description: '특정 경험이 있는 사람에게만 후속 질문을 물을 때 사용합니다.',
          example: '예라고 답한 분만 추가 페이지를 보여줍니다.',
          type: 'show',
          value: '예',
          title: '추가 질문',
        },
        {
          label: '아니오 선택 시 종료',
          description: '응답 대상이 아닌 경우 여기서 설문을 마무리할 수 있습니다.',
          example: '아니오를 고르면 여기서 응답을 종료합니다.',
          type: 'end',
          value: '아니오',
          message: '응답을 종료합니다.',
        },
        {
          label: '특정 답변군만 후속 질문 보기',
          description: '특정 그룹에게만 이어지는 후속 질문을 보여줍니다.',
          example: '특정 답변군을 선택한 경우에만 추가 페이지를 보여줍니다.',
          type: 'hide',
          value: '해당 없음',
          title: '추가 질문',
        },
      ];
  const pageTargetOptions = sections
    .filter((candidateSection) => candidateSection.id !== section.id)
    .map((candidateSection, candidateIndex) => ({
      id: candidateSection.id,
      label: candidateSection.title?.trim?.() || `페이지 ${candidateIndex + 1}`,
    }));

  const applySimpleVisibility = (mode, nextQuestionId = primaryVisibilityCondition.questionId, nextValue = primaryVisibilityCondition.value) => {
    if (mode === 'always') {
      onChange({
        ...section,
        visibilityConditions: [],
        visibilityCombinator: CONDITION_COMBINATORS.AND,
      });
      return;
    }

    onChange({
      ...section,
      visibilityCombinator: CONDITION_COMBINATORS.AND,
      visibilityConditions: [
        {
          id: primaryVisibilityCondition.id ?? createConditionId(),
          questionId: nextQuestionId,
          operator:
            mode === 'hide_when'
              ? CONDITION_OPERATORS.NOT_EQUALS
              : CONDITION_OPERATORS.EQUALS,
          value: nextValue,
        },
      ],
    });
  };

  const applySimpleTermination = (enabled, nextQuestionId = primaryTerminationCondition.questionId, nextValue = primaryTerminationCondition.value) => {
    if (!enabled) {
      onChange({
        ...section,
        terminationEnabled: false,
        terminationConditions: [],
      });
      return;
    }

    onChange({
      ...section,
      terminationEnabled: true,
      terminationCombinator: CONDITION_COMBINATORS.AND,
      terminationConditions: [
        {
          id: primaryTerminationCondition.id ?? createConditionId(),
          questionId: nextQuestionId,
          operator: CONDITION_OPERATORS.EQUALS,
          value: nextValue,
        },
      ],
    });
  };

  const applyTemplate = (template) => {
    if (!primaryQuestionId) {
      return;
    }

    if (template.title && !section.title?.trim()) {
      onChange({
        ...section,
        title: template.title,
      });
    }

    if (template.type === 'show') {
      onChange({
        ...section,
        title: section.title?.trim() ? section.title : template.title ?? section.title,
        visibilityCombinator: CONDITION_COMBINATORS.AND,
        visibilityConditions: [
          {
            id: primaryVisibilityCondition.id ?? createConditionId(),
            questionId: primaryQuestionId,
            operator: CONDITION_OPERATORS.EQUALS,
            value: template.value,
          },
        ],
      });
      return;
    }

    if (template.type === 'hide') {
      onChange({
        ...section,
        title: section.title?.trim() ? section.title : template.title ?? section.title,
        visibilityCombinator: CONDITION_COMBINATORS.AND,
        visibilityConditions: [
          {
            id: primaryVisibilityCondition.id ?? createConditionId(),
            questionId: primaryQuestionId,
            operator: CONDITION_OPERATORS.NOT_EQUALS,
            value: template.value,
          },
        ],
      });
      return;
    }

    if (template.type === 'end') {
      onChange({
        ...section,
        title: section.title?.trim() ? section.title : template.title ?? section.title,
        terminationEnabled: true,
        terminationCombinator: CONDITION_COMBINATORS.AND,
        terminationConditions: [
          {
            id: primaryTerminationCondition.id ?? createConditionId(),
            questionId: primaryQuestionId,
            operator: CONDITION_OPERATORS.EQUALS,
            value: template.value,
          },
        ],
        terminationMessage: template.message ?? section.terminationMessage,
      });
    }
  };

  const updateConditionGroup = (key, nextConditions) => {
    onChange({
      ...section,
      [key]: nextConditions,
    });
  };

  const addCondition = (key) => {
    updateConditionGroup(key, [
      ...(section[key] ?? []),
      createEmptyCondition(primaryQuestionId),
    ]);
  };

  const updateCondition = (key, conditionId, field, value) => {
    updateConditionGroup(
      key,
      (section[key] ?? []).map((condition) =>
        condition.id === conditionId ? { ...condition, [field]: value } : condition,
      ),
    );
  };

  const removeCondition = (key, conditionId) => {
    updateConditionGroup(
      key,
      (section[key] ?? []).filter((condition) => condition.id !== conditionId),
    );
  };

  const renderConditionEditor = (title, key, combinatorKey) => (
    <div className="section-condition-group">
      <div className="builder-header-row option-header-row">
        <span>{title}</span>
        <button className="secondary-button" onClick={() => addCondition(key)} type="button">
          기준 추가
        </button>
      </div>

      <label className="field inline-field">
        <span>기준 묶는 방식</span>
        <select
          value={section[combinatorKey] ?? CONDITION_COMBINATORS.AND}
          onChange={(event) => onChange({ ...section, [combinatorKey]: event.target.value })}
        >
          <option value={CONDITION_COMBINATORS.AND}>모두 만족(AND)</option>
          <option value={CONDITION_COMBINATORS.OR}>하나만 만족해도 됨(OR)</option>
        </select>
      </label>

      {(section[key] ?? []).length === 0 ? (
        <div className="inline-note">기준이 없으면 항상 표시됩니다.</div>
      ) : (
        <div className="branch-rule-list">
          {(section[key] ?? []).map((condition, conditionIndex) => (
            <div className="branch-rule-card" key={condition.id}>
              <div className="builder-header-row option-header-row">
                <strong>기준 {conditionIndex + 1}</strong>
                <button
                  className="text-button danger-text"
                  onClick={() => removeCondition(key, condition.id)}
                  type="button"
                >
                  삭제
                </button>
              </div>

              <label className="field">
                <span>어떤 답을 기준으로 할까요?</span>
                <select
                  value={condition.questionId}
                  onChange={(event) =>
                    updateCondition(key, condition.id, 'questionId', event.target.value)
                  }
                >
                  <option value="">질문을 선택해주세요</option>
                  {questionOptions.map((question) => (
                    <option key={question.id} value={question.id}>
                      {question.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>비교 방식</span>
                <select
                  value={condition.operator}
                  onChange={(event) =>
                    updateCondition(key, condition.id, 'operator', event.target.value)
                  }
                >
                  <option value={CONDITION_OPERATORS.EQUALS}>같음</option>
                  <option value={CONDITION_OPERATORS.NOT_EQUALS}>같지 않음</option>
                  <option value={CONDITION_OPERATORS.INCLUDES}>포함함</option>
                  <option value={CONDITION_OPERATORS.NOT_INCLUDES}>포함하지 않음</option>
                  <option value={CONDITION_OPERATORS.IS_EMPTY}>비어 있음</option>
                  <option value={CONDITION_OPERATORS.IS_NOT_EMPTY}>비어 있지 않음</option>
                </select>
              </label>

              {![CONDITION_OPERATORS.IS_EMPTY, CONDITION_OPERATORS.IS_NOT_EMPTY].includes(
                condition.operator,
              ) && (
                <label className="field">
                  <span>어떤 답일 때?</span>
                  <input
                    type="text"
                    value={condition.value ?? ''}
                    onChange={(event) =>
                      updateCondition(key, condition.id, 'value', event.target.value)
                    }
                    placeholder="예: 영유아"
                  />
                </label>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="page-separator">
      <div className="page-separator-line" />
      <div className="page-separator-main">
        <div className="page-card-title">
          <span>페이지 {index + 1}</span>
          <small>
            질문 {sectionQuestionCount}개 · 완료 후 {pageEndLabel}
          </small>
        </div>
        <div className="page-menu-wrap">
          <button
            aria-label="페이지 더보기"
            className="page-more-button"
            onClick={() => setShowMenu((current) => !current)}
            type="button"
          >
            ⋯
          </button>
          {showMenu && (
            <div className="page-more-menu">
              <button onClick={onDuplicate} type="button">
                페이지 복제
              </button>
              <div className="page-more-group">
                <span>페이지 이동</span>
                <div className="page-more-group-actions">
                  <button disabled={isFirst} onClick={onMoveUp} type="button">
                    위로
                  </button>
                  <button disabled={isLast} onClick={onMoveDown} type="button">
                    아래로
                  </button>
                </div>
              </div>
              <button disabled={isFirst} onClick={onMergeWithPrevious} type="button">
                위 페이지와 병합
              </button>
              <button className="danger-text" onClick={onRemove} type="button">
                페이지 삭제
              </button>
              <button
                onClick={() => {
                  setShowAdvanced((current) => !current);
                  setShowMenu(false);
                }}
                type="button"
              >
                고급 흐름 설정
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="page-separator-line" />

      <div className="page-edit-panel">
        <label className="field">
          <input
            type="text"
            value={section.title}
            onChange={(event) => onChange({ ...section, title: event.target.value })}
            placeholder="예: 신청 정보"
          />
        </label>
        <label className="field">
          <textarea
            rows="2"
            value={section.description}
            onChange={(event) => onChange({ ...section, description: event.target.value })}
            placeholder="이 페이지에서 받을 내용을 안내하세요."
          />
        </label>
      </div>

      {showAdvanced && (
        <>
          <div className="rule-summary-list">
            {ruleSummaries.map((summary) => (
              <span className="rule-summary-chip" key={`${section.id}-${summary}`}>
                {summary}
              </span>
            ))}
          </div>

          <div className="branching-panel">
        <div className="builder-header-row option-header-row">
          <div>
            <strong>자주 쓰는 이동</strong>
            <p className="branching-help">
              많이 쓰는 페이지 이동만 먼저 정할 수 있습니다. 더 자세한 설정은 아래에서 추가할 수 있습니다.
            </p>
          </div>
          <button
            className="secondary-button"
            onClick={() => setShowAdvanced((current) => !current)}
            type="button"
          >
            {showAdvanced ? '고급 흐름 닫기' : '고급 흐름 열기'}
          </button>
        </div>

        {questionOptions.length === 0 ? (
          <div className="inline-note">
            먼저 질문 제목을 입력하면 여기서 기준 질문을 선택할 수 있습니다.
          </div>
        ) : (
          <>
            <div className="preset-chip-row">
              <button className="secondary-button" onClick={() => applySimpleVisibility('show_when')} type="button">
                특정 답일 때 이 페이지 보여주기
              </button>
              <button
                className="secondary-button"
                onClick={() => applySimpleVisibility('hide_when')}
                type="button"
              >
                특정 답일 때 이 페이지 숨기기
              </button>
              <button
                className="secondary-button"
                onClick={() => applySimpleTermination(true)}
                type="button"
              >
                특정 답이면 여기서 종료
              </button>
              <button
                className="secondary-button"
                onClick={() => applySimpleVisibility('always')}
                type="button"
              >
                항상 보이기
              </button>
            </div>

            <div className="field">
              <span>{isApplicationBranching ? '신청형 예시' : '설문형 예시'}</span>
              <div className="example-card-grid">
                {quickTemplates.map((template) => (
                  <article className="example-rule-card" key={`${section.id}-${template.label}`}>
                    <strong>{template.label}</strong>
                    <p>{template.description}</p>
                    <small>{template.example}</small>
                    <button
                      className="secondary-button"
                      onClick={() => applyTemplate(template)}
                      type="button"
                    >
                      이 예시 사용
                    </button>
                  </article>
                ))}
              </div>
            </div>

            <label className="field">
              <span>이 페이지는 어떻게 보여줄까요?</span>
              <select
                value={easyVisibilityMode}
                onChange={(event) => applySimpleVisibility(event.target.value)}
              >
                <option value="always">항상 보이기</option>
                <option value="show_when">특정 답일 때 보여주기</option>
                <option value="hide_when">특정 답일 때 숨기기</option>
              </select>
            </label>

            {easyVisibilityMode !== 'always' && (
              <>
                <label className="field">
                  <span>어떤 답을 기준으로 할까요?</span>
                  <select
                    value={primaryVisibilityCondition.questionId}
                    onChange={(event) =>
                      applySimpleVisibility(
                        easyVisibilityMode,
                        event.target.value,
                        primaryVisibilityCondition.value,
                      )
                    }
                  >
                    <option value="">질문을 선택해주세요</option>
                    {questionOptions.map((question) => (
                      <option key={question.id} value={question.id}>
                        {question.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>어떤 답일 때?</span>
                  <input
                    type="text"
                    value={primaryVisibilityCondition.value ?? ''}
                    onChange={(event) =>
                      applySimpleVisibility(
                        easyVisibilityMode,
                        primaryVisibilityCondition.questionId,
                        event.target.value,
                      )
                    }
                    placeholder="예: 영유아"
                  />
                </label>
              </>
            )}

            <label className="checkbox-field">
              <input
                checked={Boolean(section.terminationEnabled)}
                onChange={(event) => applySimpleTermination(event.target.checked)}
                type="checkbox"
              />
              <span>특정 답이면 여기서 신청/응답 종료하기</span>
            </label>

            {section.terminationEnabled && (
              <>
                <label className="field">
                  <span>어떤 답을 기준으로 할까요?</span>
                  <select
                    value={primaryTerminationCondition.questionId}
                    onChange={(event) =>
                      applySimpleTermination(
                        true,
                        event.target.value,
                        primaryTerminationCondition.value,
                      )
                    }
                  >
                    <option value="">질문을 선택해주세요</option>
                    {questionOptions.map((question) => (
                      <option key={question.id} value={question.id}>
                        {question.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>어떤 답일 때?</span>
                  <input
                    type="text"
                    value={primaryTerminationCondition.value ?? ''}
                    onChange={(event) =>
                      applySimpleTermination(
                        true,
                        primaryTerminationCondition.questionId,
                        event.target.value,
                      )
                    }
                    placeholder="예: 아니오"
                  />
                </label>

                <label className="field">
                  <span>종료 안내 문구</span>
                  <textarea
                    rows="3"
                    value={section.terminationMessage ?? ''}
                    onChange={(event) =>
                      onChange({ ...section, terminationMessage: event.target.value })
                    }
                    placeholder="예: 현재 신청 대상이 아니어서 접수를 종료합니다."
                  />
                </label>
              </>
            )}

            <div className="field">
              <span>이 페이지 다음에는</span>
              <select
                value={section.pageEndAction ?? 'next'}
                onChange={(event) =>
                  onChange({
                    ...section,
                    pageEndAction: event.target.value,
                    pageEndTargetSectionId:
                      event.target.value === 'go_to_section'
                        ? section.pageEndTargetSectionId ?? ''
                        : '',
                  })
                }
              >
                <option value="next">다음 페이지로 이동</option>
                <option value="go_to_section">특정 페이지로 이동</option>
                <option value="submit">설문 제출</option>
                <option value="end">설문 종료</option>
              </select>
            </div>

            {section.pageEndAction === 'go_to_section' && (
              <label className="field">
                <span>이동할 페이지</span>
                <select
                  value={section.pageEndTargetSectionId ?? ''}
                  onChange={(event) =>
                    onChange({
                      ...section,
                      pageEndTargetSectionId: event.target.value,
                    })
                  }
                >
                  <option value="">페이지 선택</option>
                  {pageTargetOptions.map((target) => (
                    <option key={`${section.id}-${target.id}`} value={target.id}>
                      {target.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}

        {showAdvanced && (
          <div className="advanced-rule-panel">
            {renderConditionEditor('추가 보여주기 기준', 'visibilityConditions', 'visibilityCombinator')}

            <div className="toggle-grid">
              <label className="checkbox-field">
                <input
                  checked={Boolean(section.terminationEnabled)}
                  onChange={(event) =>
                    onChange({ ...section, terminationEnabled: event.target.checked })
                  }
                  type="checkbox"
                />
                <span>추가 종료 기준 사용</span>
              </label>
            </div>

            {section.terminationEnabled && (
              <>
                {renderConditionEditor(
                  '추가 종료 기준',
                  'terminationConditions',
                  'terminationCombinator',
                )}

                <label className="field">
                  <span>종료 안내 문구</span>
                  <textarea
                    rows="3"
                    value={section.terminationMessage ?? ''}
                    onChange={(event) =>
                      onChange({ ...section, terminationMessage: event.target.value })
                    }
                    placeholder="예: 현재 신청 대상이 아니어서 접수를 종료합니다."
                  />
                </label>
              </>
            )}
          </div>
        )}
          </div>
        </>
      )}
    </div>
  );
}

export default SectionEditor;
