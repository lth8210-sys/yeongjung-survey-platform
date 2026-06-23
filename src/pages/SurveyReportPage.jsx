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
    .report-controls,
    .report-controls-hint,
    .report-footer,
    .report-generated-at,
    .report-generated-note,
    .report-print-footer,
    .report-print-hint,
    .report-edit-mode-banner,
    .report-save-hint {
      display: none !important;
    }

    body { margin: 0; background: white; }
    .report-wrapper { padding: 0; max-width: none; box-shadow: none; }
    .report-body { line-height: 1.62; }
    .report-cover {
      min-height: calc(297mm - 4.6cm);
      margin: 0;
      border: 0;
      border-radius: 0;
      break-after: page;
      page-break-after: always;
    }
    .report-toc {
      break-after: page;
      page-break-after: always;
      margin: 0;
      padding-top: 0.4cm;
    }
    .report-section {
      break-inside: auto;
      page-break-inside: auto;
      margin-bottom: 24px;
    }
    .report-section-title,
    .report-subsection h3,
    .report-count-table h4,
    h2,
    h3,
    h4 {
      break-after: avoid;
      page-break-after: avoid;
    }
    table { break-inside: auto; page-break-inside: auto; }
    thead { display: table-header-group; }
    tfoot { display: table-footer-group; }
    tr,
    .report-top-low-grid > div,
    .report-count-table,
    .report-table-block,
    .report-edit-block,
    .report-summary-box,
    .report-toc-row,
    .report-freetext-list li {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .report-freetext-group {
      break-inside: auto;
      page-break-inside: auto;
    }
    .report-char-grid,
    .report-top-low-grid {
      display: block;
    }
    .report-char-grid .report-count-table,
    .report-top-low-grid > div {
      margin-bottom: 16px;
    }
  }
  @page { size: A4; margin: 2cm 2.2cm 2cm; }
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

function limitRowsWithEtc(rows, limit = 15) {
  if (!Array.isArray(rows) || rows.length <= limit) {
    return rows ?? [];
  }

  const visibleRows = rows.slice(0, limit);
  const hiddenRows = rows.slice(limit);
  const etcCount = hiddenRows.reduce((sum, row) => sum + (row.count ?? 0), 0);
  const etcPercent = hiddenRows.reduce((sum, row) => sum + (row.percent ?? 0), 0);

  return [
    ...visibleRows,
    {
      label: '기타',
      count: etcCount,
      percent: Math.round(etcPercent * 10) / 10,
    },
  ];
}

function getTopFreeTextCategories(analytics, limit = 3) {
  return (analytics?.freeTextCategories ?? [])
    .filter((category) => category.key !== 'etc')
    .slice(0, limit);
}

function getFreeTextExamplesText(categories) {
  return categories
    .flatMap((category) => category.examples ?? [])
    .join(' ');
}

function buildSpecificFreeTextNeeds(categories) {
  const text = getFreeTextExamplesText(categories).toLowerCase();
  const needs = [];

  if (/아동|어린이|유아|5\s*~\s*7세|가족|부모/.test(text)) {
    needs.push('아동·가족 대상 프로그램 확대');
  }
  if (/주말|토요일|일요일/.test(text)) {
    needs.push('주말 운영 프로그램 개설');
  }
  if (/ai|인공지능/.test(text)) {
    needs.push('AI 관련 교육 개설');
  }
  if (/외국어|영어|중국어|일본어/.test(text)) {
    needs.push('외국어 관련 교육 개설');
  }
  if (/동영상|영상|편집|미디어|유튜브/.test(text)) {
    needs.push('영상·미디어 교육 개설');
  }
  if (/카드리더기|리더기|출입카드|기자재|장비|시설/.test(text)) {
    needs.push('시설 및 기자재 관리 개선');
  }

  return needs;
}

