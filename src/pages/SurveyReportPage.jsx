import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  fetchAllResponsesForSurveyExport,
  fetchSurveyById,
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
  const [survey, setSurvey] = useState(null);
  const [responses, setResponses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMsg, setLoadingMsg] = useState('설문 데이터를 불러오는 중...');
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const surveyData = await fetchSurveyById(surveyId);
        if (!surveyData) {
          setError('설문을 찾을 수 없습니다.');
          return;
        }
        setLoadingMsg('응답 데이터를 불러오는 중...');
        const allResponses = await fetchAllResponsesForSurveyExport(surveyData);
        setSurvey(surveyData);
        setResponses(allResponses);
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
        <button className="secondary-button" onClick={() => window.history.back()} type="button">
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

  return (
    <>
      <style>{PRINT_STYLES}</style>
      <div className="report-wrapper">
        <div className="report-controls">
          <button className="primary-button" onClick={() => window.print()} type="button">
            인쇄 / PDF 저장
          </button>
          <button
            className="secondary-button"
            onClick={() => window.history.back()}
            type="button"
          >
            돌아가기
          </button>
          <span className="report-controls-hint">
            인쇄 설정에서 &apos;배경 그래픽&apos;을 체크하면 더 보기 좋게 출력됩니다.
          </span>
        </div>

        <div className="report-body">
          {/* 표지 */}
          <div className="report-cover">
            <div className="report-cover-inner">
              <p className="report-org-name">영중종합사회복지관</p>
              <h1 className="report-main-title">{survey.title}</h1>
              <p className="report-subtitle">결과보고서</p>
              <p className="report-generated-at">생성일: {generatedAt}</p>
            </div>
          </div>

          {/* 1. 조사 개요 */}
          <section className="report-section">
            <h2 className="report-section-title">1. 조사 개요</h2>
            <table className="report-table report-overview-table">
              <tbody>
                <tr>
                  <th>조사명</th>
                  <td>{survey.title}</td>
                </tr>
                <tr>
                  <th>조사기간</th>
                  <td>{dateRange}</td>
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
          </section>

          {/* 2. 응답자 특성 */}
          {hasCharacteristics && (
            <section className="report-section">
              <h2 className="report-section-title">2. 응답자 특성</h2>
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
              <h2 className="report-section-title">3. 만족도 분석</h2>
              <p className="report-section-lead">
                전체 평균 만족도:{' '}
                <strong>{formatAverage(analytics.totalAverage)}점</strong>
                {' '}(응답 {analytics.scoredRows.reduce((sum, r) => sum + r.count, 0)}건 기준)
              </p>

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
              <h2 className="report-section-title">4. 자유의견</h2>
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

          {/* 5. 종합 요약 */}
          {analytics && (
            <section className="report-section">
              <h2 className="report-section-title">
                {hasFreeText ? '5.' : hasSatisfaction ? '4.' : hasCharacteristics ? '3.' : '2.'}{' '}
                종합 요약
              </h2>
              <div className="report-summary-box">
                <p>{summary || '분석할 응답 데이터가 없습니다.'}</p>
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
