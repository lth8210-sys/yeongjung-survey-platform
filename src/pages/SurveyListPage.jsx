import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import QrModal from '../components/QrModal';
import { useAuth } from '../contexts/AuthContext';
import {
  changeSurveyStatus,
  createAuditLog,
  deleteSurvey,
  duplicateSurvey,
  fetchManagedSurveys,
  fetchPublishedSurveys,
  fetchResponseCountForSurvey,
  getClosedSurveyMessage,
  getDraftSurveyMessage,
  getFormTypeMeta,
  getFirestoreErrorMessage,
  getQuotaSummary,
  getSurveyStatusMeta,
  hydrateSurveyResponseCounts,
  isDeletedSurvey,
  permanentlyDeleteSurvey,
  normalizeSurveyStatus,
  restoreSurvey,
  SURVEY_STATUSES,
} from '../firebase/surveys';
import {
  createSurveyTemplate,
  SURVEY_TEMPLATE_CATEGORIES,
} from '../firebase/surveyTemplates';
import { logger } from '../utils/logger';

function TemplateSaveModal({ survey, saving, onClose, onSave }) {
  const [name, setName] = useState(survey?.title ?? '');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('기타');

  if (!survey) return null;

  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
      role="presentation"
    >
      <div aria-modal="true" className="template-modal panel" role="dialog">
        <div className="builder-header-row">
          <div>
            <span className="eyebrow">템플릿 저장</span>
            <h2>{survey.title}</h2>
          </div>
          <button className="secondary-button" disabled={saving} onClick={onClose} type="button">
            닫기
          </button>
        </div>
        <p className="inline-note">
          응답과 통계는 제외하고 섹션, 문항, 보기와 운영 설정만 새 템플릿으로 저장합니다.
        </p>
        <label className="field">
          <span>템플릿명</span>
          <input onChange={(event) => setName(event.target.value)} value={name} />
        </label>
        <label className="field">
          <span>설명</span>
          <textarea
            onChange={(event) => setDescription(event.target.value)}
            placeholder="언제 사용하면 좋은 템플릿인지 입력하세요."
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
            {saving ? '저장 중...' : '템플릿 저장'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SurveyListPage() {
  const {
    canAccessAdmin,
    canChangeSurveyStatus,
    canDownloadResponses,
    canEditSurvey,
    canViewSurveyResponses,
    role,
    status,
    profile,
    user,
    firebaseStatusMessage,
    isFirebaseConfigured,
  } = useAuth();
  const [surveys, setSurveys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeSurveyId, setActiveSurveyId] = useState('');
  const [qrTarget, setQrTarget] = useState(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [templateSurvey, setTemplateSurvey] = useState(null);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateMessage, setTemplateMessage] = useState('');

  const loadSurveys = async () => {
    const debugListLoad = import.meta.env.DEV;

    if (debugListLoad) {
      console.group('[SurveyListPage] loadSurveys 진단');
      console.log('사용자 uid:', user?.uid);
      console.log('사용자 email:', user?.email);
      console.log('role:', role, '/ status:', status);
      console.log('profile active flags:', {
        status: profile?.status,
        isActive: profile?.isActive,
        active: profile?.active,
        is_active: profile?.is_active,
      });
      console.log('canAccessAdmin:', canAccessAdmin, '/ showDeleted:', showDeleted);
      console.log('isFirebaseConfigured:', isFirebaseConfigured);
    }

    if (!isFirebaseConfigured) {
      if (debugListLoad) {
        console.warn('Firebase 미설정 → 종료');
        console.groupEnd();
      }
      setError(firebaseStatusMessage || 'Firebase 설정이 필요합니다.');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError('');

      let result;
      if (canAccessAdmin) {
        if (debugListLoad) console.log('경로: fetchManagedSurveys');
        result = await fetchManagedSurveys(
          { uid: user?.uid, email: user?.email ?? '', role },
          { includeDeleted: showDeleted },
        );
      } else {
        if (debugListLoad) console.log('경로: fetchPublishedSurveys (canAccessAdmin=false)');
        result = await fetchPublishedSurveys();
      }

      if (debugListLoad) console.log(`fetchManagedSurveys/fetchPublishedSurveys 반환: ${result.length}건`);
      const hydrated = await hydrateSurveyResponseCounts(result);
      if (debugListLoad) console.log(`hydrateSurveyResponseCounts 후: ${hydrated.length}건`);
      setSurveys(hydrated);
      if (debugListLoad) console.log('setSurveys 완료');
    } catch (loadError) {
      logger.error('설문 목록 조회 실패:', {
        code: loadError?.code,
        message: loadError?.message,
        role,
        uid: user?.uid,
        email: user?.email,
      });
      setError(
        getFirestoreErrorMessage(
          loadError,
          '현재 계정으로 조회 가능한 설문이 없거나 권한이 없습니다.',
        ),
      );
    } finally {
      setLoading(false);
      if (debugListLoad) console.groupEnd();
    }
  };

  useEffect(() => {
    loadSurveys();
  }, [canAccessAdmin, firebaseStatusMessage, isFirebaseConfigured, profile, role, showDeleted, user?.email, user?.uid]);

  const getPublicSurveyUrl = (targetSurveyId) => {
    if (typeof window === 'undefined') {
      return `/surveys/${targetSurveyId}`;
    }

    return `${window.location.origin}/surveys/${targetSurveyId}`;
  };

  const handleDuplicate = async (surveyId) => {
    try {
      setActiveSurveyId(surveyId);
      await duplicateSurvey(surveyId, {
        uid: user?.uid ?? '',
        name: user?.displayName ?? '',
        email: user?.email ?? '',
      });
      await loadSurveys();
    } catch (actionError) {
      setError(actionError.message || '설문 복제에 실패했습니다.');
    } finally {
      setActiveSurveyId('');
    }
  };

  const handleDelete = async (surveyId) => {
    try {
      setActiveSurveyId(surveyId);
      const targetSurvey = surveys.find((survey) => survey.id === surveyId);
      const responseCount = targetSurvey ? await fetchResponseCountForSurvey(targetSurvey) : 0;
      const warningMessage =
        responseCount > 0
          ? `이미 ${responseCount}개의 응답이 있습니다. 정말 삭제하시겠습니까?`
          : '정말 이 설문을 삭제하시겠습니까?';

      if (!window.confirm(warningMessage)) {
        return;
      }

      await deleteSurvey(surveyId, {
        uid: user?.uid ?? '',
        email: user?.email ?? '',
        name: user?.displayName ?? '',
      });
      await loadSurveys();
    } catch (actionError) {
      setError(actionError.message || '설문 삭제에 실패했습니다.');
    } finally {
      setActiveSurveyId('');
    }
  };

  const handleStatusChange = async (surveyId, nextStatus) => {
    try {
      setActiveSurveyId(surveyId);
      setSurveys((current) =>
        current.map((survey) =>
          survey.id === surveyId
            ? { ...survey, status: normalizeSurveyStatus(nextStatus) }
            : survey,
        ),
      );
      await changeSurveyStatus(surveyId, nextStatus);
      await loadSurveys();
    } catch (actionError) {
      setError(actionError.message || '설문 상태 변경에 실패했습니다.');
      await loadSurveys();
    } finally {
      setActiveSurveyId('');
    }
  };

  const handleRestore = async (surveyId) => {
    try {
      setActiveSurveyId(surveyId);
      await restoreSurvey(surveyId);
      await loadSurveys();
    } catch (actionError) {
      setError(actionError.message || '설문 복구에 실패했습니다.');
    } finally {
      setActiveSurveyId('');
    }
  };

  const handlePermanentDelete = async (surveyId) => {
    const targetSurvey = surveys.find((survey) => survey.id === surveyId);
    const responseCount = targetSurvey ? await fetchResponseCountForSurvey(targetSurvey) : 0;
    const confirmMessage =
      responseCount > 0
        ? `응답 ${responseCount}건이 연결되어 있습니다. 영구 삭제하면 설문은 복구할 수 없고 응답 기록만 남습니다. 정말 삭제하시겠습니까?`
        : '영구 삭제하면 설문을 복구할 수 없습니다. 정말 삭제하시겠습니까?';

    if (!window.confirm(confirmMessage)) {
      return;
    }

    try {
      setActiveSurveyId(surveyId);
      await permanentlyDeleteSurvey(surveyId, {
        uid: user?.uid ?? '',
        email: user?.email ?? '',
        name: user?.displayName ?? '',
      });
      await loadSurveys();
    } catch (actionError) {
      setError(actionError.message || '영구 삭제에 실패했습니다.');
    } finally {
      setActiveSurveyId('');
    }
  };

  const handleTemplateSave = async ({ name, description, category }) => {
    if (!templateSurvey) return;

    try {
      setTemplateSaving(true);
      setTemplateMessage('');
      const actor = {
        uid: user?.uid ?? '',
        email: user?.email ?? '',
        displayName: user?.displayName ?? '',
      };
      const created = await createSurveyTemplate({
        name,
        description,
        category,
        survey: templateSurvey,
        sourceSurveyId: templateSurvey.id,
        actor,
      });
      createAuditLog({
        action: 'survey_template_created',
        surveyId: templateSurvey.id,
        surveyTitle: templateSurvey.title ?? '',
        actor,
        metadata: {
          templateId: created.id,
          templateName: name.trim(),
          sourceSurveyId: templateSurvey.id,
        },
      });
      setTemplateSurvey(null);
      setTemplateMessage(`'${name.trim()}' 템플릿을 저장했습니다.`);
    } catch (templateError) {
      console.error('[SurveyTemplates] create failed', templateError);
      setTemplateMessage(templateError.message || '템플릿 저장에 실패했습니다.');
    } finally {
      setTemplateSaving(false);
    }
  };

  if (loading) {
    return <div className="empty-state">설문 목록을 불러오는 중입니다.</div>;
  }

  if (error) {
    return <div className="empty-state">{error}</div>;
  }

  return (
    <section className="stack-section">
      <div className="section-heading">
        <div>
          <span className="eyebrow">설문 목록</span>
          <h1>{canAccessAdmin ? '내부 설문 관리' : '현재 참여 가능한 설문'}</h1>
          <p>
            {canAccessAdmin
              ? '역할에 따라 수정, 복제, 삭제, 상태 변경 버튼이 다르게 표시됩니다.'
              : '게시 중이거나 마감된 설문만 목록에 표시됩니다.'}
          </p>
        </div>
        {canAccessAdmin && (
          <label className="field inline-field">
            <span>목록 보기</span>
            <select
              value={showDeleted ? 'withDeleted' : 'activeOnly'}
              onChange={(event) => setShowDeleted(event.target.value === 'withDeleted')}
            >
              <option value="activeOnly">정상 설문만</option>
              <option value="withDeleted">삭제된 설문 포함</option>
            </select>
          </label>
        )}
      </div>

      {templateMessage && <div className="inline-note">{templateMessage}</div>}

      {surveys.length === 0 ? (
        <div className="empty-state">
          {canAccessAdmin
            ? '내가 만든 설문이 없습니다.'
            : '현재 참여 가능한 설문이 없습니다.'}
        </div>
      ) : (
        <div className="survey-grid">
          {surveys.map((survey) => {
            const normalizedStatus = normalizeSurveyStatus(survey.status);
            const deletedSurvey = isDeletedSurvey(survey);
            const statusMeta = getSurveyStatusMeta(normalizedStatus);
            const formTypeMeta = getFormTypeMeta(survey.formType);
            const quotaSummary = getQuotaSummary(survey);
            const canEditTarget = canEditSurvey(survey);
            const canViewResponsesTarget = canViewSurveyResponses(survey);
            const canChangeStatusTarget = canChangeSurveyStatus(survey);

            return (
              <article className="survey-card" key={survey.id}>
                <span className={statusMeta.className}>{statusMeta.label}</span>
                <h2>{survey.title}</h2>
                <p className="survey-card-description">
                  {survey.description || '설문 설명이 아직 등록되지 않았습니다.'}
                </p>
                <small className="muted-label">폼 유형: {formTypeMeta.label}</small>
                <small>질문 수 {survey.questions?.length ?? 0}개</small>
                <small>
                  응답 {quotaSummary.responseCount}건
                  {quotaSummary.quotaEnabled && quotaSummary.maxResponses
                    ? ` / 최대 ${quotaSummary.maxResponses}건`
                    : ' / 제한 없음'}
                </small>

                <div className="card-actions">
                  {(normalizedStatus !== SURVEY_STATUSES.DRAFT || canEditTarget) && (
                    <Link className="primary-button" to={`/surveys/${survey.id}`}>
                      {normalizedStatus === SURVEY_STATUSES.CLOSED ? '설문 보기' : '설문 참여하기'}
                    </Link>
                  )}

                  {canViewResponsesTarget && !canEditTarget && (
                    <Link className="secondary-button" to={`/admin/surveys/${survey.id}/responses`}>
                      응답 결과
                    </Link>
                  )}

                  {canEditTarget && (
                    <>
                      <Link className="secondary-button" to={`/admin/surveys/${survey.id}/edit`}>
                        수정
                      </Link>
                      <button
                        className="secondary-button"
                        disabled={activeSurveyId === survey.id}
                        onClick={() => handleDuplicate(survey.id)}
                        type="button"
                      >
                        복제
                      </button>
                      {!deletedSurvey && (
                        <button
                          className="secondary-button"
                          disabled={activeSurveyId === survey.id}
                          onClick={() => setTemplateSurvey(survey)}
                          type="button"
                        >
                          템플릿 저장
                        </button>
                      )}
                      {deletedSurvey ? (
                        <>
                          <button
                            className="secondary-button"
                            disabled={activeSurveyId === survey.id}
                            onClick={() => handleRestore(survey.id)}
                            type="button"
                          >
                            복구
                          </button>
                          {role !== 'creator' && (
                            <button
                              className="text-button danger-text"
                              disabled={activeSurveyId === survey.id}
                              onClick={() => handlePermanentDelete(survey.id)}
                              type="button"
                            >
                              영구 삭제
                            </button>
                          )}
                        </>
                      ) : (
                        <button
                          className="secondary-button"
                          disabled={activeSurveyId === survey.id}
                          onClick={() => handleDelete(survey.id)}
                          type="button"
                        >
                          삭제
                        </button>
                      )}
                      {normalizedStatus === SURVEY_STATUSES.DRAFT ? (
                        <Link className="secondary-button" to={`/admin/surveys/${survey.id}/edit`}>
                          수정 계속하기
                        </Link>
                      ) : (
                        canViewResponsesTarget && (
                          <Link className="secondary-button" to={`/admin/surveys/${survey.id}/responses`}>
                            응답 결과
                          </Link>
                        )
                      )}
                      {normalizedStatus !== SURVEY_STATUSES.DRAFT &&
                        normalizedStatus !== SURVEY_STATUSES.DELETED &&
                        canDownloadResponses && (
                        <button
                          className="secondary-button"
                          onClick={() =>
                            setQrTarget({
                              title: survey.title,
                              url: getPublicSurveyUrl(survey.id),
                            })
                          }
                          type="button"
                        >
                          QR 보기
                        </button>
                      )}
                    </>
                  )}
                </div>

                {!deletedSurvey && canChangeStatusTarget && (
                  <label className="field inline-field">
                    <span>상태 변경</span>
                    <select
                      disabled={activeSurveyId === survey.id}
                      value={normalizedStatus}
                      onChange={(event) => handleStatusChange(survey.id, event.target.value)}
                    >
                      <option value={SURVEY_STATUSES.DRAFT}>임시저장</option>
                      <option value={SURVEY_STATUSES.PUBLISHED}>게시중</option>
                      <option value={SURVEY_STATUSES.CLOSED}>마감</option>
                    </select>
                  </label>
                )}

                {normalizedStatus === SURVEY_STATUSES.CLOSED && (
                  <div className="inline-note">
                    {getClosedSurveyMessage(survey.formType)}
                    {quotaSummary.quotaEnabled && quotaSummary.maxResponses
                      ? ` 현재 ${quotaSummary.responseCount}/${quotaSummary.maxResponses}건이며 공개 페이지에서는 제출할 수 없습니다.`
                      : ' 공개 페이지에서는 안내만 보이고 제출은 할 수 없습니다.'}
                  </div>
                )}

                {normalizedStatus === SURVEY_STATUSES.DRAFT && canAccessAdmin && (
                  <div className="inline-note">
                    임시저장 상태입니다. {getDraftSurveyMessage(survey.formType)} 수정 후 게시중으로 바꾸면 공개 링크로 진행할 수 있습니다.
                  </div>
                )}

                {deletedSurvey && (
                  <div className="inline-note">
                    삭제된 설문입니다. 응답 기록은 유지되며, 필요하면 복구해서 다시 관리할 수 있습니다.
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      <QrModal
        isOpen={Boolean(qrTarget)}
        onClose={() => setQrTarget(null)}
        title={qrTarget ? `${qrTarget.title} QR` : ''}
        url={qrTarget?.url ?? ''}
      />
      <TemplateSaveModal
        onClose={() => setTemplateSurvey(null)}
        onSave={handleTemplateSave}
        saving={templateSaving}
        survey={templateSurvey}
      />
    </section>
  );
}

export default SurveyListPage;
