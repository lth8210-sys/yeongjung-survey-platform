import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  createAuditLog,
  fetchAllResponsesForSurveyExport,
  fetchSurveyReport,
  fetchSurveyById,
  saveSurveyReport,
} from '../firebase/surveys';
import { buildSurveyAnalytics, formatAverage } from '../utils/surveyAnalytics';

const PRINT_STYLES = `
  @media print {
    .report-controls { display: none !important; }
    body { margin: 0; background: white; }
    .report-wrapper { padding: 0; max-width: none; box-shadow: none; }
    .report-section { page-break-inside: avoid; margin-bottom: 24px; }
    .report-cover { page-break-after: always; }
    h2 { page-break-after: avoid; }
    h3 { page-break-after: avoid; }
    .report-top-low-grid { page-break-inside: avoid; }
  }
  @page { size: A4; margin: 2cm 2.5cm; }
`;

function getDateRange(responses) {
  const timestamps = responses
    .map((r) => r.submittedAt)
    .filter(Boolean)
    .map((ts) => (typeof ts?.toDate === 'function' ? ts.toDate() : new Date(ts)))
    .filter((d) => !isNaN(d.getTime()));
  if (!timestamps.length) return '–';
  const min = new Date(Math.min(...timestamps.map((d) => d.getTime())));
  const max = new Date(Math.max(...timestamps.map((d) => d.getTime())));
  const fmt = (d) =>
    `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  return min.toDateString() === max.toDateString() ? fmt(min) : `${fmt(min)} ~ ${fmt(max)}`;
}

function formatReportDate(value) {
  if (!value) {
    return '';
  }

  const [year, month, day] = String(value).split('-').map(Number);
  const date =
    year && month && day
      ? new Date(year, month - 1, day)
      : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function getReportSettingsFromQuery() {
  if (typeof window === 'undefined') {
    return {};
  }

  const params = new URLSearchParams(window.location.search);
  return {
    title: params.get('title')?.trim() ?? '',
    startDate: params.get('startDate')?.trim() ?? '',
    endDate: params.get('endDate')?.trim() ?? '',
    target: params.get('target')?.trim() ?? '',
    department: params.get('department')?.trim() ?? '',
    writtenDate: params.get('writtenDate')?.trim() ?? '',
    author: params.get('author')?.trim() ?? '',
  };
}

function buildReportMeta({ survey, dateRange, generatedAt, savedReport = null }) {
  if (savedReport) {
    return {
      title: savedReport.title || (survey?.title ? `${survey.title} 결과보고서` : '결과보고서'),
      period: savedReport.period || dateRange,
      periodStart: savedReport.periodStart || '',
      periodEnd: savedReport.periodEnd || '',
      target: savedReport.target || '해당 설문 응답자',
      department: savedReport.department || '영중종합사회복지관',
      writtenDate: formatReportDate(savedReport.reportDate) || savedReport.reportDate || generatedAt,
      reportDate: savedReport.reportDate || '',
      author: savedReport.author || '',
    };
  }

  const querySettings = getReportSettingsFromQuery();
  const queryDateRange =
    querySettings.startDate && querySettings.endDate
      ? querySettings.startDate === querySettings.endDate
        ? formatReportDate(querySettings.startDate)
        : `${formatReportDate(querySettings.startDate)} ~ ${formatReportDate(querySettings.endDate)}`
      : '';

  return {
    title: querySettings.title || (survey?.title ? `${survey.title} 결과보고서` : '결과보고서'),
    period: queryDateRange || dateRange,
    periodStart: querySettings.startDate || '',
    periodEnd: querySettings.endDate || '',
    target: querySettings.target || '해당 설문 응답자',
    department: querySettings.department || '영중종합사회복지관',
    writtenDate: formatReportDate(querySettings.writtenDate) || generatedAt,
    reportDate: querySettings.writtenDate || '',
    author: querySettings.author || '',
  };
}

function getReportAuditMetadata(reportMeta, survey) {
  return {
    surveyTitle: survey?.title ?? '',
    reportTitle: reportMeta?.title ?? '',
    reportPeriod: reportMeta?.period ?? '',
    target: reportMeta?.target ?? '',
    department: reportMeta?.department ?? '',
  };
}

function generateSummary(analytics, responseCount) {
  const parts = [`총 ${responseCount}명이 응답하였습니다.`];

  if (analytics.totalAverage !== null) {
    parts.push(`전체 평균 만족도는 ${formatAverage(analytics.totalAverage)}점입니다.`);
    const top = analytics.topRows[0];
    const low = analytics.lowRows[0];
    if (top) {
      parts.push(
        `만족도가 가장 높은 문항은 '${top.question.title}'(${formatAverage(top.average)}점)입니다.`,
      );
    }
    if (low && (!top || low.question.id !== top.question.id)) {
      parts.push(
        `개선이 필요한 문항은 '${low.question.title}'(${formatAverage(low.average)}점)입니다.`,
      );
    }
  }

  const { programName, area, usagePeriod } = analytics.groupCounts;
  if (programName.length > 0) {
    const t = programName[0];
    parts.push(`참여 프로그램은 '${t.label}'(${t.count}건, ${t.percent}%)이 가장 많았습니다.`);
  }
  if (area.length > 0) {
    const t = area[0];
    parts.push(`거주 지역은 '${t.label}'(${t.count}건, ${t.percent}%)이 가장 많았습니다.`);
  }
  if (usagePeriod.length > 0) {
    const t = usagePeriod[0];
    parts.push(`참여기간은 '${t.label}'(${t.count}건, ${t.percent}%)이 가장 많았습니다.`);
  }

  return parts.join(' ');
}

function buildDefaultReportSections({ survey, analytics, responseCount, summary }) {
  const top = analytics?.topRows?.[0];
  const low = analytics?.lowRows?.[0];
  const program = analytics?.groupCounts?.programName?.[0];
  const area = analytics?.groupCounts?.area?.[0];
  const usagePeriod = analytics?.groupCounts?.usagePeriod?.[0];
  const textCount = analytics?.textResponses?.length ?? 0;

  return {
    overviewText:
      survey?.description ||
      `${survey?.title ?? '해당 설문'}은 총 ${responseCount}건의 응답을 바탕으로 이용자의 경험과 만족도를 확인하기 위해 정리되었습니다.`,
    respondentProfileText:
      [program ? `가장 많은 프로그램 응답은 '${program.label}'(${program.count}건)입니다.` : '',
        area ? `주요 거주 지역은 '${area.label}'(${area.count}건)입니다.` : '',
        usagePeriod ? `가장 많은 참여기간은 '${usagePeriod.label}'(${usagePeriod.count}건)입니다.` : '']
        .filter(Boolean)
        .join(' ') || '응답자 특성 항목은 응답 분포를 기준으로 해석할 수 있습니다.',
    satisfactionAnalysisText:
      analytics?.totalAverage !== null && analytics?.totalAverage !== undefined
        ? `전체 평균 만족도는 ${formatAverage(analytics.totalAverage)}점입니다.${
            top ? ` 가장 높은 문항은 '${top.question.title}'(${formatAverage(top.average)}점)입니다.` : ''
          }${
            low && (!top || low.question.id !== top.question.id)
              ? ` 상대적으로 개선이 필요한 문항은 '${low.question.title}'(${formatAverage(low.average)}점)입니다.`
              : ''
          }`
        : '만족도 문항 응답을 기준으로 주요 강점과 개선 지점을 해석합니다.',
    openEndedSummaryText:
      textCount > 0
        ? `자유의견은 총 ${textCount}건이 수집되었습니다. 원문은 수정하지 않고, 보고서에는 주요 의견 흐름을 요약해 반영합니다.`
        : '수집된 자유의견이 없거나 분석 가능한 주관식 응답이 제한적입니다.',
    improvementPlanText:
      low
        ? `'${low.question.title}' 항목을 중심으로 운영 개선 필요사항을 검토하고, 만족도가 높게 나타난 요소는 지속적으로 유지합니다.`
        : '조사 결과를 바탕으로 서비스 운영 과정의 강점은 유지하고, 반복적으로 제기되는 불편사항은 개선 과제로 관리합니다.',
    finalSummaryText: summary || '분석할 응답 데이터가 없습니다.',
  };
}

function ReportEditableText({ editing, label, value, onChange }) {
  return (
    <div className="report-edit-block">
      <h3>{label}</h3>
      {editing ? (
        <textarea
          className="report-edit-textarea"
          onChange={(event) => onChange(event.target.value)}
          value={value}
        />
      ) : (
        <p>{value || '-'}</p>
      )}
    </div>
  );
}

function CountTable({ title, rows, labelHeader = '항목' }) {
  if (!rows.length) return null;
  return (
    <div className="report-count-table">
      <h4>{title}</h4>
      <table className="report-table">
        <thead>
          <tr>
            <th>{labelHeader}</th>
            <th>응답 수</th>
            <th>비율</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td>{row.count}건</td>
              <td>{row.percent}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SurveyReportPage() {
  const { surveyId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [survey, setSurvey] = useState(null);
  const [responses, setResponses] = useState([]);
  const [savedReport, setSavedReport] = useState(null);
  const [reportSections, setReportSections] = useState(null);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMsg, setLoadingMsg] = useState('설문 데이터를 불러오는 중...');
  const [error, setError] = useState('');
  const reportOpenedLoggedRef = useRef(false);

  useEffect(() => {
    async function load() {
      try {
        const surveyData = await fetchSurveyById(surveyId);
        if (!surveyData) {
          setError('설문을 찾을 수 없습니다.');
          return;
        }
        setLoadingMsg('응답 데이터를 불러오는 중...');
        const [allResponses, reportData] = await Promise.all([
          fetchAllResponsesForSurveyExport(surveyData),
          fetchSurveyReport(surveyId),
        ]);
        setSurvey(surveyData);
        setResponses(allResponses);
        setSavedReport(reportData);
      } catch (e) {
        setError('데이터를 불러오는 중 오류가 발생했습니다.');
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [surveyId]);

  const analytics = useMemo(
    () => (survey ? buildSurveyAnalytics(survey, responses) : null),
    [survey, responses],
  );

  const dateRange = useMemo(() => getDateRange(responses), [responses]);

  const summary = useMemo(
    () => (analytics ? generateSummary(analytics, responses.length) : ''),
    [analytics, responses.length],
  );

  const generatedAt = useMemo(
    () =>
      new Date().toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
    [],
  );

  const reportMeta = useMemo(
    () => buildReportMeta({ survey, dateRange, generatedAt, savedReport }),
    [dateRange, generatedAt, savedReport, survey],
  );

  const defaultReportSections = useMemo(
    () =>
      analytics
        ? buildDefaultReportSections({
            survey,
            analytics,
            responseCount: responses.length,
            summary,
          })
        : null,
    [analytics, responses.length, summary, survey],
  );

  const auditActor = useMemo(
    () => ({
      uid: user?.uid ?? '',
      email: user?.email ?? '',
      displayName: user?.displayName ?? '',
    }),
    [user?.displayName, user?.email, user?.uid],
  );

  useEffect(() => {
    if (!survey || reportOpenedLoggedRef.current) {
      return;
    }

    reportOpenedLoggedRef.current = true;
    createAuditLog({
      action: 'report_opened',
      surveyId,
      surveyTitle: survey.title ?? '',
      actor: auditActor,
      metadata: getReportAuditMetadata(reportMeta, survey),
    });
  }, [auditActor, reportMeta, survey, surveyId]);

  useEffect(() => {
    if (!defaultReportSections || dirty) {
      return;
    }

    setReportSections({
      ...defaultReportSections,
      ...(savedReport?.sections ?? {}),
    });
  }, [defaultReportSections, dirty, savedReport?.sections]);

  const reportSectionKeys = useMemo(
    () => Object.keys(reportSections ?? {}),
    [reportSections],
  );

  const updateReportSection = (key, value) => {
    setReportSections((current) => ({
      ...(current ?? defaultReportSections ?? {}),
      [key]: value,
    }));
    setDirty(true);
    setStatusMessage('');
  };

  const handleEditStart = () => {
    setEditing(true);
    createAuditLog({
      action: 'report_edit_started',
      surveyId,
      surveyTitle: survey?.title ?? '',
      actor: auditActor,
      metadata: {
        ...getReportAuditMetadata(reportMeta, survey),
        sectionKeys: reportSectionKeys,
      },
    });
  };

  const persistReport = async () => {
    if (!survey || !reportSections) {
      return false;
    }

    try {
      setSaving(true);
      setStatusMessage('');
      await saveSurveyReport(
        surveyId,
        {
          title: reportMeta.title,
          periodStart: reportMeta.periodStart,
          periodEnd: reportMeta.periodEnd,
          period: reportMeta.period,
          target: reportMeta.target,
          department: reportMeta.department,
          author: reportMeta.author,
          reportDate: reportMeta.reportDate || reportMeta.writtenDate,
          sections: reportSections,
        },
        auditActor,
      );
      const nextSavedReport = await fetchSurveyReport(surveyId);
      setSavedReport(nextSavedReport);
      setDirty(false);
      setEditing(false);
      setStatusMessage('보고서가 저장되었습니다.');
      createAuditLog({
        action: 'report_saved',
        surveyId,
        surveyTitle: survey.title ?? '',
        actor: auditActor,
        metadata: {
          ...getReportAuditMetadata(reportMeta, survey),
          sectionKeys: reportSectionKeys,
          savedAt: new Date().toISOString(),
        },
      });
      return true;
    } catch (saveError) {
      console.error('[Report] save failed', saveError);
      setStatusMessage('보고서 저장에 실패했습니다. Firestore 권한과 네트워크 상태를 확인해주세요.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const printCurrentReport = () => {
    setEditing(false);
    window.setTimeout(() => window.print(), 0);
  };

  const handlePrintClick = () => {
    if (dirty) {
      createAuditLog({
        action: 'report_unsaved_print_attempt',
        surveyId,
        surveyTitle: survey?.title ?? '',
        actor: auditActor,
        metadata: {
          ...getReportAuditMetadata(reportMeta, survey),
          sectionKeys: reportSectionKeys,
        },
      });
      const shouldPrint = window.confirm(
        '저장하지 않은 변경사항이 있습니다. 저장하지 않고 현재 화면 기준으로 인쇄하시겠습니까?',
      );

      if (!shouldPrint) {
        return;
      }
    }

    if (survey) {
      createAuditLog({
        action: 'report_print_clicked',
        surveyId,
        surveyTitle: survey.title ?? '',
        actor: auditActor,
        metadata: getReportAuditMetadata(reportMeta, survey),
      });
    }

    printCurrentReport();
  };

  const handleSaveAndPrint = async () => {
    const saved = await persistReport();
    if (saved) {
      createAuditLog({
        action: 'report_print_clicked',
        surveyId,
        surveyTitle: survey?.title ?? '',
        actor: auditActor,
        metadata: getReportAuditMetadata(reportMeta, survey),
      });
      printCurrentReport();
    }
  };

  const handleBackToAdmin = () => {
    createAuditLog({
      action: 'report_back_clicked',
      surveyId,
      surveyTitle: survey?.title ?? '',
      actor: auditActor,
      metadata: getReportAuditMetadata(reportMeta, survey),
    });

    window.close();
    window.setTimeout(() => {
      if (!window.closed) {
        navigate(`/admin/surveys/${surveyId}/responses`);
      }
    }, 120);
  };

  if (loading) {
    return (
      <div className="report-loading-screen">
        <p className="report-loading-msg">{loadingMsg}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="report-loading-screen">
        <p>{error}</p>
        <button
          className="secondary-button"
          onClick={() => navigate(`/admin/surveys/${surveyId}/responses`)}
          type="button"
        >
          돌아가기
        </button>
      </div>
    );
  }

  const hasCharacteristics =
    analytics &&
    (analytics.groupCounts.area.length > 0 ||
      analytics.groupCounts.programName.length > 0 ||
      analytics.groupCounts.usagePeriod.length > 0);

  const hasSatisfaction = analytics && analytics.scoredRows.length > 0;
  const hasFreeText = analytics && analytics.textResponses.length > 0;
  const activeReportSections = reportSections ?? defaultReportSections ?? {};
  const characteristicsSectionNumber = hasCharacteristics ? 2 : null;
  const satisfactionSectionNumber = hasSatisfaction ? (hasCharacteristics ? 3 : 2) : null;
  const freeTextSectionNumber =
    hasFreeText
      ? 2 + [hasCharacteristics, hasSatisfaction].filter(Boolean).length
      : null;
  const improvementSectionNumber =
    2 + [hasCharacteristics, hasSatisfaction, hasFreeText].filter(Boolean).length;
  const summarySectionNumber = improvementSectionNumber + 1;

  return (
    <>
      <style>{PRINT_STYLES}</style>
      <div className="report-wrapper">
        <div className="report-controls">
          <button
            className="secondary-button"
            disabled={editing}
            onClick={handleEditStart}
            type="button"
          >
            편집
          </button>
          <button
            className="primary-button"
            disabled={!dirty || saving}
            onClick={persistReport}
            type="button"
          >
            {saving ? '저장 중...' : '저장'}
          </button>
          <button
            className="secondary-button"
            disabled={saving}
            onClick={handleSaveAndPrint}
            type="button"
          >
            저장 후 인쇄/PDF
          </button>
          <button className="secondary-button" onClick={handlePrintClick} type="button">
            인쇄 / PDF 저장
          </button>
          <button className="secondary-button" onClick={handleBackToAdmin} type="button">
            관리자 화면으로 돌아가기
          </button>
          <span className="report-controls-hint">
            {statusMessage || (dirty ? '저장하지 않은 변경사항이 있습니다.' : '인쇄 설정에서 배경 그래픽을 체크하면 더 보기 좋게 출력됩니다.')}
          </span>
        </div>

        <div className="report-body">
          {/* 표지 */}
          <div className="report-cover">
            <div className="report-cover-inner">
              <p className="report-org-name">{reportMeta.department}</p>
              <h1 className="report-main-title">{reportMeta.title}</h1>
              <dl className="report-cover-meta">
                <div>
                  <dt>조사기간</dt>
                  <dd>{reportMeta.period}</dd>
                </div>
                <div>
                  <dt>조사대상</dt>
                  <dd>{reportMeta.target}</dd>
                </div>
                <div>
                  <dt>작성일</dt>
                  <dd>{reportMeta.writtenDate}</dd>
                </div>
              </dl>
            </div>
          </div>

          {/* 1. 조사 개요 */}
          <section className="report-section">
            <h2 className="report-section-title">1. 조사 개요</h2>
            <table className="report-table report-overview-table">
              <tbody>
                <tr>
                  <th>보고서 제목</th>
                  <td>{reportMeta.title}</td>
                </tr>
                <tr>
                  <th>조사기간</th>
                  <td>{reportMeta.period}</td>
                </tr>
                <tr>
                  <th>조사대상</th>
                  <td>{reportMeta.target}</td>
                </tr>
                <tr>
                  <th>작성부서</th>
                  <td>{reportMeta.department}</td>
                </tr>
                <tr>
                  <th>작성일</th>
                  <td>{reportMeta.writtenDate}</td>
                </tr>
                {reportMeta.author && (
                  <tr>
                    <th>작성자</th>
                    <td>{reportMeta.author}</td>
                  </tr>
                )}
                <tr>
                  <th>원 설문명</th>
                  <td>{survey.title}</td>
                </tr>
                <tr>
                  <th>총 응답 수</th>
                  <td>{responses.length}건</td>
                </tr>
                {survey.description && (
                  <tr>
                    <th>조사 설명</th>
                    <td>{survey.description}</td>
                  </tr>
                )}
              </tbody>
            </table>
            <ReportEditableText
              editing={editing}
              label="조사 개요 설명문"
              onChange={(value) => updateReportSection('overviewText', value)}
              value={activeReportSections.overviewText ?? ''}
            />
          </section>

          {/* 2. 응답자 특성 */}
          {hasCharacteristics && (
            <section className="report-section">
              <h2 className="report-section-title">{characteristicsSectionNumber}. 응답자 특성</h2>
              <ReportEditableText
                editing={editing}
                label="응답자 특성 해석문"
                onChange={(value) => updateReportSection('respondentProfileText', value)}
                value={activeReportSections.respondentProfileText ?? ''}
              />
              <div className="report-char-grid">
                <CountTable
                  labelHeader="프로그램명"
                  rows={analytics.groupCounts.programName}
                  title="프로그램별 응답 현황"
                />
                <CountTable
                  labelHeader="지역"
                  rows={analytics.groupCounts.area}
                  title="지역별 응답 현황"
                />
              </div>
              <CountTable
                labelHeader="참여기간"
                rows={analytics.groupCounts.usagePeriod}
                title="참여기간별 응답 현황"
              />
            </section>
          )}

          {/* 3. 만족도 분석 */}
          {hasSatisfaction && (
            <section className="report-section">
              <h2 className="report-section-title">{satisfactionSectionNumber}. 만족도 분석</h2>
              <p className="report-section-lead">
                전체 평균 만족도:{' '}
                <strong>{formatAverage(analytics.totalAverage)}점</strong>
                {' '}(응답 {analytics.scoredRows.reduce((sum, r) => sum + r.count, 0)}건 기준)
              </p>
              <ReportEditableText
                editing={editing}
                label="만족도 분석 해석문"
                onChange={(value) => updateReportSection('satisfactionAnalysisText', value)}
                value={activeReportSections.satisfactionAnalysisText ?? ''}
              />

              <div className="report-top-low-grid">
                <div>
                  <h3>만족도 상위 문항</h3>
                  <table className="report-table">
                    <thead>
                      <tr>
                        <th>문항</th>
                        <th>평균</th>
                        <th>응답 수</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.topRows.map((row) => (
                        <tr key={row.question.id}>
                          <td>{row.question.title}</td>
                          <td>{formatAverage(row.average)}점</td>
                          <td>{row.count}건</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div>
                  <h3>개선 필요 문항</h3>
                  <table className="report-table">
                    <thead>
                      <tr>
                        <th>문항</th>
                        <th>평균</th>
                        <th>응답 수</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.lowRows.map((row) => (
                        <tr key={row.question.id}>
                          <td>{row.question.title}</td>
                          <td>{formatAverage(row.average)}점</td>
                          <td>{row.count}건</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <h3>문항별 상세 분석</h3>
              <table className="report-table report-score-table">
                <thead>
                  <tr>
                    <th>문항</th>
                    <th>평균</th>
                    <th>응답 수</th>
                    <th>점수 분포</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.scoredRows.map((row) => (
                    <tr key={row.question.id}>
                      <td>{row.question.title}</td>
                      <td className="report-score-avg">{formatAverage(row.average)}점</td>
                      <td>{row.count}건</td>
                      <td>
                        <div className="report-dist">
                          {row.distribution.map((item) => (
                            <span className="report-dist-item" key={item.score}>
                              {item.score}점 {item.count}건
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {/* 4. 자유의견 */}
          {hasFreeText && (
            <section className="report-section">
              <h2 className="report-section-title">{freeTextSectionNumber}. 자유의견</h2>
              <ReportEditableText
                editing={editing}
                label="자유의견 해석문"
                onChange={(value) => updateReportSection('openEndedSummaryText', value)}
                value={activeReportSections.openEndedSummaryText ?? ''}
              />
              {(() => {
                const grouped = new Map();
                analytics.textResponses.forEach(({ questionTitle, answer }) => {
                  const list = grouped.get(questionTitle) ?? [];
                  list.push(answer);
                  grouped.set(questionTitle, list);
                });
                return Array.from(grouped.entries()).map(([title, answers]) => (
                  <div className="report-freetext-group" key={title}>
                    <h3>{title}</h3>
                    <ol className="report-freetext-list">
                      {answers.map((answer, i) => (
                        <li key={i}>{answer}</li>
                      ))}
                    </ol>
                  </div>
                ));
              })()}
            </section>
          )}

          {/* 향후 개선방향 */}
          {analytics && (
            <section className="report-section">
              <h2 className="report-section-title">{improvementSectionNumber}. 향후 개선방향</h2>
              <ReportEditableText
                editing={editing}
                label="향후 개선방향"
                onChange={(value) => updateReportSection('improvementPlanText', value)}
                value={activeReportSections.improvementPlanText ?? ''}
              />
            </section>
          )}

          {/* 종합 요약 */}
          {analytics && (
            <section className="report-section">
              <h2 className="report-section-title">{summarySectionNumber}. 종합 요약</h2>
              <div className="report-summary-box">
                {editing ? (
                  <textarea
                    className="report-edit-textarea"
                    onChange={(event) => updateReportSection('finalSummaryText', event.target.value)}
                    value={activeReportSections.finalSummaryText ?? ''}
                  />
                ) : (
                  <p>{activeReportSections.finalSummaryText || '분석할 응답 데이터가 없습니다.'}</p>
                )}
              </div>
            </section>
          )}

          <div className="report-footer">
            <p>
              본 보고서는 영중복지관 영중폼(설문관리 시스템)에서 자동 생성되었습니다. ·
              생성일: {generatedAt}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
