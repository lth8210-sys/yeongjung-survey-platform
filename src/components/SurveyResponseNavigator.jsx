function getSectionStatus(section, index, currentSectionIndex) {
  if (index === currentSectionIndex) {
    return 'current';
  }

  if ((section.unansweredRequiredCount ?? 0) === 0) {
    return 'complete';
  }

  return 'pending';
}

function getStatusLabel(status) {
  if (status === 'current') return '현재';
  if (status === 'complete') return '완료';
  return '미진행';
}

function SurveyResponseNavigator({
  sections = [],
  currentSectionIndex = 0,
  completedQuestionCount = 0,
  totalQuestionCount = 0,
  progressPercent = 0,
  onSectionSelect,
}) {
  if (sections.length === 0) {
    return null;
  }

  const roundedProgress = Math.round(progressPercent);

  return (
    <nav className="survey-response-navigator" aria-label="설문 섹션 이동">
      <div className="survey-response-progress-summary">
        <div>
          <span>전체 진행률</span>
          <strong>{roundedProgress}%</strong>
          <small>
            ({completedQuestionCount} / {totalQuestionCount} 문항 완료)
          </small>
        </div>
        <div className="response-progress-track" aria-hidden="true">
          <div
            className="response-progress-bar"
            style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }}
          />
        </div>
        <p>현재 {Math.min(currentSectionIndex + 1, sections.length)} / {sections.length} Section</p>
      </div>

      <div className="survey-response-section-list">
        {sections.map((section, index) => {
          const status = getSectionStatus(section, index, currentSectionIndex);
          const unansweredRequiredCount = section.unansweredRequiredCount ?? 0;
          const statusText = unansweredRequiredCount === 0 ? '완료' : String(unansweredRequiredCount);

          return (
            <button
              aria-current={status === 'current' ? 'step' : undefined}
              aria-label={`${section.title || `섹션 ${index + 1}`} ${getStatusLabel(status)}, 필수 미응답 ${unansweredRequiredCount}개`}
              className={`survey-response-section-button survey-response-section-${status}`}
              key={`section-nav-${section.id ?? index}`}
              onClick={() => onSectionSelect?.(index)}
              type="button"
            >
              <span className="survey-response-section-dot" aria-hidden="true" />
              <span className="survey-response-section-title">
                {section.title || `섹션 ${index + 1}`}
              </span>
              <span className="survey-response-section-count">
                ({statusText})
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export default SurveyResponseNavigator;
