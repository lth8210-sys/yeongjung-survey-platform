import { useEffect, useMemo, useState } from 'react';
import { fetchAuditLogs, formatFirestoreDate } from '../firebase/surveys';
import { useAuth } from '../contexts/AuthContext';

const AUDIT_LOG_PAGE_SIZE = 30;
const ACTION_OPTIONS = [
  { value: '', label: '전체' },
  { value: 'report_settings_opened', label: '결과보고서 설정 열람' },
  { value: 'report_opened', label: '결과보고서 열람' },
  { value: 'report_edit_started', label: '결과보고서 편집 시작' },
  { value: 'report_saved', label: '결과보고서 저장' },
  { value: 'report_summary_regenerated', label: '결과보고서 자동문 재생성' },
  { value: 'report_docx_downloaded', label: '결과보고서 Word 다운로드' },
  { value: 'report_list_opened', label: '결과보고서 관리 화면 열람' },
  { value: 'report_opened_from_list', label: '목록에서 결과보고서 열람' },
  { value: 'report_word_downloaded_from_list', label: '목록에서 Word 다운로드' },
  { value: 'report_copied', label: '결과보고서 복제' },
  { value: 'report_deleted', label: '결과보고서 삭제 처리' },
  { value: 'report_print_clicked', label: '결과보고서 인쇄/PDF 클릭' },
  { value: 'report_back_clicked', label: '결과보고서 관리자 화면 복귀' },
  { value: 'report_unsaved_print_attempt', label: '결과보고서 저장 전 인쇄 시도' },
  { value: 'response_status_updated', label: '상태 변경' },
  { value: 'response_admin_note_updated', label: '메모 수정' },
  { value: 'response_anonymized', label: '익명화' },
  { value: 'responses_csv_downloaded', label: 'CSV 다운로드' },
];
const ACTION_LABELS = Object.fromEntries(ACTION_OPTIONS.map((option) => [option.value, option.label]));
const METADATA_LABELS = {
  surveyTitle: '설문명',
  reportTitle: '보고서 제목',
  reportPeriod: '조사기간',
  target: '조사대상',
  department: '작성부서',
  sectionKeys: '수정 섹션',
  savedAt: '저장 시각',
  reportId: '보고서 ID',
  copiedReportId: '복사본 보고서 ID',
  openMode: '열기 방식',
  fromStatus: '이전 상태',
  toStatus: '변경 상태',
  downloadType: '다운로드',
  loadedCount: '로드 건수',
  anonymizedQuestionCount: '익명화 문항 수',
};
const DOWNLOAD_TYPE_LABELS = {
  raw: '원본형',
  applicant: '명단형',
  slot: '슬롯형',
};

function formatMetadataValue(key, value) {
  if (key === 'downloadType') {
    return DOWNLOAD_TYPE_LABELS[value] ?? value;
  }

  if (Array.isArray(value)) {
    return value.join(', ');
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return typeof value === 'string' ? value : '';
}

function formatMetadataSummary(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return '-';
  }

  const parts = Object.entries(METADATA_LABELS)
    .map(([key, label]) => {
      const value = formatMetadataValue(key, metadata[key]);
      return value ? `${label}: ${value}` : '';
    })
    .filter(Boolean);

  return parts.length > 0 ? parts.join(' · ') : '-';
}

function getAuditLogErrorMessage(error) {
  if (error?.code === 'failed-precondition') {
    return 'Firestore 인덱스가 필요합니다. audit_logs 인덱스 배포 상태를 확인해주세요.';
  }

  if (error?.code === 'permission-denied') {
    return '감사로그를 조회할 권한이 없습니다. 관리자 권한과 Firestore 규칙을 확인해주세요.';
  }

  return '감사로그를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.';
}

