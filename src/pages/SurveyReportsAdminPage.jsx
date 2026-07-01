import { useEffect, useMemo, useRef, useState } from 'react';
import {
  copySurveyReport,
  createAuditLog,
  fetchAllResponsesForSurveyExport,
  fetchManagedSurveyReports,
  fetchSurveyById,
  formatFirestoreDate,
  softDeleteSurveyReport,
} from '../firebase/surveys';
import { useAuth } from '../contexts/AuthContext';
import { buildSurveyAnalytics } from '../utils/surveyAnalytics';
import { logger } from '../utils/logger';

const STATUS_OPTIONS = [
  { value: 'all', label: '전체' },
  { value: 'draft', label: '임시저장' },
  { value: 'final', label: '최종본' },
];

function limitRowsWithEtc(rows, limit = 15) {
  if (!Array.isArray(rows) || rows.length <= limit) return rows ?? [];
  const visibleRows = rows.slice(0, limit);
  const hiddenRows = rows.slice(limit);
  return [
    ...visibleRows,
    {
      label: '기타',
      count: hiddenRows.reduce((sum, row) => sum + (row.count ?? 0), 0),
      percent:
        Math.round(
          hiddenRows.reduce((sum, row) => sum + (row.percent ?? 0), 0) * 10,
        ) / 10,
    },
  ];
}

function getReportMeta(report) {
  return {
    title: report.title || '결과보고서',
    period: report.period || '-',
    target: report.target || '해당 설문 응답자',
    department: report.department || '영중종합사회복지관',
    writtenDate: report.reportDate || '-',
    author: report.author || '',
  };
}

function getReportDocumentStructure(analytics) {
  const hasCharacteristics =
    analytics.groupCounts.area.length > 0 ||
    analytics.groupCounts.programName.length > 0 ||
    analytics.groupCounts.usagePeriod.length > 0;
  const hasSatisfaction = analytics.scoredRows.length > 0;
  const hasFreeText = analytics.textResponses.length > 0;
  const characteristics = hasCharacteristics ? 2 : null;
  const satisfaction = hasSatisfaction ? (hasCharacteristics ? 3 : 2) : null;
  const freeText = hasFreeText
    ? 2 + [hasCharacteristics, hasSatisfaction].filter(Boolean).length
    : null;
  const final = 2 + [hasCharacteristics, hasSatisfaction, hasFreeText].filter(Boolean).length;
  const tocItems = [
    { number: '1', title: '조사 개요' },
    hasCharacteristics && { number: String(characteristics), title: '응답자 특성' },
    hasSatisfaction && { number: String(satisfaction), title: '만족도 분석' },
    hasFreeText && {
      number: String(freeText),
      title: '자유의견',
      children: [{ number: `${freeText}-1`, title: '자유의견 주요 유형' }],
    },
    { number: String(final), title: '종합 요약 및 개선방향' },
  ].filter(Boolean);

  return {
    sectionNumbers: { characteristics, satisfaction, freeText, final },
    tocItems,
  };
}

function getActor(user) {
  return {
    uid: user?.uid ?? '',
    email: user?.email ?? '',
    displayName: user?.displayName ?? '',
  };
}

function getReportUrl(report, print = false) {
  const params = new URLSearchParams({ reportId: report.id });
  if (print) params.set('print', '1');
  return `/admin/surveys/${report.surveyId}/report?${params.toString()}`;
}

