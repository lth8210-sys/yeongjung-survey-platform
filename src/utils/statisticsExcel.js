import ExcelJS from 'exceljs';
import FileSaver from 'file-saver';
import {
  formatFirestoreDate,
  formatSurveyAnswer,
  getOrderedResponseAnswerItems,
  getResponseStatusMeta,
  isNonResponseQuestionType,
  isScaleQuestionType,
  QUESTION_TYPES,
} from '../firebase/surveys';
import {
  buildSurveyAnalytics,
  generateRuleBasedReportSummary,
} from './surveyAnalytics';
import { sanitizeRow, sanitizeCellValue } from './csvSafeCell';

const COLORS = {
  navy: '173B63',
  blue: '2F5EA5',
  lightBlue: 'E8EEF5',
  lighterBlue: 'F4F7FB',
  gray: '64748B',
  lightGray: 'F2F4F7',
  border: 'CBD5E1',
  white: 'FFFFFF',
  text: '111827',
};
const FONT_NAME = '맑은 고딕';
const SELECTABLE_TYPES = new Set([
  QUESTION_TYPES.SINGLE_CHOICE,
  QUESTION_TYPES.MULTIPLE_CHOICE,
  QUESTION_TYPES.DROPDOWN,
  QUESTION_TYPES.APPLICATION_SLOT_CHOICE,
]);

function toValidDate(value) {
  if (!value) return null;
  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(date) {
  if (!date) return '-';
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function getResponsePeriod(responses) {
  const dates = responses
    .map((response) => toValidDate(response.submittedAt))
    .filter(Boolean)
    .sort((first, second) => first - second);
  if (!dates.length) return '-';
  const start = formatDate(dates[0]);
  const end = formatDate(dates[dates.length - 1]);
  return start === end ? start : `${start} ~ ${end}`;
}

function sanitizeFileName(title) {
  return String(title || '설문')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_');
}

function addTitle(sheet, title, subtitle = '') {
  sheet.mergeCells('A1:F1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = title;
  titleCell.font = { name: FONT_NAME, size: 16, bold: true, color: { argb: COLORS.white } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navy } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
  sheet.getRow(1).height = 28;

  if (subtitle) {
    sheet.mergeCells('A2:F2');
    const subtitleCell = sheet.getCell('A2');
    subtitleCell.value = subtitle;
    subtitleCell.font = { name: FONT_NAME, size: 10, color: { argb: COLORS.gray } };
    subtitleCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    sheet.getRow(2).height = 24;
  }
}

function styleHeaderRow(row) {
  row.eachCell((cell) => {
    cell.font = { name: FONT_NAME, bold: true, color: { argb: COLORS.white } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.blue } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: COLORS.border } },
      bottom: { style: 'thin', color: { argb: COLORS.border } },
      left: { style: 'thin', color: { argb: COLORS.border } },
      right: { style: 'thin', color: { argb: COLORS.border } },
    };
  });
  row.height = 24;
}

function styleBodyRows(sheet, startRow, endRow, numericColumns = []) {
  for (let rowIndex = startRow; rowIndex <= endRow; rowIndex += 1) {
    const row = sheet.getRow(rowIndex);
    row.eachCell((cell, columnNumber) => {
      cell.font = { name: FONT_NAME, size: 10, color: { argb: COLORS.text } };
      cell.alignment = {
        vertical: 'top',
        horizontal: numericColumns.includes(columnNumber) ? 'right' : 'left',
        wrapText: true,
      };
      cell.border = {
        top: { style: 'thin', color: { argb: COLORS.border } },
        bottom: { style: 'thin', color: { argb: COLORS.border } },
        left: { style: 'thin', color: { argb: COLORS.border } },
        right: { style: 'thin', color: { argb: COLORS.border } },
      };
      if (rowIndex % 2 === 0) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.lighterBlue } };
      }
    });
  }
}

function setColumnNumberFormat(sheet, columnNumber, startRow, endRow, numberFormat) {
  for (let rowIndex = startRow; rowIndex <= endRow; rowIndex += 1) {
    sheet.getCell(rowIndex, columnNumber).numFmt = numberFormat;
  }
}