function AdminAuditLogsPage() {
  const { canManageUsers } = useAuth();
  const [logs, setLogs] = useState([]);
  const [lastDoc, setLastDoc] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [surveyIdInput, setSurveyIdInput] = useState('');
  const [surveyIdFilter, setSurveyIdFilter] = useState('');

  const actionLabelMap = useMemo(() => ACTION_LABELS, []);

  const loadAuditLogs = async ({ append = false } = {}) => {
    if (!canManageUsers) {
      return;
    }

    try {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setLastDoc(null);
        setHasMore(false);
      }
      setError('');

      const result = await fetchAuditLogs({
        limitCount: AUDIT_LOG_PAGE_SIZE,
        lastDoc: append ? lastDoc : null,
        action: actionFilter,
        surveyId: surveyIdFilter,
      });

      setLastDoc(result.lastDoc);
      setHasMore(result.hasMore);
      setLogs((current) => (append ? [...current, ...result.logs] : result.logs));
    } catch (loadError) {
      console.error(
        '[AuditLogs] fetch failed',
        loadError?.code,
        loadError?.message,
        loadError,
      );
      setError(getAuditLogErrorMessage(loadError));
    } finally {
      if (append) {
        setLoadingMore(false);
      } else {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    loadAuditLogs();
  }, [actionFilter, surveyIdFilter, canManageUsers]);

  const handleSurveyIdSubmit = (event) => {
    event.preventDefault();
    setSurveyIdFilter(surveyIdInput.trim());
  };

  if (!canManageUsers) {
    return <div className="empty-state">관리자 이상만 감사로그를 확인할 수 있습니다.</div>;
  }

  return (
    <section className="stack-section">
      <div className="section-heading">
        <div>
          <span className="eyebrow">관리자 설정</span>
          <h1>감사로그</h1>
          <p>관리자 주요 활동 기록입니다.</p>
        </div>
      </div>

      <div className="panel response-toolbar">
        <div className="response-toolbar-main">
          <label className="field response-toolbar-filter">
            <span>작업 유형</span>
            <select
              value={actionFilter}
              onChange={(event) => setActionFilter(event.target.value)}
            >
              {ACTION_OPTIONS.map((option) => (
                <option key={option.value || 'all'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <form className="field response-toolbar-search" onSubmit={handleSurveyIdSubmit}>
            <span>설문 ID</span>
            <input
              type="text"
              value={surveyIdInput}
              onChange={(event) => setSurveyIdInput(event.target.value)}
              placeholder="설문 ID로 필터"
            />
          </form>
        </div>

        <div className="card-actions">
          <button className="secondary-button" onClick={handleSurveyIdSubmit} type="button">
            적용
          </button>
          {(actionFilter || surveyIdFilter) && (
            <button
              className="secondary-button"
              onClick={() => {
                setActionFilter('');
                setSurveyIdInput('');
                setSurveyIdFilter('');
              }}
              type="button"
            >
              필터 해제
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="empty-state">감사로그를 불러오는 중입니다.</div>
      ) : error ? (
        <div className="empty-state">{error}</div>
      ) : logs.length === 0 ? (
        <div className="empty-state">조건에 맞는 감사로그가 없습니다.</div>
      ) : (
        <div className="panel">
          <div className="response-table-wrapper">
            <table className="response-table">
              <thead>
                <tr>
                  <th>일시</th>
                  <th>작업 유형</th>
                  <th>설문 ID</th>
                  <th>응답 ID</th>
                  <th>수행자 이메일</th>
                  <th>metadata 요약</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td>{formatFirestoreDate(log.createdAt)}</td>
                    <td>{actionLabelMap[log.action] ?? log.action ?? '-'}</td>
                    <td>{log.surveyId || '-'}</td>
                    <td>{log.responseId || '-'}</td>
                    <td>{log.userEmail || log.actor?.email || '-'}</td>
                    <td>{formatMetadataSummary(log.metadata)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {hasMore && (
        <div className="pagination-bar">
          <button
            className="secondary-button"
            disabled={loadingMore}
            onClick={() => loadAuditLogs({ append: true })}
            type="button"
          >
            {loadingMore ? '불러오는 중...' : '더 보기'}
          </button>
          <span>현재 {logs.length}건 표시 중</span>
        </div>
      )}
    </section>
  );
}

export default AdminAuditLogsPage;
