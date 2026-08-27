import { useState } from 'react';
import { FEEDBACK_MAX_LENGTH, FEEDBACK_TYPES, createFeedback } from '../firebase/feedback';
function FeedbackModal({ isOpen, onClose, user, pathname, onSent }) {
  const [type, setType] = useState('other'); const [content, setContent] = useState(''); const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  if (!isOpen) return null;
  const submit = async (event) => { event.preventDefault(); try { setSaving(true); setError(''); await createFeedback({ type, content, user, pathname }); setContent(''); onClose(); onSent?.(); } catch (e) { setError(e.message || '의견 전송에 실패했습니다.'); } finally { setSaving(false); } };
  return <div className="modal-backdrop" onClick={saving ? undefined : onClose} role="presentation"><form aria-modal="true" aria-labelledby="feedback-modal-title" className="modal-panel" onClick={(e) => e.stopPropagation()} onSubmit={submit} role="dialog"><h2 id="feedback-modal-title">의견 보내기</h2><label className="field">유형<select value={type} onChange={(e) => setType(e.target.value)} disabled={saving}>{Object.entries(FEEDBACK_TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="field">내용<textarea required maxLength={FEEDBACK_MAX_LENGTH} value={content} onChange={(e) => setContent(e.target.value)} disabled={saving} rows="6" /></label><p className="inline-note">주민의 이름, 연락처, 생년월일, 주소, 응답 내용 등 개인정보는 입력하지 마세요.</p>{error && <p className="form-error">{error}</p>}<div className="button-row"><button className="secondary-button" disabled={saving} onClick={onClose} type="button">취소</button><button className="primary-button" disabled={saving} type="submit">{saving ? '보내는 중...' : '보내기'}</button></div></form></div>;
}
export default FeedbackModal;