function finalizeSheet(sheet, {
  widths = [],
  freezeRow = 3,
  autoFilterRange = '',
} = {}) {
  sheet.views = [{ state: 'frozen', ySplit: freezeRow, showGridLines: false }];
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  if (autoFilterRange) sheet.autoFilter = autoFilterRange;
  sheet.pageSetup = {
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    paperSize: 9,
    margins: {
      left: 0.3,
      right: 0.3,
      top: 0.5,
      bottom: 0.5,
      header: 0.2,
      footer: 0.2,
    },
  };
}

function getOrderedQuestions(survey, responses) {
  if (survey.questions?.length) {
    return survey.questions.filter((question) => !isNonResponseQuestionType(question.type));
  }
  return responses
    .flatMap((response) => getOrderedResponseAnswerItems([], response.answers))
    .reduce((result, item) => {
      if (!result.some((question) => question.id === item.questionId)) {
        result.push({
          id: item.questionId,
          title: item.questionTitle,
          type: item.questionType,
        });
      }
      return result;
    }, []);
}

function buildRawResponseRows(survey, responses) {
  const questions = getOrderedQuestions(survey, responses);
  const headers = [
    '제출일',
    '응답 ID',
    '처리 상태',
    '관리자 비고',
    ...questions.map((question) => question.title || question.label || question.id),
  ];
  const rows = responses.map((response) => {
    const items = getOrderedResponseAnswerItems(survey.questions ?? [], response.answers);
    const answerMap = new Map(
      items.map((item) => [item.questionId, formatSurveyAnswer(item.answer, item)]),
    );
    return [
      formatFirestoreDate(response.submittedAt),
      response.id,
      getResponseStatusMeta(response.status).label,
      response.adminNote ?? '',
      ...questions.map((question) => answerMap.get(question.id) ?? ''),
    ];
  });
  return { headers, rows, questions };
}

function getRawAnswer(response, questionId) {
  return (response.answers ?? []).find((item) => item.questionId === questionId)?.answer;
}

function getChoiceValues(answer) {
  if (Array.isArray(answer)) {
    return answer.map((value) => String(value ?? '').trim()).filter(Boolean);
  }
  const normalized = String(answer ?? '').trim();
  return normalized ? [normalized] : [];
}

function buildChoiceFrequencyRows(questions, responses) {
  const rows = [];
  questions
    .filter((question) => SELECTABLE_TYPES.has(question.type))
    .forEach((question) => {
      const counts = new Map();
      let respondentCount = 0;
      responses.forEach((response) => {
        const values = getChoiceValues(getRawAnswer(response, question.id));
        if (!values.length) return;
        respondentCount += 1;
        values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
      });
      const configuredOptions = (question.options ?? [])
        .map((option) => String(option?.label ?? option?.value ?? option ?? '').trim())
        .filter(Boolean);
      const options = [...new Set([...configuredOptions, ...counts.keys()])];
      options.forEach((option) => {
        const count = counts.get(option) ?? 0;
        rows.push([
          question.title || question.label || question.id,
          option,
          count,
          respondentCount > 0 ? count / respondentCount : 0,
          respondentCount,
        ]);
      });
    });
  return rows;
}

function getSatisfactionRows(analytics) {
  return analytics.scoredRows.map((row) => {
    const values = row.distribution.flatMap((item) =>
      Array.from({ length: item.count }, () => item.score),
    );
    const average = row.average ?? 0;
    const variance =
      values.length > 0
        ? values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length
        : 0;
    return [
      row.question.title,
      average,
      row.count,
      Math.sqrt(variance),
      values.length ? Math.max(...values) : '',
      values.length ? Math.min(...values) : '',
    ];
  });
}

function addFrequencySection(sheet, startRow, title, rows) {
  sheet.mergeCells(startRow, 1, startRow, 4);
  const titleCell = sheet.getCell(startRow, 1);
  titleCell.value = title;
  titleCell.font = { name: FONT_NAME, bold: true, size: 12, color: { argb: COLORS.navy } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.lightBlue } };
  const headerRow = sheet.getRow(startRow + 1);
  headerRow.values = ['항목', '응답 수', '비율(%)', '비고'];
  styleHeaderRow(headerRow);
  rows.forEach((item, index) => {
    sheet.getRow(startRow + 2 + index).values = [
      item.label,
      item.count,
      item.percent / 100,
      '',
    ];
  });
  const endRow = startRow + 1 + rows.length;
  if (rows.length) {
    styleBodyRows(sheet, startRow + 2, endRow, [2, 3]);
    setColumnNumberFormat(sheet, 3, startRow + 2, endRow, '0.0%');
  }
  return endRow + 2;
}

