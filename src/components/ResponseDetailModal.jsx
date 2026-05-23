import { formatFirestoreDate, formatSurveyAnswer, getOrderedResponseAnswerItems } from '../firebase/surveys';

function ResponseDetailModal({ isOpen, onClose, response, survey }) {
  if (!isOpen || !response) {
    return null;
  }

  const answerItems = getOrderedResponseAnswerItems(survey?.questions ?? [], response.answers ?? []);
  const title = survey?.title ?? response.surveyTitle ?? '응답 상세';

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal-panel response-detail-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="builder-header-row">
          <div>
            <h2>{title}</h2>
            <p className="meta-description">{formatFirestoreDate(response.submittedAt)}</p>
          </div>
          <button className="text-button danger-text" onClick={onClose} type="button">
            닫기
          </button>
        </div>

        <div className="response-answer-list">
          {answerItems.map((answer) => (
            <div className="response-answer-item" key={`${response.id}-${answer.questionId}`}>
              <strong>{answer.questionTitle}</strong>
              {answer.questionDescription && <small>{answer.questionDescription}</small>}
              <p>{formatSurveyAnswer(answer.answer, answer)}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default ResponseDetailModal;