function buildFreeTextFlowSentence(categories) {
  if (!categories.length) {
    return '';
  }

  const labels = categories.map((category) => category.label).join(', ');
  const requestSentences = [];
  const positiveSentences = [];
  const categoryKeys = new Set(categories.map((category) => category.key));
  const specificNeeds = buildSpecificFreeTextNeeds(categories);

  if (categoryKeys.has('new_program_request')) {
    requestSentences.push('신규 프로그램 개설에 대한 요구가 확인되었다');
  }
  if (categoryKeys.has('program_expansion_request')) {
    requestSentences.push('기존 프로그램의 확대 및 다양화 요구가 나타났다');
  }
  if (categoryKeys.has('facility_environment_improvement')) {
    requestSentences.push('시설 및 환경 개선에 대한 의견이 제시되었다');
  }
  if (categoryKeys.has('schedule_improvement')) {
    requestSentences.push('운영 시간과 일정 조정에 대한 의견이 제시되었다');
  }
  if (categoryKeys.has('promotion_participation_request')) {
    requestSentences.push('홍보와 참여 접근성 개선 필요성이 제기되었다');
  }
  if (categoryKeys.has('program_satisfaction') || categoryKeys.has('instructor_satisfaction')) {
    positiveSentences.push('프로그램 운영과 강사에 대한 긍정적 평가도 함께 확인되었다');
  }

  const sentences = [`자유의견에서는 ${labels} 등이 주요 유형으로 나타났다.`];
  requestSentences.forEach((sentence, index) => {
    sentences.push(`${index === 0 ? '특히 ' : '또한 '}${sentence}.`);
  });
  positiveSentences.forEach((sentence) => {
    sentences.push(`한편 ${sentence}.`);
  });
  if (specificNeeds.length) {
    sentences.push(
      `세부적으로는 ${specificNeeds.slice(0, 4).join(', ')} 요구가 반복적으로 확인되었다.`,
    );
  }
  return sentences.join(' ');
}

