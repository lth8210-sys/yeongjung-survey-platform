import { useEffect, useMemo, useState } from 'react';
import {
  BRANCH_ACTIONS,
  createBranchRuleId,
  getScaleQuestionConfig,
  getQuestionOptionItems,
  isScaleQuestionType,
  isSelectableQuestionType,
  isNonResponseQuestionType,
  OTHER_OPTION_VALUE,
  QUESTION_TYPES,
  supportsPlaceholder,
} from '../firebase/surveys';
import { getQuestionDisplayInfo } from '../utils/questionNumbering';

function createEmptySlot(index) {
  return {
    key: `slot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: '',
    date: '',
    time: '',
    place: '',
    ageGroup: '',
    capacity: '',
    sortOrder: index + 1,
  };
}

function buildConsentDescription(settings = {}) {
  return [
    `수집항목: ${settings.collectionItems || ''}`.trim(),
    `이용목적: ${settings.usagePurpose || ''}`.trim(),
    `보관기간: ${settings.retentionPeriod || ''}`.trim(),
    settings.restrictionNotice?.trim?.() || '',
  ]
    .filter(Boolean)
    .join('\n');
}

function getDefaultConsentSettings(currentSettings = {}) {
  return {
    collectionItems: currentSettings.collectionItems || '이름, 연락처, 생년월일 등',
    usagePurpose: currentSettings.usagePurpose || '신청 접수 및 안내',
    retentionPeriod: currentSettings.retentionPeriod || '사업 종료 후 파기',
    restrictionNotice:
      currentSettings.restrictionNotice || '동의 거부 시 신청이 제한될 수 있음',
  };
}

function buildSlotDisplayTitle(slot = {}, index = 0) {
  const explicitTitle = String(slot.title ?? '').trim();
  const ageGroup = String(slot.ageGroup ?? '').trim();
  const date = String(slot.date ?? '').trim();
  const time = String(slot.time ?? '').trim();
  const place = String(slot.place ?? '').trim();
  const autoTitle = [ageGroup, date, time, place].filter(Boolean).join(' / ');

  if (autoTitle) {
    return autoTitle;
  }

  return explicitTitle || `신청 항목 ${index + 1}`;
}

function buildSlotRows(question, optionQuotaCounts) {
  const normalizedOptions = Array.isArray(question.options) ? question.options : [];
  const optionItems = getQuestionOptionItems(question, optionQuotaCounts);

  return normalizedOptions.map((option, optionIndex) => {
    const optionSetting = question.optionSettings?.[option] ?? {};
    const matchedItem = optionItems.find((item) => item.value === option);

    return {
      key: option,
      title: optionSetting.title ?? option,
      date: optionSetting.date ?? '',
      time: optionSetting.time ?? '',
      place: optionSetting.place ?? '',
      ageGroup: optionSetting.ageGroup ?? '',
      capacity: optionSetting.capacity ?? '',
      sortOrder: optionSetting.sortOrder ?? optionIndex + 1,
      currentCount: matchedItem?.currentCount ?? 0,
      remainingCount: matchedItem?.remainingCount ?? null,
      isClosed: matchedItem?.isClosed ?? false,
    };
  });
}

function QuestionEditor({
  question,
  questions = [],
  sections = [],
  index,
  displayLabel,
  questionDisplayMap = {},
  onChange,
  onMoveDown,
  onMoveUp,
  onDuplicate,
  onRemove,
  isFirst,
  isLast,
  showBranchingEditor = false,
  optionQuotaCounts = {},
}) {
  const [showDetails, setShowDetails] = useState(false);
  const [showDescriptionInput, setShowDescriptionInput] = useState(Boolean(question.description?.trim?.()));
  const [showConsentSettings, setShowConsentSettings] = useState(false);
  const normalizedOptions = Array.isArray(question.options) ? question.options : [];
  const isSlotChoice = question.type === QUESTION_TYPES.APPLICATION_SLOT_CHOICE;
  const selectableType = isSelectableQuestionType(question.type);
  const nonResponseType = isNonResponseQuestionType(question.type);
  const placeholderSupported = supportsPlaceholder(question.type);
  const scaleQuestion = isScaleQuestionType(question.type);
  const consentTemplateQuestion = question.meta?.consentTemplate === 'base';
  const simplifiedConsentBlock =
    consentTemplateQuestion && question.type === QUESTION_TYPES.DESCRIPTION_BLOCK;
  const scaleConfig = scaleQuestion ? getScaleQuestionConfig(question) : null;
  const optionItems = getQuestionOptionItems(question, optionQuotaCounts);
  const [slotDraftRows, setSlotDraftRows] = useState(() => buildSlotRows(question, optionQuotaCounts));
  const optionQuotaSupported =
    question.type === QUESTION_TYPES.SINGLE_CHOICE ||
    question.type === QUESTION_TYPES.DROPDOWN ||
    question.type === QUESTION_TYPES.APPLICATION_SLOT_CHOICE;
  const isMultipleChoiceType = question.type === QUESTION_TYPES.MULTIPLE_CHOICE;
  const maxSelectionsValue = question.validation?.maxSelections ?? '';
  const optionCapacityEnabled =
    Boolean(question.meta?.optionCapacityEnabled) || optionItems.some((item) => item.capacity);
  const simpleBranchingSupported =
    question.type === QUESTION_TYPES.SINGLE_CHOICE ||
    question.type === QUESTION_TYPES.DROPDOWN;
  const branching = question.branching ?? {
    enabled: false,
    rules: [],
    fallbackAction: BRANCH_ACTIONS.NEXT,
    fallbackTargetQuestionId: '',
  };
  const branchTargets = questions
    .filter((item) => item.id !== question.id && !isNonResponseQuestionType(item.type))
    .map((item, itemIndex) => ({
      id: item.id,
      label: getQuestionDisplayInfo(
        questionDisplayMap,
        item,
        questions.findIndex((candidate) => candidate.id === item.id),
      ).label,
    }));
  const sectionTargets = sections
    .map((section) => {
      const firstQuestion = questions.find(
        (item) => item.id !== question.id && item.sectionId === section.id,
      );

      if (!firstQuestion) {
        return null;
      }

      return {
        sectionId: section.id,
        targetQuestionId: firstQuestion.id,
        label: `페이지: ${section.title}`,
      };
    })
    .filter(Boolean);
  const selectableBranchOptions = [
    ...normalizedOptions.map((option) => ({ value: option, label: option })),
    ...(question.allowOther ? [{ value: OTHER_OPTION_VALUE, label: '기타(직접입력)' }] : []),
  ];
  const slotRows = isSlotChoice ? slotDraftRows : [];
  const consentSettings = question.type === QUESTION_TYPES.CONSENT_CHECKBOX
    ? getDefaultConsentSettings(question.settings)
    : null;

  useEffect(() => {
    if (!isSlotChoice) {
      setSlotDraftRows([]);
      return;
    }

    setSlotDraftRows(buildSlotRows(question, optionQuotaCounts));
  }, [isSlotChoice, optionQuotaCounts, question.id]);

  useEffect(() => {
    if (question.description?.trim?.()) {
      setShowDescriptionInput(true);
    }
  }, [question.description]);

  const updateBranching = (nextBranching) => {
    onChange({
      ...question,
      branching: {
        enabled: false,
        rules: [],
        fallbackAction: BRANCH_ACTIONS.NEXT,
        fallbackTargetQuestionId: '',
        ...nextBranching,
      },
    });
  };

  const handleTypeChange = (nextType) => {
    const nextSelectable = isSelectableQuestionType(nextType);
    const nextScaleConfig = isScaleQuestionType(nextType)
      ? getScaleQuestionConfig({ type: nextType })
      : null;
    const nextIsConsent = nextType === QUESTION_TYPES.CONSENT_CHECKBOX;
    const nextConsentSettings = nextIsConsent
      ? getDefaultConsentSettings(question.settings)
      : null;
    const shouldUseConsentTitle =
      nextIsConsent &&
      (!question.title?.trim?.() ||
        question.title === '질문 제목' ||
        question.title === '개인정보 수집·이용에 동의합니다.');

    let nextOptions;
    if (nextType === QUESTION_TYPES.APPLICATION_SLOT_CHOICE) {
      nextOptions = normalizedOptions;
    } else if (!nextSelectable) {
      nextOptions = [];
    } else if (normalizedOptions.length >= 2) {
      nextOptions = normalizedOptions;
    } else if (normalizedOptions.length === 1) {
      nextOptions = [...normalizedOptions, '옵션 2'];
    } else {
      nextOptions = ['옵션 1', '옵션 2'];
    }

    onChange({
      ...question,
      type: nextType,
      options: nextOptions,
      optionSettings:
        nextType === QUESTION_TYPES.SINGLE_CHOICE ||
        nextType === QUESTION_TYPES.DROPDOWN ||
        nextType === QUESTION_TYPES.APPLICATION_SLOT_CHOICE
          ? question.optionSettings ?? {}
          : {},
      required: nextIsConsent
        ? true
        : isNonResponseQuestionType(nextType)
          ? false
          : Boolean(question.required),
      allowOther:
        nextType === QUESTION_TYPES.APPLICATION_SLOT_CHOICE
          ? false
          : nextSelectable
            ? Boolean(question.allowOther)
            : false,
      placeholder: supportsPlaceholder(nextType) ? question.placeholder ?? '' : '',
      title:
        shouldUseConsentTitle
          ? '개인정보 수집·이용에 동의합니다.'
          : question.title,
      description:
        nextIsConsent && !question.description?.trim?.()
          ? '동의하지 않으면 신청을 진행할 수 없습니다.'
          : question.description,
      settings: nextIsConsent
        ? nextConsentSettings
        : nextScaleConfig ?? (question.settings ?? {}),
      branching: nextSelectable
        ? question.branching ?? {
            enabled: false,
            rules: [],
            fallbackAction: BRANCH_ACTIONS.NEXT,
            fallbackTargetQuestionId: '',
          }
        : {
            enabled: false,
            rules: [],
            fallbackAction: BRANCH_ACTIONS.NEXT,
            fallbackTargetQuestionId: '',
          },
    });
  };

  const addOption = () => {
    onChange({
      ...question,
      options: [...normalizedOptions, ''],
      optionSettings: question.optionSettings ?? {},
    });
  };

  const toggleOptionCapacities = (checked) => {
    if (checked) {
      onChange({
        ...question,
        meta: {
          ...(question.meta ?? {}),
          optionCapacityEnabled: true,
        },
      });
      return;
    }

    const nextOptionSettings = Object.entries(question.optionSettings ?? {}).reduce(
      (result, [settingKey, settingValue]) => {
        if (settingValue && typeof settingValue === 'object') {
          const { capacity, ...rest } = settingValue;
          if (Object.keys(rest).length > 0) {
            result[settingKey] = rest;
          }
        }

        return result;
      },
      {},
    );

    onChange({
      ...question,
      optionSettings: nextOptionSettings,
      meta: {
        ...(question.meta ?? {}),
        optionCapacityEnabled: false,
      },
    });
  };

  const updateConsentTemplateField = (key, value) => {
    const nextSettings = {
      ...(question.settings ?? {}),
      [key]: value,
    };

    onChange({
      ...question,
      settings: nextSettings,
      description:
        question.type === QUESTION_TYPES.DESCRIPTION_BLOCK
          ? buildConsentDescription(nextSettings)
          : question.description,
    });
  };

  const persistSlotRows = (nextRows) => {
    const nextOptions = nextRows
      .map((row, rowIndex) => buildSlotDisplayTitle(row, rowIndex))
      .filter(Boolean);

    const nextOptionSettings = nextRows.reduce((result, row, rowIndex) => {
      const normalizedTitle = buildSlotDisplayTitle(row, rowIndex);

      if (!normalizedTitle) {
        return result;
      }

      result[normalizedTitle] = {
        title: normalizedTitle,
        date: row.date,
        time: row.time,
        place: row.place,
        ageGroup: row.ageGroup,
        capacity: row.capacity,
        sortOrder: rowIndex + 1,
      };

      return result;
    }, {});

    onChange({
      ...question,
      options: nextOptions,
      optionSettings: nextOptionSettings,
      allowOther: false,
      branching: syncRulesForOptions(nextOptions, false),
    });
  };

  const addSlotRow = () => {
    const nextRows = [...slotRows, createEmptySlot(slotRows.length)];
    setSlotDraftRows(nextRows);
    persistSlotRows(nextRows);
  };

  const updateSlotRow = (rowIndex, field, value) => {
    const nextRows = slotRows.map((row, currentIndex) =>
      currentIndex === rowIndex
        ? {
            ...row,
            [field]: value,
          }
        : row,
    );

    setSlotDraftRows(nextRows);
    persistSlotRows(nextRows);
  };

  const moveSlotRow = (rowIndex, direction) => {
    const targetIndex = direction === 'up' ? rowIndex - 1 : rowIndex + 1;

    if (targetIndex < 0 || targetIndex >= slotRows.length) {
      return;
    }

    const nextRows = [...slotRows];
    [nextRows[rowIndex], nextRows[targetIndex]] = [nextRows[targetIndex], nextRows[rowIndex]];
    setSlotDraftRows(nextRows);
    persistSlotRows(nextRows);
  };

  const removeSlotRow = (rowIndex) => {
    const nextRows = slotRows.filter((_, currentIndex) => currentIndex !== rowIndex);
    setSlotDraftRows(nextRows);
    persistSlotRows(nextRows);
  };

  const syncRulesForOptions = (nextOptions, nextAllowOther = question.allowOther) => {
    const availableOptions = new Set(nextOptions);

    if (nextAllowOther) {
      availableOptions.add(OTHER_OPTION_VALUE);
    }

    return {
      ...branching,
      rules: (branching.rules ?? []).filter((rule) => availableOptions.has(rule.whenOption)),
    };
  };

  const handleBranchToggle = (checked) => {
    updateBranching({
      ...branching,
      enabled: checked,
      rules: checked ? branching.rules ?? [] : [],
    });
  };

  const getBranchRuleForOption = (optionValue) =>
    (branching.rules ?? []).find((rule) => rule.whenOption === optionValue) ?? null;

  const getInlineFlowMode = (optionValue) => {
    const matchedRule = getBranchRuleForOption(optionValue);

    if (!matchedRule) {
      return 'default';
    }

    if (matchedRule.action === BRANCH_ACTIONS.END) {
      return 'end';
    }

    if (matchedRule.action === BRANCH_ACTIONS.GO_TO) {
      if (matchedRule.targetType === 'page') {
        return 'page';
      }

      return 'question';
    }

    return 'default';
  };

  const setInlineFlowRule = (optionValue, nextMode) => {
    const currentRule = getBranchRuleForOption(optionValue);
    const remainingRules = (branching.rules ?? []).filter((rule) => rule.whenOption !== optionValue);

    if (nextMode === 'default') {
      updateBranching({
        ...branching,
        enabled: remainingRules.length > 0,
        rules: remainingRules,
      });
      return;
    }

    const targetQuestionId =
      nextMode === 'page'
        ? sectionTargets[0]?.targetQuestionId ?? ''
        : nextMode === 'question'
          ? branchTargets[0]?.id ?? ''
          : '';

    updateBranching({
      ...branching,
      enabled: true,
      rules: [
        ...remainingRules,
        {
          id: currentRule?.id ?? createBranchRuleId(),
          whenOption: optionValue,
          action: nextMode === 'end' ? BRANCH_ACTIONS.END : BRANCH_ACTIONS.GO_TO,
          targetType: nextMode === 'page' ? 'page' : nextMode === 'question' ? 'question' : '',
          targetQuestionId,
        },
      ],
    });
  };

  const setInlineFlowTarget = (optionValue, targetQuestionId) => {
    const currentRule = getBranchRuleForOption(optionValue);

    if (!currentRule) {
      return;
    }

    updateBranching({
      ...branching,
      enabled: true,
      rules: (branching.rules ?? []).map((rule) =>
        rule.whenOption === optionValue
          ? {
              ...rule,
              targetType: rule.targetType || 'question',
              targetQuestionId,
            }
          : rule,
      ),
    });
  };

  const updateBranchRule = (ruleId, key, value) => {
    updateBranching({
      ...branching,
      enabled: true,
      rules: (branching.rules ?? []).map((rule) => {
        if (rule.id !== ruleId) {
          return rule;
        }

        const nextRule = {
          ...rule,
          [key]: value,
        };

        if (key === 'action' && value !== BRANCH_ACTIONS.GO_TO) {
          nextRule.targetQuestionId = '';
        }

        return nextRule;
      }),
    });
  };

  const removeBranchRule = (ruleId) => {
    updateBranching({
      ...branching,
      rules: (branching.rules ?? []).filter((rule) => rule.id !== ruleId),
    });
  };

  return (
    <div className={`question-card ${nonResponseType ? 'question-card-nonresponse' : ''}`}>
      <div className="question-card-header">
        <strong>{displayLabel || (nonResponseType ? '안내 블록' : `질문 ${index + 1}`)}</strong>
        <div className="mini-actions">
          <button className="secondary-button" onClick={() => setShowDetails((current) => !current)} type="button">
            {showDetails ? '세부 설정 닫기' : '세부 설정'}
          </button>
          <button className="secondary-button" onClick={onDuplicate} type="button">
            복제
          </button>
          <button className="secondary-button" disabled={isFirst} onClick={onMoveUp} type="button">
            위로
          </button>
          <button className="secondary-button" disabled={isLast} onClick={onMoveDown} type="button">
            아래로
          </button>
          <button className="text-button danger-text" onClick={onRemove} type="button">
            삭제
          </button>
        </div>
      </div>

      <label className="field">
        <span>
          {simplifiedConsentBlock
            ? '동의 제목'
            : nonResponseType
              ? '블록 제목'
              : '질문 제목'}
        </span>
        <input
          type="text"
          value={question.title}
          onChange={(event) => onChange({ ...question, title: event.target.value })}
          placeholder={
            question.type === QUESTION_TYPES.CONSENT_CHECKBOX
              ? '예: 개인정보 수집 및 이용에 동의합니다.'
              : nonResponseType
                ? '예: 신청 전 확인사항'
                : '예: 프로그램 만족도는 어떠셨나요?'
          }
        />
      </label>

      {!simplifiedConsentBlock && (
        <>
          {showDescriptionInput ? (
            <label className="field">
              <span>질문 설명</span>
              <input
                type="text"
                value={question.description}
                onChange={(event) => onChange({ ...question, description: event.target.value })}
                placeholder="예: 가장 가까운 항목을 선택해주세요."
              />
            </label>
          ) : (
            <button
              className="text-button question-description-trigger"
              onClick={() => setShowDescriptionInput(true)}
              type="button"
            >
              + 설명 추가
            </button>
          )}
        </>
      )}

      {simplifiedConsentBlock && (
        <div className="consent-template-editor">
          <p>필수 항목만 간단히 고치면 바로 사용할 수 있습니다.</p>
          <label className="field">
            <span>수집항목</span>
            <input
              type="text"
              value={question.settings?.collectionItems ?? ''}
              onChange={(event) => updateConsentTemplateField('collectionItems', event.target.value)}
              placeholder="예: 이름, 연락처"
            />
          </label>
          <label className="field">
            <span>이용목적</span>
            <input
              type="text"
              value={question.settings?.usagePurpose ?? ''}
              onChange={(event) => updateConsentTemplateField('usagePurpose', event.target.value)}
              placeholder="예: 신청 접수 및 안내"
            />
          </label>
          <label className="field">
            <span>보관기간</span>
            <input
              type="text"
              value={question.settings?.retentionPeriod ?? ''}
              onChange={(event) => updateConsentTemplateField('retentionPeriod', event.target.value)}
              placeholder="예: 사업 종료 후 파기"
            />
          </label>
        </div>
      )}

      {!simplifiedConsentBlock && (
        <label className="field">
          <span>응답 형식</span>
          <select value={question.type} onChange={(event) => handleTypeChange(event.target.value)}>
            <option value={QUESTION_TYPES.SHORT_TEXT}>단답형</option>
            <option value={QUESTION_TYPES.LONG_TEXT}>장문형</option>
            <option value={QUESTION_TYPES.SINGLE_CHOICE}>객관식</option>
            <option value={QUESTION_TYPES.MULTIPLE_CHOICE}>복수선택</option>
            <option value={QUESTION_TYPES.DROPDOWN}>드롭다운</option>
            <option value={QUESTION_TYPES.PHONE}>전화번호</option>
            <option value={QUESTION_TYPES.EMAIL}>이메일</option>
            <option value={QUESTION_TYPES.NUMBER}>숫자</option>
            <option value={QUESTION_TYPES.DATE}>날짜</option>
            <option value={QUESTION_TYPES.TIME}>시간</option>
            <option value={QUESTION_TYPES.LINEAR_SCALE}>척도형 1~5</option>
            <option value={QUESTION_TYPES.RATING_SCALE}>척도형 1~10</option>
            <option value={QUESTION_TYPES.NPS_SCALE}>추천도 0~10</option>
            <option value={QUESTION_TYPES.APPLICATION_SLOT_CHOICE}>신청 슬롯형</option>
            <option value={QUESTION_TYPES.CONSENT_CHECKBOX}>개인정보 동의</option>
            <option value={QUESTION_TYPES.SECTION_TITLE}>페이지 제목</option>
          </select>
        </label>
      )}

      {!simplifiedConsentBlock && (
        <div className="toggle-grid">
          <label className="checkbox-field">
            <input
              checked={Boolean(question.required) && !nonResponseType}
              disabled={nonResponseType}
              onChange={(event) => onChange({ ...question, required: event.target.checked })}
              type="checkbox"
            />
            <span>필수 응답</span>
          </label>
          {simpleBranchingSupported && (
            <label className="checkbox-field">
              <input
                checked={Boolean(branching.enabled)}
                onChange={(event) => handleBranchToggle(event.target.checked)}
                type="checkbox"
              />
              <span>응답에 따라 다음 화면 다르게 하기</span>
            </label>
          )}
          {showDetails && optionQuotaSupported && !isSlotChoice && (
            <label className="checkbox-field">
              <input
                checked={optionCapacityEnabled}
                onChange={(event) => toggleOptionCapacities(event.target.checked)}
                type="checkbox"
              />
              <span>보기별 정원 사용</span>
            </label>
          )}
        </div>
      )}

      {question.type === QUESTION_TYPES.CONSENT_CHECKBOX && consentSettings && (
        <>
          <div className="consent-template-editor consent-template-summary">
            <strong>개인정보 수집·이용 안내</strong>
            <p>수집항목: {consentSettings.collectionItems}</p>
            <button
              className="text-button question-description-trigger"
              onClick={() => setShowConsentSettings((current) => !current)}
              type="button"
            >
              {showConsentSettings ? '수정 닫기' : '수정하기'}
            </button>
          </div>

          {showConsentSettings && (
            <div className="consent-template-editor">
              <label className="field">
                <span>수집항목</span>
                <input
                  type="text"
                  value={consentSettings.collectionItems}
                  onChange={(event) => updateConsentTemplateField('collectionItems', event.target.value)}
                  placeholder="예: 이름, 연락처, 생년월일 등"
                />
              </label>
              <label className="field">
                <span>이용목적</span>
                <input
                  type="text"
                  value={consentSettings.usagePurpose}
                  onChange={(event) => updateConsentTemplateField('usagePurpose', event.target.value)}
                  placeholder="예: 신청 접수 및 안내"
                />
              </label>
              <label className="field">
                <span>보유기간</span>
                <input
                  type="text"
                  value={consentSettings.retentionPeriod}
                  onChange={(event) => updateConsentTemplateField('retentionPeriod', event.target.value)}
                  placeholder="예: 사업 종료 후 파기"
                />
              </label>
              <label className="field">
                <span>동의 거부 시 안내문</span>
                <textarea
                  rows="3"
                  value={consentSettings.restrictionNotice}
                  onChange={(event) => updateConsentTemplateField('restrictionNotice', event.target.value)}
                  placeholder="예: 동의 거부 시 신청이 제한될 수 있음"
                />
              </label>
            </div>
          )}

          <div className="consent-preview-card">
            <strong>개인정보 수집·이용 안내</strong>
            <div className="consent-preview-lines">
              <p>수집항목: {consentSettings.collectionItems}</p>
              <p>이용목적: {consentSettings.usagePurpose}</p>
              <p>보유기간: {consentSettings.retentionPeriod}</p>
              <p>{consentSettings.restrictionNotice}</p>
            </div>
            <label className="consent-check-item consent-check-item-preview">
              <input disabled type="checkbox" />
              <span>{question.title || '개인정보 수집 및 이용에 동의합니다.'}</span>
            </label>
          </div>
        </>
      )}

      {showDetails && (
        <>
      {sections.length > 1 && (
        <label className="field">
          <span>이 질문이 들어갈 페이지</span>
          <select
            value={question.sectionId ?? sections[0]?.id ?? ''}
            onChange={(event) => onChange({ ...question, sectionId: event.target.value })}
          >
            {sections.map((section) => (
              <option key={section.id} value={section.id}>
                {section.title}
              </option>
            ))}
          </select>
        </label>
      )}

      {scaleQuestion && scaleConfig && (
        <div className="field">
          <div className="builder-header-row option-header-row">
            <span>척도 표시</span>
          </div>

          <div className="scale-preset-grid">
            {[
              {
                label: '1~5점 만족도',
                value: QUESTION_TYPES.LINEAR_SCALE,
                settings: {
                  preset: 'satisfaction5',
                  min: 1,
                  max: 5,
                  minLabel: '전혀 만족하지 않음',
                  maxLabel: '매우 만족',
                },
              },
              {
                label: '1~7점 동의도',
                value: QUESTION_TYPES.RATING_SCALE,
                settings: {
                  preset: 'agreement7',
                  min: 1,
                  max: 7,
                  minLabel: '전혀 그렇지 않다',
                  maxLabel: '매우 그렇다',
                },
              },
              {
                label: '0~10 추천 의향',
                value: QUESTION_TYPES.NPS_SCALE,
                settings: {
                  preset: 'nps10',
                  min: 0,
                  max: 10,
                  minLabel: '전혀 추천하지 않음',
                  maxLabel: '매우 추천함',
                },
              },
            ].map((preset) => (
              <button
                className={`secondary-button ${question.type === preset.value ? 'scale-preset-active' : ''}`}
                key={preset.label}
                onClick={() =>
                  onChange({
                    ...question,
                    type: preset.value,
                    settings: preset.settings,
                  })
                }
                type="button"
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="scale-setting-grid">
            <label className="field">
              <span>최소값</span>
              <input
                min="0"
                type="number"
                value={scaleConfig.min}
                onChange={(event) =>
                  onChange({
                    ...question,
                    settings: {
                      ...scaleConfig,
                      min: event.target.value,
                    },
                  })
                }
              />
            </label>

            <label className="field">
              <span>최대값</span>
              <input
                min="1"
                type="number"
                value={scaleConfig.max}
                onChange={(event) =>
                  onChange({
                    ...question,
                    settings: {
                      ...scaleConfig,
                      max: event.target.value,
                    },
                  })
                }
              />
            </label>
          </div>

          <div className="scale-setting-grid">
            <label className="field">
              <span>최소 라벨</span>
              <input
                type="text"
                value={scaleConfig.minLabel}
                onChange={(event) =>
                  onChange({
                    ...question,
                    settings: {
                      ...scaleConfig,
                      minLabel: event.target.value,
                    },
                  })
                }
                placeholder="예: 전혀 그렇지 않다"
              />
            </label>

            <label className="field">
              <span>최대 라벨</span>
              <input
                type="text"
                value={scaleConfig.maxLabel}
                onChange={(event) =>
                  onChange({
                    ...question,
                    settings: {
                      ...scaleConfig,
                      maxLabel: event.target.value,
                    },
                  })
                }
                placeholder="예: 매우 그렇다"
              />
            </label>
          </div>

          <small>
            공개 화면에서는 {scaleConfig.min}부터 {scaleConfig.max}까지 한 줄로 보입니다.
            {scaleConfig.minLabel || scaleConfig.maxLabel
              ? ` 시작 라벨은 "${scaleConfig.minLabel}", 마지막 라벨은 "${scaleConfig.maxLabel}"로 안내됩니다.`
              : ''}
          </small>
        </div>
      )}

      <div className="toggle-grid">
        {selectableType && !isSlotChoice && (
          <label className="checkbox-field">
            <input
              checked={Boolean(question.allowOther)}
              onChange={(event) =>
                onChange({
                  ...question,
                  allowOther: event.target.checked,
                  branching: syncRulesForOptions(normalizedOptions, event.target.checked),
                })
              }
              type="checkbox"
            />
            <span>기타(직접입력) 허용</span>
          </label>
        )}
      </div>

      {isMultipleChoiceType && (
        <label className="field">
          <span>최대 선택 개수 (비워두면 제한 없음)</span>
          <input
            type="number"
            min="1"
            max={normalizedOptions.length || undefined}
            value={maxSelectionsValue}
            onChange={(event) => {
              const rawValue = event.target.value;
              const nextValidation = { ...(question.validation ?? {}) };

              if (rawValue === '') {
                delete nextValidation.maxSelections;
              } else {
                const parsedValue = Math.max(1, Math.floor(Number(rawValue) || 1));
                nextValidation.maxSelections = parsedValue;
              }

              onChange({
                ...question,
                validation: nextValidation,
              });
            }}
            placeholder="예: 2"
          />
          <small>
            응답자는 이 문항에서 최대 개수를 초과해 선택할 수 없습니다. 예: 2를 입력하면
            "2개까지 선택"처럼 안내 문구를 적어도 실제로 3개 이상은 선택되지 않습니다.
          </small>
        </label>
      )}

        </>
      )}

      {isSlotChoice && !showDetails && (
        <div className="inline-note">
          슬롯 정보는 <strong>세부 설정</strong>에서 입력할 수 있습니다.
          {slotRows.length > 0 ? ` 현재 ${slotRows.length}개의 슬롯이 등록되어 있습니다.` : ''}
        </div>
      )}

      {isSlotChoice && showDetails && (
        <div className="field">
          <div className="builder-header-row option-header-row">
            <span>신청 슬롯</span>
            <button className="secondary-button" onClick={addSlotRow} type="button">
              슬롯 추가
            </button>
          </div>

          <div className="slot-row-list">
            {slotRows.map((slot, slotIndex) => (
              <div className="slot-row-card" key={`slot-row-${slot.key}-${slotIndex}`}>
                <div className="builder-header-row option-header-row">
                  <strong>슬롯 {slotIndex + 1}</strong>
                  <div className="mini-actions">
                    <button
                      className="secondary-button"
                      disabled={slotIndex === 0}
                      onClick={() => moveSlotRow(slotIndex, 'up')}
                      type="button"
                    >
                      위로
                    </button>
                    <button
                      className="secondary-button"
                      disabled={slotIndex === slotRows.length - 1}
                      onClick={() => moveSlotRow(slotIndex, 'down')}
                      type="button"
                    >
                      아래로
                    </button>
                    <button
                      className="text-button danger-text"
                      onClick={() => removeSlotRow(slotIndex)}
                      type="button"
                    >
                      삭제
                    </button>
                  </div>
                </div>

                <div className="slot-field-grid">
                  <div className="consent-field">
                    <strong>보이는 이름</strong>
                    <small>{buildSlotDisplayTitle(slot, slotIndex)}</small>
                  </div>

                  <label className="field">
                    <span>날짜</span>
                    <input
                      type="date"
                      value={slot.date}
                      onChange={(event) => updateSlotRow(slotIndex, 'date', event.target.value)}
                    />
                  </label>

                  <label className="field">
                    <span>시간</span>
                    <input
                      type="text"
                      value={slot.time}
                      onChange={(event) => updateSlotRow(slotIndex, 'time', event.target.value)}
                      placeholder="예: 10:00~10:45"
                    />
                  </label>

                  <label className="field">
                    <span>장소</span>
                    <input
                      type="text"
                      value={slot.place}
                      onChange={(event) => updateSlotRow(slotIndex, 'place', event.target.value)}
                      placeholder="예: 4층 프로그램실"
                    />
                  </label>

                  <label className="field">
                    <span>대상 연령</span>
                    <input
                      type="text"
                      value={slot.ageGroup}
                      onChange={(event) => updateSlotRow(slotIndex, 'ageGroup', event.target.value)}
                      placeholder="예: 3세~5세"
                    />
                  </label>

                  <label className="field">
                    <span>정원</span>
                    <input
                      type="number"
                      min="1"
                      value={slot.capacity}
                      onChange={(event) => updateSlotRow(slotIndex, 'capacity', event.target.value)}
                      placeholder="예: 10"
                    />
                  </label>
                </div>

                <div className="inline-note">
                  현재 {slot.currentCount}명
                  {slot.capacity ? ` / 총 ${slot.capacity}명` : ''}
                  {slot.remainingCount !== null ? ` / 잔여 ${slot.remainingCount}명` : ''}
                  {slot.isClosed ? ' / 마감' : ''}
                </div>
              </div>
            ))}
          </div>

          <small>
            신청 슬롯형은 참여 신청형에서 회차, 반, 연령대 같은 접수 자리를 카드형으로 보여줄 때
            사용합니다.
          </small>
        </div>
      )}

      {selectableType && !isSlotChoice && (
        <div className="field">
          <div className="builder-header-row option-header-row">
            <span>보기</span>
            <button className="secondary-button" onClick={addOption} type="button">
              보기 추가
            </button>
          </div>

          <div className="option-list">
            {normalizedOptions.map((option, optionIndex) => (
              <div className="option-row" key={`question-${index}-option-${optionIndex}`}>
                <input
                  type="text"
                  value={option}
                  onChange={(event) => {
                    const nextLabel = event.target.value;
                    const nextOptions = normalizedOptions.map((item, currentIndex) =>
                      currentIndex === optionIndex ? nextLabel : item,
                    );
                    const currentOptionSetting = question.optionSettings?.[option];
                    const nextOptionSettings = Object.entries(question.optionSettings ?? {}).reduce(
                      (result, [settingKey, settingValue]) => {
                        if (settingKey === option) {
                          if (nextLabel.trim()) {
                            result[nextLabel.trim()] = settingValue;
                          }
                          return result;
                        }

                        result[settingKey] = settingValue;
                        return result;
                      },
                      {},
                    );
                    onChange({
                      ...question,
                      options: nextOptions,
                      optionSettings: nextLabel.trim()
                        ? {
                            ...nextOptionSettings,
                            ...(currentOptionSetting && !nextOptionSettings[nextLabel.trim()]
                              ? { [nextLabel.trim()]: currentOptionSetting }
                              : {}),
                          }
                        : nextOptionSettings,
                      branching: syncRulesForOptions(nextOptions),
                    });
                  }}
                  placeholder={`선택지 ${optionIndex + 1}`}
                />
                {showDetails && optionQuotaSupported && optionCapacityEnabled && (
                  <input
                    type="number"
                    min="1"
                    value={question.optionSettings?.[option]?.capacity ?? ''}
                    onChange={(event) => {
                      const nextCapacity = event.target.value;
                      const nextOptionSettings = {
                        ...(question.optionSettings ?? {}),
                      };

                      if (nextCapacity === '') {
                        delete nextOptionSettings[option];
                      } else {
                        nextOptionSettings[option] = {
                          capacity: nextCapacity,
                        };
                      }

                      onChange({
                        ...question,
                        optionSettings: nextOptionSettings,
                      });
                    }}
                    placeholder="정원"
                  />
                )}
                {simpleBranchingSupported && branching.enabled && (
                  <>
                    <select
                      className="option-flow-select"
                      value={getInlineFlowMode(option)}
                      onChange={(event) => setInlineFlowRule(option, event.target.value)}
                    >
                      <option value="default">다음 질문</option>
                      <option value="question">특정 질문으로 이동</option>
                      <option value="page" disabled={sectionTargets.length === 0}>
                        다음 페이지
                      </option>
                      <option value="end">여기서 종료</option>
                    </select>
                    {getInlineFlowMode(option) === 'question' && (
                    <select
                      className="option-flow-target"
                      value={getBranchRuleForOption(option)?.targetQuestionId ?? ''}
                      onChange={(event) => setInlineFlowTarget(option, event.target.value)}
                      title={
                        branchTargets.find(
                          (target) => target.id === (getBranchRuleForOption(option)?.targetQuestionId ?? ''),
                        )?.label ?? ''
                      }
                    >
                        <option value="">질문 선택</option>
                        {branchTargets.map((target) => (
                          <option key={`${option}-${target.id}`} title={target.label} value={target.id}>
                            {target.label}
                          </option>
                        ))}
                      </select>
                    )}
                    {getInlineFlowMode(option) === 'page' && (
                      <select
                        className="option-flow-target"
                        value={
                          sectionTargets.find(
                            (target) =>
                              target.targetQuestionId ===
                              (getBranchRuleForOption(option)?.targetQuestionId ?? ''),
                          )?.sectionId ?? ''
                        }
                        onChange={(event) => {
                          const matchedSection = sectionTargets.find(
                            (target) => target.sectionId === event.target.value,
                          );

                          if (matchedSection) {
                            setInlineFlowTarget(option, matchedSection.targetQuestionId);
                          }
                        }}
                      >
                        <option value="">페이지 선택</option>
                        {sectionTargets.map((target) => (
                          <option key={`${option}-${target.sectionId}`} value={target.sectionId}>
                            {target.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </>
                )}
                <button
                  className="text-button danger-text"
                  onClick={() => {
                    const nextOptions = normalizedOptions.filter(
                      (_, currentIndex) => currentIndex !== optionIndex,
                    );
                    const nextOptionSettings = {
                      ...(question.optionSettings ?? {}),
                    };
                    delete nextOptionSettings[option];
                    onChange({
                      ...question,
                      options: nextOptions,
                      optionSettings: nextOptionSettings,
                      branching: syncRulesForOptions(nextOptions),
                    });
                  }}
                  type="button"
                >
                  삭제
                </button>
              </div>
            ))}
          </div>

          <small>
            저장할 때 빈 보기는 제거되며, 선택형 질문은 보기 2개 이상이 필요합니다.
          </small>

          {showDetails && optionQuotaSupported && optionItems.some((item) => item.capacity) && (
            <div className="option-status-list">
              {optionItems
                .filter((item) => item.capacity)
                .map((item) => (
                  <div className="inline-note" key={`${question.id}-${item.value}-status`}>
                    {item.label}: {item.currentCount}/{item.capacity}
                    {item.isClosed ? ' (마감)' : item.remainingCount !== null ? `, 잔여 ${item.remainingCount}` : ''}
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {question.type === QUESTION_TYPES.CONSENT_CHECKBOX && (
        <div className="inline-note">
          동의 체크는 참여 화면에서 체크박스로 보이며, 필수 응답이면 동의해야 제출할 수 있습니다.
        </div>
      )}

      {nonResponseType && (
        <div className="inline-note">
          이 항목은 응답을 받지 않는 안내용 블록입니다. 참여 화면에는 제목이나 설명만 표시됩니다.
        </div>
      )}
    </div>
  );
}

export default QuestionEditor;