function createOverviewSheet(workbook, survey, responses, generatedAt) {
  const sheet = workbook.addWorksheet('설문 개요');
  addTitle(sheet, '설문 통계분석 Excel', '영중폼 설문 응답 분석 자료');
  const rows = [
    ['설문명', survey.title ?? ''],
    ['응답 수', responses.length],
    ['응답 기간', getResponsePeriod(responses)],
    ['생성일', formatDate(generatedAt)],
  ];
  sheet.mergeCells('B4:F4');
  sheet.getRow(4).values = ['항목', '내용'];
  styleHeaderRow(sheet.getRow(4));
  rows.forEach((row, index) => {
    const rowNumber = 5 + index;
    sheet.mergeCells(rowNumber, 2, rowNumber, 6);
    sheet.getCell(rowNumber, 1).value = row[0];
    sheet.getCell(rowNumber, 2).value = row[1];
  });
  styleBodyRows(sheet, 5, 8);
  sheet.getCell('B6').numFmt = '0"건"';
  finalizeSheet(sheet, { widths: [20, 18, 18, 18, 18, 18], freezeRow: 4 });
}

function createRawSheet(workbook, survey, responses) {
  const sheet = workbook.addWorksheet('응답 원본');
  const { headers, rows, questions } = buildRawResponseRows(survey, responses);
  addTitle(sheet, '응답 원본', '기존 CSV 다운로드와 동일한 열 순서입니다.');
  sheet.getRow(3).values = headers;
  styleHeaderRow(sheet.getRow(3));
  rows.forEach((row, index) => {
    // 응답자가 입력한 원본 텍스트가 그대로 들어오므로 수식 인젝션 방지 처리 필수
    sheet.getRow(4 + index).values = sanitizeRow(row);
  });
  if (rows.length) styleBodyRows(sheet, 4, 3 + rows.length);
  finalizeSheet(sheet, {
    widths: [20, 24, 14, 24, ...questions.map(() => 28)],
    freezeRow: 3,
    autoFilterRange: `A3:${sheet.getColumn(headers.length).letter}${Math.max(3, 3 + rows.length)}`,
  });
  return questions;
}

function createChoiceSheet(workbook, questions, responses) {
  const sheet = workbook.addWorksheet('객관식 빈도분석');
  addTitle(
    sheet,
    '객관식 빈도분석',
    '다중선택 문항은 한 응답자가 여러 항목을 선택할 수 있어 비율 합계가 100%를 초과할 수 있습니다.',
  );
  const headers = ['문항', '선택지', '응답 수', '비율(%)', '문항 응답자 수'];
  sheet.getRow(3).values = headers;
  styleHeaderRow(sheet.getRow(3));
  const rows = buildChoiceFrequencyRows(questions, responses);
  rows.forEach((row, index) => {
    sheet.getRow(4 + index).values = row;
  });
  if (rows.length) {
    styleBodyRows(sheet, 4, 3 + rows.length, [3, 4, 5]);
    setColumnNumberFormat(sheet, 4, 4, 3 + rows.length, '0.0%');
  }
  finalizeSheet(sheet, {
    widths: [42, 32, 12, 12, 16],
    freezeRow: 3,
    autoFilterRange: `A3:E${Math.max(3, 3 + rows.length)}`,
  });
}

function createSatisfactionSheet(workbook, analytics) {
  const sheet = workbook.addWorksheet('만족도 분석');
  addTitle(sheet, '만족도 분석', '표준편차는 유효 문항 응답 전체를 기준으로 한 모집단 표준편차입니다.');
  const headers = ['문항', '평균', '응답 수', '표준편차', '최고점', '최저점'];
  sheet.getRow(3).values = headers;
  styleHeaderRow(sheet.getRow(3));
  const rows = getSatisfactionRows(analytics);
  rows.forEach((row, index) => {
    sheet.getRow(4 + index).values = row;
  });
  if (rows.length) {
    styleBodyRows(sheet, 4, 3 + rows.length, [2, 3, 4, 5, 6]);
    setColumnNumberFormat(sheet, 2, 4, 3 + rows.length, '0.00');
    setColumnNumberFormat(sheet, 4, 4, 3 + rows.length, '0.00');
  }
  finalizeSheet(sheet, {
    widths: [58, 12, 12, 14, 12, 12],
    freezeRow: 3,
    autoFilterRange: `A3:F${Math.max(3, 3 + rows.length)}`,
  });
}