function generateSummary(analytics, responseCount) {
  const parts = [`본 조사에는 총 ${responseCount}명이 응답하였다.`];

  if (analytics.totalAverage !== null) {
    const average = formatAverage(analytics.totalAverage);
    parts.push(`전체 평균 만족도는 ${average}점으로 나타났다.`);
    if (analytics.totalAverage >= 4) {
      parts.push('전반적으로 프로그램에 대한 만족 수준은 양호하게 확인되었다.');
    } else if (analytics.totalAverage >= 3) {
      parts.push('전반적인 만족도는 보통 이상으로 나타났으며, 세부 영역별 개선 과제를 함께 검토할 필요가 있다.');
    } else {
      parts.push('전반적인 만족도는 상대적으로 낮게 나타나 운영 전반에 대한 개선 검토가 필요하다.');
    }
    const top = analytics.topRows[0];
    const low = analytics.lowRows[0];
    if (top) {
      parts.push(
        `특히 '${top.question.title}' 문항은 ${formatAverage(top.average)}점으로 상대적으로 높게 나타나 해당 영역에 대한 긍정적 평가를 확인할 수 있었다.`,
      );
    }
    if (low && (!top || low.question.id !== top.question.id)) {
      parts.push(
        `반면 '${low.question.title}' 문항은 ${formatAverage(low.average)}점으로 상대적으로 낮게 나타나 향후 운영 개선 시 우선 검토할 필요가 있다.`,
      );
    }
  }

  const { programName, area, usagePeriod } = analytics.groupCounts;
  if (programName.length > 0) {
    const t = programName[0];
    parts.push(`참여 프로그램은 '${t.label}'(${t.count}건, ${t.percent}%)이 가장 높은 비중을 보였다.`);
  }
  if (area.length > 0) {
    const t = area[0];
    parts.push(`거주 지역은 '${t.label}'(${t.count}건, ${t.percent}%) 응답 비중이 가장 높았다.`);
  }
  if (usagePeriod.length > 0) {
    const t = usagePeriod[0];
    parts.push(`참여기간은 '${t.label}'(${t.count}건, ${t.percent}%) 응답이 가장 많았다.`);
  }
  const topFreeTextCategories = getTopFreeTextCategories(analytics, 3);
  const freeTextSentence = buildFreeTextFlowSentence(topFreeTextCategories);
  if (freeTextSentence) {
    parts.push(freeTextSentence);
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
  const topFreeTextCategories = getTopFreeTextCategories(analytics, 3);
  const freeTextFlowSentence = buildFreeTextFlowSentence(topFreeTextCategories);

  return {
    overviewText:
      survey?.description ||
      `${survey?.title ?? '해당 설문'}은 총 ${responseCount}건의 응답을 바탕으로 이용자의 경험과 만족도를 확인하기 위해 실시되었다.`,
    respondentProfileText:
      [program ? `프로그램 응답은 '${program.label}'(${program.count}건)이 가장 높은 비중을 보였다.` : '',
        area ? `거주 지역은 '${area.label}'(${area.count}건) 응답이 가장 많았다.` : '',
        usagePeriod ? `참여기간은 '${usagePeriod.label}'(${usagePeriod.count}건) 응답이 가장 많았다.` : '']
        .filter(Boolean)
        .join(' ') || '응답자 특성 항목은 응답 분포를 기준으로 해석할 수 있다.',
    satisfactionAnalysisText:
      analytics?.totalAverage !== null && analytics?.totalAverage !== undefined
        ? `전체 평균 만족도는 ${formatAverage(analytics.totalAverage)}점으로 나타났다.${
            top ? ` 상대적으로 높게 나타난 문항은 '${top.question.title}'(${formatAverage(top.average)}점)이다.` : ''
          }${
            low && (!top || low.question.id !== top.question.id)
              ? ` 상대적으로 낮게 나타난 문항은 '${low.question.title}'(${formatAverage(low.average)}점)이며, 향후 운영 개선 시 우선 검토할 필요가 있다.`
              : ''
          }`
        : '만족도 문항 응답을 기준으로 주요 강점과 개선 지점을 해석한다.',
    openEndedSummaryText:
      textCount > 0
        ? `자유의견은 총 ${textCount}건이 수집되었다.${
            freeTextFlowSentence ? ` ${freeTextFlowSentence}` : ''
          } 원문은 수정하지 않고, 보고서에는 주요 의견 흐름을 요약해 반영하였다.`
        : '수집된 자유의견이 없거나 분석 가능한 주관식 응답이 제한적이다.',
    improvementPlanText:
      [
        low
          ? `'${low.question.title}' 항목을 중심으로 운영 개선 필요사항을 검토하고, 만족도가 높게 나타난 요소는 지속적으로 유지할 필요가 있다.`
          : '조사 결과를 바탕으로 서비스 운영 과정의 강점은 유지하고, 반복적으로 제기되는 불편사항은 개선 과제로 관리할 필요가 있다.',
        topFreeTextCategories.some((category) => category.key === 'facility_environment_improvement')
          ? '시설 및 환경 개선 의견은 안전하고 안정적인 이용 환경 조성을 위한 검토 과제로 관리한다.'
          : '',
        topFreeTextCategories.some((category) => category.key === 'schedule_improvement')
          ? '운영 시간과 일정 관련 의견은 향후 프로그램 편성 시 이용자 접근성을 높이는 관점에서 검토한다.'
          : '',
        topFreeTextCategories.some((category) => category.key === 'new_program_request')
          ? '신규 프로그램 개설 요구는 대상자 특성과 수요를 함께 확인하여 차기 사업 계획 수립 시 참고한다.'
          : '',
      ].filter(Boolean).join(' '),
    finalSummaryText: summary || '분석할 응답 데이터가 없습니다.',
  };
}

function ReportEditableText({ editing, label, value, onChange }) {
  return (
    <div className={`report-edit-block${editing ? ' report-edit-block-active' : ''}`}>
      <div className="report-edit-block-header">
        <h3>{label}</h3>
        {editing && <span>편집 가능</span>}
      </div>
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

function FreeTextCategoryTable({ rows }) {
  if (!rows.length) {
    return (
      <div className="report-empty-note">
        등록된 자유의견이 없습니다.
      </div>
    );
  }

  return (
    <table className="report-table report-freetext-category-table">
      <thead>
        <tr>
          <th>유형</th>
          <th>건수</th>
          <th>대표 의견</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <td>{row.label}</td>
            <td>{row.count}건</td>
            <td>
              {row.examples.length > 0 ? (
                <ul className="report-category-examples">
                  {row.examples.map((example, index) => (
                    <li key={`${row.key}-${index}`}>{example}</li>
                  ))}
                </ul>
              ) : (
                <span className="report-empty-example">-</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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
  const [downloadingDocx, setDownloadingDocx] = useState(false);
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

  useEffect(() => {
    if (!dirty) {
      return undefined;
    }

    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty]);

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
    setStatusMessage('편집 모드입니다. 강조된 보고문 영역만 수정할 수 있습니다.');
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

  const handleEditCancel = () => {
    if (dirty) {
      const shouldCancel = window.confirm('저장하지 않은 변경사항을 버리고 수정을 취소하시겠습니까?');

      if (!shouldCancel) {
        return;
      }
    }

    setReportSections({
      ...(defaultReportSections ?? {}),
      ...(savedReport?.sections ?? {}),
    });
    setEditing(false);
    setDirty(false);
    setStatusMessage('');
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

  const handleDocxDownload = async () => {
    if (!survey || !analytics || !reportSections) {
      return;
    }

    try {
      setDownloadingDocx(true);
      setStatusMessage('Word 문서를 생성하는 중입니다...');
      const { downloadSurveyReportDocx } = await import('../utils/reportDocx');
      await downloadSurveyReportDocx({
        survey,
        reportMeta,
        sections: activeReportSections,
        analytics,
        responseCount: responses.length,
        displayedProgramRows,
        sectionNumbers: {
          characteristics: characteristicsSectionNumber,
          satisfaction: satisfactionSectionNumber,
          freeText: freeTextSectionNumber,
          final: finalSectionNumber,
        },
        tocItems,
      });
      setStatusMessage('Word 문서가 다운로드되었습니다.');
      createAuditLog({
        action: 'report_docx_downloaded',
        surveyId,
        surveyTitle: survey.title ?? '',
        actor: auditActor,
        metadata: {
          reportId: savedReport?.id ?? surveyId,
          surveyId,
          reportTitle: reportMeta.title,
          surveyTitle: survey.title ?? '',
        },
      });
    } catch (downloadError) {
      console.error('[Report] docx download failed', downloadError);
      setStatusMessage('Word 문서 생성에 실패했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setDownloadingDocx(false);
    }
  };

  const handleBackToAdmin = () => {
    if (dirty) {
      const shouldLeave = window.confirm(
        '저장하지 않은 변경사항이 있습니다. 저장하지 않고 관리자 화면으로 이동하시겠습니까?',
      );

      if (!shouldLeave) {
        return;
      }
    }

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
  const scoredAnswerCount = analytics?.scoredRows.reduce((sum, row) => sum + row.count, 0) ?? 0;
  const displayedProgramRows = limitRowsWithEtc(analytics?.groupCounts.programName ?? [], 15);
  const overviewTextValue = activeReportSections.overviewText ?? '';
  const surveyDescriptionValue = String(survey.description ?? '').trim();
  const shouldShowOverviewText =
    editing ||
    !surveyDescriptionValue ||
    (overviewTextValue.trim() && overviewTextValue.trim() !== surveyDescriptionValue);
  const characteristicsSectionNumber = hasCharacteristics ? 2 : null;
  const satisfactionSectionNumber = hasSatisfaction ? (hasCharacteristics ? 3 : 2) : null;
  const freeTextSectionNumber =
    hasFreeText
      ? 2 + [hasCharacteristics, hasSatisfaction].filter(Boolean).length
      : null;
  const finalSectionNumber =
    2 + [hasCharacteristics, hasSatisfaction, hasFreeText].filter(Boolean).length;
  const tocItems = [
    { number: '1', title: '조사 개요' },
    hasCharacteristics && { number: String(characteristicsSectionNumber), title: '응답자 특성' },
    hasSatisfaction && { number: String(satisfactionSectionNumber), title: '만족도 분석' },
    hasFreeText && {
      number: String(freeTextSectionNumber),
      title: '자유의견',
      children: [{ number: `${freeTextSectionNumber}-1`, title: '자유의견 주요 유형' }],
    },
    { number: String(finalSectionNumber), title: '종합 요약 및 개선방향' },
  ].filter(Boolean);

  return (
    <>
      <style>{PRINT_STYLES}</style>
      <div className="report-wrapper">
        <div className="report-controls">
          {editing ? (
            <>
              <button className="secondary-button" disabled={saving} onClick={handleEditCancel} type="button">
                수정 취소
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
                disabled={!dirty || saving}
                onClick={handleSaveAndPrint}
                type="button"
              >
                저장 후 인쇄/PDF
              </button>
            </>
          ) : (
            <>
              <button className="secondary-button" onClick={handleBackToAdmin} type="button">
                관리자 화면으로 돌아가기
              </button>
              <button className="primary-button" onClick={handleEditStart} type="button">
                보고서 수정
              </button>
              <button
                className="secondary-button"
                disabled={downloadingDocx}
                onClick={handleDocxDownload}
                type="button"
              >
                {downloadingDocx ? 'Word 생성 중...' : 'Word 다운로드'}
              </button>
              <button className="secondary-button" onClick={handlePrintClick} type="button">
                인쇄/PDF 저장
              </button>
            </>
          )}
          <span className="report-controls-hint">
            {statusMessage ||
              (editing && !dirty
                ? '수정된 내용이 있을 때 저장할 수 있습니다.'
                : dirty
                  ? '저장하지 않은 변경사항이 있습니다.'
                  : 'PDF 저장 시 브라우저 인쇄 설정에서 머리글과 바닥글을 해제하면 더 깔끔하게 출력됩니다.')}
          </span>
        </div>
        {editing && !dirty && (
          <div className="report-save-hint">
            수정된 내용이 있을 때 저장할 수 있습니다.
          </div>
        )}
        {editing && (
          <div className="report-edit-mode-banner">
            파란색 편집 영역의 보고문만 수정할 수 있습니다. 표, 평균점수, 응답수, 자유의견 원문은 원본 분석값으로 유지됩니다.
          </div>
        )}

        <div className="report-body">
          {/* 표지 */}
          <div className="report-cover">
            <div className="report-cover-inner">
              <div className="report-cover-brand">
                <div className="report-cover-mark">YJ</div>
                <div>
                  <p className="report-cover-org">영중종합사회복지관</p>
                  <p className="report-cover-system">Yeongjung Form Report</p>
                </div>
              </div>
              <p className="report-cover-kicker">결과보고서</p>
              <h1 className="report-main-title">{reportMeta.title}</h1>
              <div className="report-cover-rule" aria-hidden="true" />
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
                  <dt>작성부서</dt>
                  <dd>{reportMeta.department}</dd>
                </div>
                <div>
                  <dt>작성일</dt>
                  <dd>{reportMeta.writtenDate}</dd>
                </div>
              </dl>
              <p className="report-cover-footer">Yeongjung Social Welfare Center</p>
            </div>
          </div>

          <section className="report-toc" aria-label="목차">
            <p className="report-toc-kicker">Table of Contents</p>
            <h2 className="report-toc-title">목차</h2>
            <ol className="report-toc-list">
              {tocItems.map((item) => (
                <li className="report-toc-item" key={item.number}>
                  <div className="report-toc-row">
                    <span className="report-toc-number">{item.number}</span>
                    <span className="report-toc-label">{item.title}</span>
                  </div>
                  {item.children && (
                    <ol className="report-toc-sublist">
                      {item.children.map((child) => (
                        <li className="report-toc-row report-toc-subrow" key={child.number}>
                          <span className="report-toc-number">{child.number}</span>
                          <span className="report-toc-label">{child.title}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </li>
              ))}
            </ol>
          </section>

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
            {shouldShowOverviewText && (
              <ReportEditableText
                editing={editing}
                label="조사 개요 설명문"
                onChange={(value) => updateReportSection('overviewText', value)}
                value={overviewTextValue}
              />
            )}
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
                  rows={displayedProgramRows}
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
                {' '}(응답자 {responses.length}명 기준, 문항 응답 {scoredAnswerCount}건)
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

              <div className="report-table-block report-table-block-flow">
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
              </div>
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
              <div className="report-subsection">
                <h3>{freeTextSectionNumber}-1. 자유의견 주요 유형</h3>
                <FreeTextCategoryTable rows={analytics.freeTextCategories ?? []} />
              </div>
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

          {/* 종합 요약 및 개선방향 */}
          {analytics && (
            <section className="report-section">
              <h2 className="report-section-title">{finalSectionNumber}. 종합 요약 및 개선방향</h2>
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
              <ReportEditableText
                editing={editing}
                label="향후 개선방향"
                onChange={(value) => updateReportSection('improvementPlanText', value)}
                value={activeReportSections.improvementPlanText ?? ''}
              />
            </section>
          )}
        </div>
      </div>
    </>
  );
}
