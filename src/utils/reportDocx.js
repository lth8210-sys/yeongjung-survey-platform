import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  PageBreak,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import FileSaver from 'file-saver';
import { formatAverage } from './surveyAnalytics';

const A4_WIDTH_DXA = 11906;
const A4_HEIGHT_DXA = 16838;
const PAGE_MARGIN_DXA = 1134;
const CONTENT_WIDTH_DXA = A4_WIDTH_DXA - PAGE_MARGIN_DXA * 2;
const FONT_FAMILY = 'Malgun Gothic';
const COLOR_NAVY = '173B63';
const COLOR_TEXT = '111827';
const COLOR_MUTED = '64748B';
const COLOR_BORDER = 'CBD5E1';
const COLOR_HEADER_FILL = 'E8EEF5';

function textRun(text, options = {}) {
  return new TextRun({
    text: String(text ?? ''),
    font: FONT_FAMILY,
    color: options.color ?? COLOR_TEXT,
    bold: options.bold,
    italics: options.italics,
    size: options.size ?? 21,
  });
}

function bodyParagraph(text, options = {}) {
  return new Paragraph({
    alignment: options.alignment ?? AlignmentType.LEFT,
    heading: options.heading,
    pageBreakBefore: options.pageBreakBefore,
    keepNext: options.keepNext,
    spacing: {
      before: options.before ?? 0,
      after: options.after ?? 140,
      line: options.line ?? 320,
    },
    children: [
      textRun(text, {
        bold: options.bold,
        color: options.color,
        italics: options.italics,
        size: options.size,
      }),
    ],
  });
}

function sectionHeading(number, title) {
  return bodyParagraph(`${number}. ${title}`, {
    heading: HeadingLevel.HEADING_1,
    keepNext: true,
    before: 260,
    after: 140,
    size: 30,
    bold: true,
    color: COLOR_NAVY,
  });
}

function subsectionHeading(title) {
  return bodyParagraph(title, {
    heading: HeadingLevel.HEADING_2,
    keepNext: true,
    before: 180,
    after: 100,
    size: 24,
    bold: true,
    color: COLOR_NAVY,
  });
}

function tableCell(value, options = {}) {
  return new TableCell({
    width: options.width
      ? { size: options.width, type: WidthType.DXA }
      : undefined,
    verticalAlign: VerticalAlign.CENTER,
    shading: options.header
      ? { fill: COLOR_HEADER_FILL, type: ShadingType.CLEAR, color: 'auto' }
      : undefined,
    margins: {
      top: 100,
      bottom: 100,
      left: 120,
      right: 120,
    },
    children: [
      bodyParagraph(value, {
        alignment: options.alignment ?? AlignmentType.LEFT,
        after: 0,
        line: 280,
        size: 19,
        bold: options.header || options.bold,
      }),
    ],
  });
}

function dataTable(headers, rows, widths) {
  const normalizedWidths =
    widths?.length === headers.length
      ? widths
      : headers.map(() => Math.floor(CONTENT_WIDTH_DXA / headers.length));
  const totalWidth = normalizedWidths.reduce((sum, width) => sum + width, 0);

  return new Table({
    width: { size: totalWidth, type: WidthType.DXA },
    columnWidths: normalizedWidths,
    borders: {
      top: { color: COLOR_BORDER, style: BorderStyle.SINGLE, size: 4 },
      bottom: { color: COLOR_BORDER, style: BorderStyle.SINGLE, size: 4 },
      left: { color: COLOR_BORDER, style: BorderStyle.SINGLE, size: 4 },
      right: { color: COLOR_BORDER, style: BorderStyle.SINGLE, size: 4 },
      insideHorizontal: { color: COLOR_BORDER, style: BorderStyle.SINGLE, size: 4 },
      insideVertical: { color: COLOR_BORDER, style: BorderStyle.SINGLE, size: 4 },
    },
    rows: [
      new TableRow({
        tableHeader: true,
        cantSplit: true,
        children: headers.map((header, index) =>
          tableCell(header, {
            header: true,
            width: normalizedWidths[index],
            alignment: index === 0 ? AlignmentType.LEFT : AlignmentType.CENTER,
          }),
        ),
      }),
      ...rows.map(
        (row) =>
          new TableRow({
            cantSplit: true,
            children: row.map((value, index) =>
              tableCell(value, {
                width: normalizedWidths[index],
                alignment: index === 0 ? AlignmentType.LEFT : AlignmentType.CENTER,
              }),
            ),
          }),
      ),
    ],
  });
}

function labelValueTable(rows) {
  return dataTable(
    ['항목', '내용'],
    rows,
    [2300, CONTENT_WIDTH_DXA - 2300],
  );
}

function addCountTable(children, title, rows, labelHeader) {
  if (!rows?.length) return;
  children.push(
    subsectionHeading(title),
    dataTable(
      [labelHeader, '응답 수', '비율'],
      rows.map((row) => [row.label, `${row.count}건`, `${row.percent}%`]),
      [CONTENT_WIDTH_DXA - 3200, 1600, 1600],
    ),
    bodyParagraph('', { after: 80 }),
  );
}

