import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  ADMIN_REPLY_MAX_LENGTH,
  FEEDBACK_STATUSES,
  FEEDBACK_TYPES,
  listAdminFeedback,
  saveFeedbackReply,
  updateFeedbackStatus,
} from '../firebase/feedback';
import { formatFirestoreDate } from '../firebase/surveys';

export default function AdminFeedbackPage() {
  const { user, canManageUsers } = useAuth();
  const [status, setStatus] = useState('');
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [replies, setReplies] = useState({});
  const load = useCallback(() => listAdminFeedback(status).then(setItems).catch((e) => setError(e.message)), [status]);

  useEffect(() => {
    if (canManageUsers) load();
  }, [canManageUsers, load]);

  if (!canManageUsers) return <div className="empty-state">관리자만 의견을 관리할 수 있습니다.</div>;

  const change = async (item, next) => {
    try {
      await updateFeedbackStatus(item.id, item.status, next, user.uid);
      load();
    } catch (e) { setError(e.message); }
  };
  const save = async (item) => {
    try {
      await saveFeedbackReply(item.id, replies[item.id] ?? item.adminReply ?? '', user);
      load();
    } catch (e) { setError(e.message); }
  };

  return <section><h1>의견 관리</h1><label className="field">상태 필터<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">전체</option>{Object.entries(FEEDBACK_STATUSES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>{error && <p className="form-error">{error}</p>}<div className="admin-list">{items.map((item) => <article className="admin-list-item" key={item.id}><strong>{FEEDBACK_TYPES[item.type]} · {FEEDBACK_STATUSES[item.status]}</strong><p>{item.content}</p><small>작성자: {item.createdByName || '이름 없음'} · 등록: {formatFirestoreDate(item.createdAt)}</small><small>{item.pageName}{item.surveyId ? ` · 설문 ${item.surveyId}` : ''}</small>{item.status === 'reviewing' && <><label className="field">관리자 답변 / 처리 내용<textarea maxLength={ADMIN_REPLY_MAX_LENGTH} value={replies[item.id] ?? item.adminReply ?? ''} onChange={(e) => setReplies({ ...replies, [item.id]: e.target.value })} /></label><p className="inline-note">처리 결과를 작성해 주세요. 주민의 이름, 연락처, 생년월일, 설문 응답 원문 등 개인정보는 입력하지 마세요.</p><button className="secondary-button" onClick={() => save(item)} type="button">답변 저장</button></>}{item.adminReply && <><p>관리자 답변: {item.adminReply}</p><small>답변자: {item.repliedByName || '관리자'} · 답변일: {formatFirestoreDate(item.repliedAt)}</small></>}{item.status === 'received' && <button className="secondary-button" onClick={() => change(item, 'reviewing')} type="button">확인 시작</button>}{item.status === 'reviewing' && <button className="secondary-button" disabled={!item.adminReply} onClick={() => change(item, 'completed')} type="button">처리 완료</button>}</article>)}</div></section>;
}