function createProfileSheet(workbook, analytics) {
  const sheet = workbook.addWorksheet('응답자 특성');
  addTitle(sheet, '응답자 특성', '프로그램명은 보고서 분석과 동일한 정규화 기준으로 집계됩니다.');
  let nextRow = 3;
  nextRow = addFrequencySection(sheet, nextRow, '프로그램별', analytics.groupCounts.programName);
  nextRow = addFrequencySection(sheet, nextRow, '지역별', analytics.groupCounts.area);
  addFrequencySection(sheet, nextRow, '참여기간별', analytics.groupCounts.usagePeriod);
  finalizeSheet(sheet, { widths: [38, 14, 14, 24], freezeRow: 2 });
}

function createFreeTextSheet(workbook, analytics) {
  const sheet = workbook.addWorksheet('자유의견 분석');
  addTitle(
    sheet,
    '자유의견 분석',
    '한 의견은 최대 2개 유형으로 분류되므로 유형별 비율 합계가 100%를 초과할 수 있습니다.',
  );
  const headers = ['유형', '건수', '비율(%)', '분석 결과', '대표 의견'];
  sheet.getRow(3).values = headers;
  styleHeaderRow(sheet.getRow(3));
  const denominator = analytics.textResponses.length;
  const rows = analytics.freeTextCategories.map((category) => [
    category.label,
    category.count,
    denominator > 0 ? category.count / denominator : 0,
    category.analysisText,
    // examples는 응답자의 자유의견 원문 발췌이므로 수식 인젝션 방지 처리 필수
    sanitizeCellValue(category.examples.join('\n')),
  ]);
  rows.forEach((row, index) => {
    const targetRow = sheet.getRow(4 + index);
    targetRow.values = row;
    targetRow.height = 48;
  });
  if (rows.length) {
    styleBodyRows(sheet, 4, 3 + rows.length, [2, 3]);
    setColumnNumberFormat(sheet, 3, 4, 3 + rows.length, '0.0%');
  }
  finalizeSheet(sheet, {
    widths: [24, 10, 12, 52, 60],
    freezeRow: 3,
    autoFilterRange: `A3:E${Math.max(3, 3 + rows.length)}`,
  });
}

function createSummarySheet(workbook, analytics, responseCount) {
  const sheet = workbook.addWorksheet('종합요약');
  addTitle(sheet, '종합요약', '현재 결과보고서의 규칙 기반 자동요약을 반영했습니다.');
  sheet.mergeCells('A4:F4');
  const summaryCell = sheet.getCell('A4');
  summaryCell.value = generateRuleBasedReportSummary(analytics, responseCount);
  summaryCell.font = { name: FONT_NAME, size: 11, color: { argb: COLORS.text } };
  summaryCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.lighterBlue } };
  summaryCell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
  summaryCell.border = {
    top: { style: 'thin', color: { argb: COLORS.border } },
    bottom: { style: 'thin', color: { argb: COLORS.border } },
    left: { style: 'thin', color: { argb: COLORS.border } },
    right: { style: 'thin', color: { argb: COLORS.border } },
  };
  sheet.getRow(4).height = 150;
  finalizeSheet(sheet, { widths: [24, 24, 24, 24, 24, 24], freezeRow: 2 });
}

export async function createStatisticsWorkbook({ survey, responses }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '영중폼';
  workbook.company = '영중종합사회복지관';
  workbook.title = `${survey.title ?? '설문'} 통계분석`;
  workbook.subject = '설문 응답 통계분석';
  workbook.created = new Date();
  workbook.modified = new Date();

  const analytics = buildSurveyAnalytics(survey, responses);
  createOverviewSheet(workbook, survey, responses, new Date());
  const questions = createRawSheet(workbook, survey, responses);
  createChoiceSheet(workbook, questions, responses);
  createSatisfactionSheet(workbook, analytics);
  createProfileSheet(workbook, analytics);
  createFreeTextSheet(workbook, analytics);
  createSummarySheet(workbook, analytics, responses.length);
  workbook.views = [{ activeTab: 0 }];
  return workbook;
}

export async function downloadStatisticsExcel({ survey, responses }) {
  const workbook = await createStatisticsWorkbook({ survey, responses });
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const fileName = `${sanitizeFileName(survey.title)}_통계분석.xlsx`;
  FileSaver.saveAs(blob, fileName);
  return { fileName, size: blob.size };
}
