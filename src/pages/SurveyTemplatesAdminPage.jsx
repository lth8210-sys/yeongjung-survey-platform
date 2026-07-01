import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { createAuditLog, formatFirestoreDate } from '../firebase/surveys';
import {
  copySurveyTemplate,
  disableSurveyTemplate,
  fetchSurveyTemplates,
  SURVEY_TEMPLATE_CATEGORIES,
  updateSurveyTemplate,
} from '../firebase/surveyTemplates';
import { logger } from '../utils/logger';

function getActor(user) {
  return {
    uid: user?.uid ?? '',
    email: user?.email ?? '',
    displayName: user?.displayName ?? '',
  };
}

function TemplateEditModal({ template, saving, onClose, onSave }) {
  const [name, setName] = useState(template?.name ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [category, setCategory] = useState(template?.category ?? '기타');

  if (!template) return null;

  return (
    <div className="modal-backdrop" role="presentation">
      <div aria-modal="true" className="template-modal panel" role="dialog">
        <div className="builder-header-row">
          <div>
            <span className="eyebrow">템플릿 수정</span>
            <h2>{template.name}</h2>
          </div>
          <button className="secondary-button" disabled={saving} onClick={onClose} type="button">
            닫기
          </button>
        </div>
        <label className="field">
          <span>템플릿명</span>
          <input onChange={(event) => setName(event.target.value)} value={name} />
        </label>
        <label className="field">
          <span>설명</span>
          <textarea
            onChange={(event) => setDescription(event.target.value)}
            rows="4"
            value={description}
          />
        </label>
        <label className="field">
          <span>분류</span>
          <select onChange={(event) => setCategory(event.target.value)} value={category}>
            {SURVEY_TEMPLATE_CATEGORIES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <div className="card-actions template-modal-actions">
          <button className="secondary-button" disabled={saving} onClick={onClose} type="button">
            취소
          </button>
          <button
            className="primary-button"
            disabled={saving || !name.trim()}
            onClick={() => onSave({ name, description, category })}
            type="button"
          >
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SurveyTemplatesAdminPage() {
  const navigate = useNavigate();
  const { user, role } = useAuth();
  const [templates, setTemplates] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [workingId, setWorkingId] = useState('');
  const [editingTemplate, setEditingTemplate] = useState(null);
  const listOpenedLoggedRef = useRef(false);
  const canAdministerTemplates = role === 'admin' || role === 'super_admin';
  const actor = useMemo(() => getActor(user), [user]);

  const loadTemplates = async () => {
    try {
      setLoading(true);
      setError('');
      setTemplates(
        await fetchSurveyTemplates({ includeInactive: canAdministerTemplates }),
      );
    } catch (loadError) {
      logger.error('[SurveyTemplates] list load failed', {
        code: loadError?.code,
        message: loadError?.message,
        path: loadError?.firestorePath ?? '',
        role,
        uid: user?.uid,
        email: user?.email,
      });
      setError('설문 템플릿 목록을 불러오지 못했습니다. 권한과 Firestore 규칙을 확인해주세요.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTemplates();
  }, [canAdministerTemplates]);

  useEffect(() => {
    if (!user || listOpenedLoggedRef.current) return;
    listOpenedLoggedRef.current = true;
    createAuditLog({
      action: 'template_list_opened',
      surveyId: '',
      actor,
      metadata: {},
    });
  }, [actor, user]);

  const visibleTemplates = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return templates.filter((template) => {
      const matchesCategory =
        categoryFilter === 'all' || template.category === categoryFilter;
      const matchesSearch =
        !normalizedSearch ||
        `${template.name} ${template.description}`
          .toLowerCase()
          .includes(normalizedSearch);
      return matchesCategory && matchesSearch;
    });
  }, [categoryFilter, searchTerm, templates]);

  const logTemplateAction = (action, template, metadata = {}) =>
    createAuditLog({
      action,
      surveyId: template.sourceSurveyId ?? '',
      actor,
      metadata: {
        templateId: template.id,
        templateName: template.name,
        sourceSurveyId: template.sourceSurveyId ?? '',
        ...metadata,
      },
    });

  const handleUse = (template) => {
    navigate(`/admin/surveys/new?templateId=${encodeURIComponent(template.id)}`);
  };

  const handleCopy = async (template) => {
    try {
      setWorkingId(template.id);
      setMessage('');
      const copied = await copySurveyTemplate(template, actor);
      logTemplateAction('survey_template_copied', template, {
        copiedTemplateId: copied.id,
      });
      setMessage('템플릿 복사본을 생성했습니다.');
      await loadTemplates();
    } catch (copyError) {
      console.error('[SurveyTemplates] copy failed', copyError);
      setMessage(copyError.message || '템플릿 복제에 실패했습니다.');
    } finally {
      setWorkingId('');
    }
  };

  const handleUpdate = async (updates) => {
    if (!editingTemplate) return;

    try {
      setWorkingId(editingTemplate.id);
      await updateSurveyTemplate(editingTemplate.id, updates, actor);
      logTemplateAction('survey_template_updated', editingTemplate, {
        templateName: updates.name,
      });
      setEditingTemplate(null);
      setMessage('템플릿 정보를 수정했습니다.');
      await loadTemplates();
    } catch (updateError) {
      console.error('[SurveyTemplates] update failed', updateError);
      setMessage(updateError.message || '템플릿 수정에 실패했습니다.');
    } finally {
      setWorkingId('');
    }
  };

  const handleDisable = async (template) => {
    if (!window.confirm(`'${template.name}' 템플릿을 비활성화하시겠습니까?`)) return;

    try {
      setWorkingId(template.id);
      await disableSurveyTemplate(template.id, actor);
      logTemplateAction('survey_template_disabled', template);
      setMessage('템플릿을 비활성화했습니다.');
      await loadTemplates();
    } catch (disableError) {
      console.error('[SurveyTemplates] disable failed', disableError);
      setMessage(disableError.message || '템플릿 비활성화에 실패했습니다.');
    } finally {
      setWorkingId('');
    }
  };

  return (
    <section className="stack-section">
      <div className="section-heading">
        <div>
          <span className="eyebrow">설문 템플릿 관리</span>
          <h1>재사용 가능한 설문 구조</h1>
          <p>응답 데이터 없이 섹션, 문항, 보기와 운영 설정만 보관합니다.</p>
        </div>
      </div>

      <div className="panel response-toolbar">
        <div className="response-toolbar-main">
          <label className="field response-toolbar-search">
            <span>검색</span>
            <input
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="템플릿명 또는 설명"
              type="search"
              value={searchTerm}
            />
          </label>
          <label className="field response-toolbar-filter">
            <span>분류</span>
            <select
              onChange={(event) => setCategoryFilter(event.target.value)}
              value={categoryFilter}
            >
              <option value="all">전체</option>
              {SURVEY_TEMPLATE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="meta-description">최종 수정일 최신순 · 현재 {visibleTemplates.length}건</p>
        {message && <p className="report-list-status">{message}</p>}
      </div>

      {loading ? (
        <div className="empty-state">설문 템플릿을 불러오는 중입니다.</div>
      ) : error ? (
        <div className="empty-state">{error}</div>
      ) : visibleTemplates.length === 0 ? (
        <div className="empty-state">조건에 맞는 설문 템플릿이 없습니다.</div>
      ) : (
        <div className="panel">
          <div className="response-table-wrapper">
            <table className="response-table template-admin-table">
              <thead>
                <tr>
                  <th>템플릿명</th>
                  <th>분류</th>
                  <th>사용횟수</th>
                  <th>생성일</th>
                  <th>수정일</th>
                  <th>상태</th>
                  <th>작업</th>
                </tr>
              </thead>
              <tbody>
                {visibleTemplates.map((template) => (
                  <tr key={template.id}>
                    <td>
                      <strong>{template.name}</strong>
                      <small className="template-table-description">
                        {template.description || '설명이 없습니다.'}
                      </small>
                    </td>
                    <td>
                      <span className="template-badge">{template.category}</span>
                    </td>
                    <td>{template.usageCount}회</td>
                    <td>{formatFirestoreDate(template.createdAt)}</td>
                    <td>{formatFirestoreDate(template.updatedAt)}</td>
                    <td>{template.active ? '사용 중' : '비활성'}</td>
                    <td>
                      <div className="card-actions template-row-actions">
                        {template.active && (
                          <button
                            className="primary-button"
                            onClick={() => handleUse(template)}
                            type="button"
                          >
                            사용하기
                          </button>
                        )}
                        {canAdministerTemplates && (
                          <button
                            className="secondary-button"
                            disabled={workingId === template.id}
                            onClick={() => setEditingTemplate(template)}
                            type="button"
                          >
                            수정
                          </button>
                        )}
                        {template.active && (
                          <button
                            className="secondary-button"
                            disabled={workingId === template.id}
                            onClick={() => handleCopy(template)}
                            type="button"
                          >
                            복제
                          </button>
                        )}
                        {canAdministerTemplates && template.active && (
                          <button
                            className="text-button danger-text"
                            disabled={workingId === template.id}
                            onClick={() => handleDisable(template)}
                            type="button"
                          >
                            비활성화
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <TemplateEditModal
        onClose={() => setEditingTemplate(null)}
        onSave={handleUpdate}
        saving={Boolean(editingTemplate && workingId === editingTemplate.id)}
        template={editingTemplate}
      />
    </section>
  );
}