function addInterpretation(children, title, text) {
  if (!String(text ?? '').trim()) return;
  children.push(
    subsectionHeading(title),
    bodyParagraph(text),
  );
}

function buildCover(reportMeta) {
  return [
    bodyParagraph('영중종합사회복지관', {
      alignment: AlignmentType.CENTER,
      after: 120,
      size: 25,
      bold: true,
      color: COLOR_NAVY,
    }),
    bodyParagraph('결과보고서', {
      alignment: AlignmentType.CENTER,
      before: 1700,
      after: 220,
      size: 25,
      bold: true,
      color: COLOR_NAVY,
    }),
    bodyParagraph(reportMeta.title, {
      alignment: AlignmentType.CENTER,
      after: 900,
      size: 40,
      bold: true,
    }),
    labelValueTable([
      ['조사기간', reportMeta.period],
      ['조사대상', reportMeta.target],
      ['작성부서', reportMeta.department],
      ['작성일', reportMeta.writtenDate],
      ...(reportMeta.author ? [['작성자', reportMeta.author]] : []),
    ]),
    bodyParagraph('Yeongjung Social Welfare Center', {
      alignment: AlignmentType.CENTER,
      before: 900,
      after: 0,
      size: 18,
      color: COLOR_MUTED,
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

function buildToc(tocItems) {
  const children = [
    bodyParagraph('목차', {
      heading: HeadingLevel.HEADING_1,
      after: 300,
      size: 34,
      bold: true,
      color: COLOR_NAVY,
    }),
  ];

  tocItems.forEach((item) => {
    children.push(
      bodyParagraph(`${item.number}. ${item.title}`, {
        after: 140,
        size: 23,
        bold: true,
      }),
    );
    (item.children ?? []).forEach((child) => {
      children.push(
        bodyParagraph(`    ${child.number}. ${child.title}`, {
          after: 100,
          size: 20,
          color: COLOR_MUTED,
        }),
      );
    });
  });

  children.push(new Paragraph({ children: [new PageBreak()] }));
  return children;
}

function buildOverview({
  survey,
  reportMeta,
  sections,
  responseCount,
}) {
  const rows = [
    ['보고서 제목', reportMeta.title],
    ['조사기간', reportMeta.period],
    ['조사대상', reportMeta.target],
    ['작성부서', reportMeta.department],
    ['작성일', reportMeta.writtenDate],
    ...(reportMeta.author ? [['작성자', reportMeta.author]] : []),
    ['원 설문명', survey.title],
    ['총 응답 수', `${responseCount}건`],
    ...(survey.description ? [['조사 설명', survey.description]] : []),
  ];
  const children = [
    sectionHeading(1, '조사 개요'),
    labelValueTable(rows),
  ];

  if (
    String(sections.overviewText ?? '').trim() &&
    String(sections.overviewText ?? '').trim() !== String(survey.description ?? '').trim()
  ) {
    addInterpretation(children, '조사 개요 설명', sections.overviewText);
  }
  return children;
}

function buildCharacteristics({
  analytics,
  sections,
  sectionNumber,
  displayedProgramRows,
}) {
  const children = [
    sectionHeading(sectionNumber, '응답자 특성'),
  ];
  addInterpretation(children, '응답자 특성 해석', sections.respondentProfileText);
  addCountTable(children, '프로그램별 응답 현황', displayedProgramRows, '프로그램명');
  addCountTable(children, '지역별 응답 현황', analytics.groupCounts.area, '지역');
  addCountTable(children, '참여기간별 응답 현황', analytics.groupCounts.usagePeriod, '참여기간');
  return children;
}

function buildSatisfaction({
  analytics,
  sections,
  sectionNumber,
  responseCount,
}) {
  const scoredAnswerCount = analytics.scoredRows.reduce((sum, row) => sum + row.count, 0);
  const children = [
    sectionHeading(sectionNumber, '만족도 분석'),
    bodyParagraph(
      `전체 평균 만족도: ${formatAverage(analytics.totalAverage)}점 (응답자 ${responseCount}명 기준, 문항 응답 ${scoredAnswerCount}건)`,
      { bold: true },
    ),
  ];
  addInterpretation(children, '만족도 분석 해석', sections.satisfactionAnalysisText);
  children.push(
    subsectionHeading('만족도 상위 문항'),
    dataTable(
      ['문항', '평균', '응답 수'],
      analytics.topRows.map((row) => [
        row.question.title,
        `${formatAverage(row.average)}점`,
        `${row.count}건`,
      ]),
      [CONTENT_WIDTH_DXA - 3000, 1400, 1600],
    ),
    subsectionHeading('개선 필요 문항'),
    dataTable(
      ['문항', '평균', '응답 수'],
      analytics.lowRows.map((row) => [
        row.question.title,
        `${formatAverage(row.average)}점`,
        `${row.count}건`,
      ]),
      [CONTENT_WIDTH_DXA - 3000, 1400, 1600],
    ),
    subsectionHeading('문항별 상세 분석'),
    dataTable(
      ['문항', '평균', '응답 수', '점수 분포'],
      analytics.scoredRows.map((row) => [
        row.question.title,
        `${formatAverage(row.average)}점`,
        `${row.count}건`,
        row.distribution.map((item) => `${item.score}점 ${item.count}건`).join(', '),
      ]),
      [CONTENT_WIDTH_DXA - 5000, 1200, 1400, 2400],
    ),
  );
  return children;
}

function buildFreeText({ analytics, sections, sectionNumber }) {
  const children = [
    sectionHeading(sectionNumber, '자유의견'),
  ];
  addInterpretation(children, '자유의견 요약', sections.openEndedSummaryText);
  children.push(subsectionHeading(`${sectionNumber}-1. 자유의견 주요 유형`));

  if (analytics.freeTextCategories.length > 0) {
    children.push(
      dataTable(
        ['유형', '건수', '대표 의견'],
        analytics.freeTextCategories.map((category) => [
          category.label,
          `${category.count}건`,
          category.examples.join('\n'),
        ]),
        [2300, 1100, CONTENT_WIDTH_DXA - 3400],
      ),
    );
  } else {
    children.push(bodyParagraph('등록된 자유의견이 없습니다.', { color: COLOR_MUTED }));
  }

  const grouped = new Map();
  analytics.textResponses.forEach(({ questionTitle, answer }) => {
    const list = grouped.get(questionTitle) ?? [];
    list.push(answer);
    grouped.set(questionTitle, list);
  });

  Array.from(grouped.entries()).forEach(([title, answers]) => {
    children.push(subsectionHeading(title));
    answers.forEach((answer) => {
      children.push(
        new Paragraph({
          numbering: { reference: 'report-numbering', level: 0 },
          spacing: { after: 100, line: 300 },
          children: [textRun(answer, { size: 20 })],
        }),
      );
    });
  });

  return children;
}

function buildFinalSection({ sections, sectionNumber }) {
  return [
    sectionHeading(sectionNumber, '종합 요약 및 개선방향'),
    subsectionHeading('종합 요약'),
    bodyParagraph(sections.finalSummaryText || '분석할 응답 데이터가 없습니다.'),
    subsectionHeading('향후 개선방향'),
    bodyParagraph(sections.improvementPlanText || '-'),
  ];
}

export function createSurveyReportDocument({
  survey,
  reportMeta,
  sections,
  analytics,
  responseCount,
  displayedProgramRows,
  sectionNumbers,
  tocItems,
}) {
  const children = [
    ...buildCover(reportMeta),
    ...buildToc(tocItems),
    ...buildOverview({ survey, reportMeta, sections, responseCount }),
  ];

  if (sectionNumbers.characteristics) {
    children.push(
      ...buildCharacteristics({
        analytics,
        sections,
        sectionNumber: sectionNumbers.characteristics,
        displayedProgramRows,
      }),
    );
  }
  if (sectionNumbers.satisfaction) {
    children.push(
      ...buildSatisfaction({
        analytics,
        sections,
        sectionNumber: sectionNumbers.satisfaction,
        responseCount,
      }),
    );
  }
  if (sectionNumbers.freeText) {
    children.push(
      ...buildFreeText({
        analytics,
        sections,
        sectionNumber: sectionNumbers.freeText,
      }),
    );
  }
  children.push(
    ...buildFinalSection({
      sections,
      sectionNumber: sectionNumbers.final,
    }),
  );

  return new Document({
    creator: '영중폼',
    title: reportMeta.title,
    description: `${survey.title} 결과보고서`,
    styles: {
      default: {
        document: {
          run: {
            font: FONT_FAMILY,
            size: 21,
            color: COLOR_TEXT,
          },
          paragraph: {
            spacing: { after: 140, line: 320 },
          },
        },
        heading1: {
          run: {
            font: FONT_FAMILY,
            size: 30,
            bold: true,
            color: COLOR_NAVY,
          },
          paragraph: {
            spacing: { before: 260, after: 140 },
          },
        },
        heading2: {
          run: {
            font: FONT_FAMILY,
            size: 24,
            bold: true,
            color: COLOR_NAVY,
          },
          paragraph: {
            spacing: { before: 180, after: 100 },
          },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: 'report-numbering',
          levels: [
            {
              level: 0,
              format: 'decimal',
              text: '%1.',
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: { left: 540, hanging: 270 },
                },
              },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: A4_WIDTH_DXA,
              height: A4_HEIGHT_DXA,
            },
            margin: {
              top: PAGE_MARGIN_DXA,
              right: PAGE_MARGIN_DXA,
              bottom: PAGE_MARGIN_DXA,
              left: PAGE_MARGIN_DXA,
            },
          },
        },
        children,
      },
    ],
  });
}

export function buildReportDocxFileName(title) {
  const normalizedTitle = String(title || '결과보고서')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_');
  return `${normalizedTitle || '결과보고서'}.docx`;
}

export async function downloadSurveyReportDocx(options) {
  const document = createSurveyReportDocument(options);
  const blob = await Packer.toBlob(document);
  const fileName = buildReportDocxFileName(options.reportMeta?.title);
  FileSaver.saveAs(blob, fileName);
  return fileName;
}