export default function SurveyReportsAdminPage() {
  const { user, role } = useAuth();
  const [reports, setReports] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [workingReportId, setWorkingReportId] = useState('');
  const listOpenedLoggedRef = useRef(false);
  const actor = useMemo(() => getActor(user), [user]);

  const loadReports = async () => {
    try {
      setLoading(true);
      setError('');
      const items = await fetchManagedSurveyReports({
        uid: user?.uid ?? '',
        email: user?.email ?? '',
        role,
      });
      setReports(items);
    } catch (loadError) {
      logger.error('[Reports] list load failed', {
        code: loadError?.code,
        message: loadError?.message,
        path: loadError?.firestorePath ?? '',
        role,
        uid: user?.uid,
        email: user?.email,
      });
      setError('결과보고서 목록을 불러오지 못했습니다. 권한과 Firestore 규칙을 확인해주세요.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReports();
  }, [role, user?.email, user?.uid]);

  useEffect(() => {
    if (!user || listOpenedLoggedRef.current) return;
    listOpenedLoggedRef.current = true;
    createAuditLog({
      action: 'report_list_opened',
      surveyId: '',
      actor,
      metadata: {},
    });
  }, [actor, user]);

  const visibleReports = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return reports.filter((report) => {
      const matchesStatus = statusFilter === 'all' || report.status === statusFilter;
      const matchesSearch =
        !normalizedSearch ||
        `${report.title ?? ''} ${report.surveyTitle ?? ''}`
          .toLowerCase()
          .includes(normalizedSearch);
      return matchesStatus && matchesSearch;
    });
  }, [reports, searchTerm, statusFilter]);

  const logListAction = (action, report, metadata = {}) =>
    createAuditLog({
      action,
      surveyId: report.surveyId,
      surveyTitle: report.surveyTitle ?? '',
      actor,
      metadata: {
        reportId: report.id,
        surveyId: report.surveyId,
        reportTitle: report.title ?? '',
        surveyTitle: report.surveyTitle ?? '',
        ...metadata,
      },
    });

  const handleOpen = (report, print = false) => {
    logListAction('report_opened_from_list', report, {
      openMode: print ? 'pdf' : 'edit',
    });
    window.open(getReportUrl(report, print), '_blank', 'noopener,noreferrer');
  };

  const handleWordDownload = async (report) => {
    try {
      setWorkingReportId(report.id);
      setStatusMessage('Word 문서를 생성하는 중입니다...');
      const survey = await fetchSurveyById(report.surveyId);
      if (!survey) throw new Error('원 설문을 찾을 수 없습니다.');
      const responses = await fetchAllResponsesForSurveyExport(survey);
      const analytics = buildSurveyAnalytics(survey, responses);
      const { sectionNumbers, tocItems } = getReportDocumentStructure(analytics);
      const { downloadSurveyReportDocx } = await import('../utils/reportDocx');
      await downloadSurveyReportDocx({
        survey,
        reportMeta: getReportMeta(report),
        sections: report.sections ?? {},
        analytics,
        responseCount: responses.length,
        displayedProgramRows: limitRowsWithEtc(analytics.groupCounts.programName, 15),
        sectionNumbers,
        tocItems,
      });
      setStatusMessage('Word 문서가 다운로드되었습니다.');
      logListAction('report_word_downloaded_from_list', report);
    } catch (downloadError) {
      console.error('[Reports] Word download failed', downloadError);
      setStatusMessage('Word 문서 생성에 실패했습니다.');
    } finally {
      setWorkingReportId('');
    }
  };

  const handleCopy = async (report) => {
    try {
      setWorkingReportId(report.id);
      setStatusMessage('');
      const copied = await copySurveyReport(report.id, actor);
      logListAction('report_copied', report, { copiedReportId: copied.id });
      setStatusMessage('보고서 복사본을 생성했습니다.');
      await loadReports();
    } catch (copyError) {
      console.error('[Reports] copy failed', copyError);
      setStatusMessage('보고서 복제에 실패했습니다.');
    } finally {
      setWorkingReportId('');
    }
  };

  const handleDelete = async (report) => {
    const confirmed = window.confirm(
      `'${report.title}' 보고서를 목록에서 삭제하시겠습니까? 원본 설문과 응답은 삭제되지 않습니다.`,
    );
    if (!confirmed) return;

    try {
      setWorkingReportId(report.id);
      await softDeleteSurveyReport(report.id, actor);
      logListAction('report_deleted', report);
      setReports((current) => current.filter((item) => item.id !== report.id));
      setStatusMessage('보고서를 삭제 처리했습니다.');
    } catch (deleteError) {
      console.error('[Reports] soft delete failed', deleteError);
      setStatusMessage('보고서 삭제 처리에 실패했습니다.');
    } finally {
      setWorkingReportId('');
    }
  };

  return (
    <section className="stack-section">
      <div className="section-heading">
        <div>
          <span className="eyebrow">결과보고서 관리</span>
          <h1>저장된 결과보고서</h1>
          <p>보고서 저장본을 검색하고 Word 또는 PDF로 활용할 수 있습니다.</p>
        </div>
      </div>

      <div className="panel response-toolbar">
        <div className="response-toolbar-main">
          <label className="field response-toolbar-search">
            <span>검색</span>
            <input
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="보고서 제목 또는 설문명"
              type="search"
              value={searchTerm}
            />
          </label>
          <label className="field response-toolbar-filter">
            <span>상태</span>
            <select
              onChange={(event) => setStatusFilter(event.target.value)}
              value={statusFilter}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="meta-description">
          최종 수정일 최신순 · 현재 {visibleReports.length}건
        </p>
        {statusMessage && <p className="report-list-status">{statusMessage}</p>}
      </div>

      {loading ? (
        <div className="empty-state">결과보고서를 불러오는 중입니다.</div>
      ) : error ? (
        <div className="empty-state">{error}</div>
      ) : visibleReports.length === 0 ? (
        <div className="empty-state">조건에 맞는 저장된 결과보고서가 없습니다.</div>
      ) : (
        <div className="panel report-list-panel">
          <div className="response-table-wrapper">
            <table className="response-table report-admin-table">
              <thead>
                <tr>
                  <th>보고서 제목</th>
                  <th>원 설문명</th>
                  <th>응답 수</th>
                  <th>작성자</th>
                  <th>최종 수정일</th>
                  <th>상태</th>
                  <th>작업</th>
                </tr>
              </thead>
              <tbody>
                {visibleReports.map((report) => {
                  const working = workingReportId === report.id;
                  return (
                    <tr key={report.id}>
                      <td>
                        <strong>{report.title || '결과보고서'}</strong>
                      </td>
                      <td>{report.surveyTitle || '-'}</td>
                      <td>{report.responseCount ?? 0}건</td>
                      <td>
                        {report.author ||
                          report.updatedBy?.displayName ||
                          report.createdBy?.displayName ||
                          '-'}
                      </td>
                      <td>{formatFirestoreDate(report.updatedAt)}</td>
                      <td>
                        <span
                          className={
                            report.status === 'final'
                              ? 'status-chip published-chip'
                              : 'status-chip draft-chip'
                          }
                        >
                          {report.status === 'final' ? '최종본' : '임시저장'}
                        </span>
                      </td>
                      <td>
                        <div className="report-row-actions">
                          <button
                            className="secondary-button"
                            disabled={working}
                            onClick={() => handleOpen(report)}
                            type="button"
                          >
                            열기
                          </button>
                          <button
                            className="secondary-button"
                            disabled={working}
                            onClick={() => handleWordDownload(report)}
                            type="button"
                          >
                            Word 다운로드
                          </button>
                          <button
                            className="secondary-button"
                            disabled={working}
                            onClick={() => handleOpen(report, true)}
                            type="button"
                          >
                            PDF 출력
                          </button>
                          <button
                            className="secondary-button"
                            disabled={working}
                            onClick={() => handleCopy(report)}
                            type="button"
                          >
                            복제
                          </button>
                          <button
                            className="danger-button"
                            disabled={working}
                            onClick={() => handleDelete(report)}
                            type="button"
                          >
                            삭제
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
