import { describe, expect, it } from 'vitest';
import { buildRawExportColumns, keepStoredResponseAnswerItems } from '../src/utils/rawExportColumns.js';
import { buildRawResponseRows, createStatisticsWorkbook } from '../src/utils/statisticsExcel.js';

const currentQuestions = [
  { id: 'q1', title: '수정된 제목', type: 'shortText' },
  { id: 'q3', title: '새 문항', type: 'singleChoice' },
  { id: 'section', title: '안내', type: 'sectionTitle' },
];

describe('buildRawExportColumns', () => {
  it('models the production migration shape: 14 current questions, historical columns, and blank new-question cells', () => {
    const fourteenCurrentQuestions = Array.from({ length: 14 }, (_, index) => ({
      id: `current-${index + 1}`,
      title: `현재 문항 ${index + 1}`,
      type: 'shortText',
    }));
    const historicalAnswers = Array.from({ length: 10 }, (_, index) => ({
      questionId: `historical-${index + 1}`,
      questionTitle: `이전 문항 ${index + 1}`,
      questionType: 'shortText',
      answer: `old-${index + 1}`,
    }));
    const { headers, rows } = buildRawResponseRows(
      { questions: fourteenCurrentQuestions },
      [
        { id: 'old-response', status: 'submitted', answers: [{ questionId: 'current-1', questionTitle: '현재 문항 1', questionType: 'shortText', answer: 'old-current' }, ...historicalAnswers] },
        { id: 'new-response', status: 'submitted', answers: fourteenCurrentQuestions.map((question) => ({ questionId: question.id, questionTitle: question.title, questionType: question.type, answer: 'new' })) },
      ],
    );

    expect(headers).toHaveLength(4 + 14 + 10);
    expect(headers.at(-1)).toBe('[이전 문항] 이전 문항 10');
    expect(rows[0][4 + 13]).toBe('');
    expect(rows[1][4 + 14]).toBe('');
  });

  it('keeps an old answer under a title-edited question ID and leaves a newly added question blank', () => {
    const columns = buildRawExportColumns(currentQuestions, [
      { answers: [{ questionId: 'q1', questionTitle: '기존 제목', questionType: 'shortText', answer: 'old' }] },
      { answers: [{ questionId: 'q1', questionTitle: '수정된 제목', questionType: 'shortText', answer: 'new' }, { questionId: 'q3', questionTitle: '새 문항', questionType: 'singleChoice', answer: 'yes' }] },
    ]);

    expect(columns.map((column) => column.id)).toEqual(['q1', 'q3']);
    expect(columns.map((column) => column.exportLabel)).toEqual(['수정된 제목', '새 문항']);
  });

  it('adds a separate previous-question column for an answer whose ID is no longer current', () => {
    const columns = buildRawExportColumns(currentQuestions, [
      { answers: [{ questionId: 'old-q2', questionTitle: '교체된 문항', questionType: 'shortText', answer: 'legacy' }] },
    ]);

    expect(columns.map((column) => column.id)).toEqual(['q1', 'q3', 'old-q2']);
    expect(columns.at(-1)).toMatchObject({ legacy: true, exportLabel: '[이전 문항] 교체된 문항' });
  });

  it('uses the same historical column in the raw Excel row projection', () => {
    const { headers, rows } = buildRawResponseRows(
      { questions: currentQuestions },
      [{ id: 'response-1', status: 'submitted', answers: [{ questionId: 'old-q2', questionTitle: '교체된 문항', questionType: 'shortText', answer: 'legacy-value' }] }],
    );

    expect(headers).toContain('[이전 문항] 교체된 문항');
    expect(rows[0].at(-1)).toBe('legacy-value');
  });

  it('does not add historical-only answers to the Excel choice statistics sheet', async () => {
    const workbook = await createStatisticsWorkbook({
      survey: { title: '테스트', questions: [{ id: 'current-q', title: '현재 문항', type: 'singleChoice', options: ['현재 선택지'] }] },
      responses: [{ id: 'response-1', status: 'submitted', answers: [{ questionId: 'old-q', questionTitle: '이전 문항', questionType: 'singleChoice', answer: '이전 선택지' }] }],
    });

    const rawSheet = workbook.getWorksheet('응답 원본');
    const choiceSheet = workbook.getWorksheet('객관식 빈도분석');
    expect(rawSheet.getRow(3).values).toContain('[이전 문항] 이전 문항');
    expect(choiceSheet.getCell('A4').value).toBe('현재 문항');
    expect(choiceSheet.getCell('A4').value).not.toBe('이전 문항');
  });

  it('keeps equal titles with different question IDs in separate deterministic columns', () => {
    const columns = buildRawExportColumns(
      [{ id: 'new-q', title: '만족도', type: 'singleChoice' }],
      [{ answers: [{ questionId: 'old-q', questionTitle: '만족도', questionType: 'singleChoice', answer: 'old' }] }],
    );

    expect(columns.map((column) => column.exportLabel)).toEqual(['만족도', '[이전 문항] 만족도']);
  });

  it('does not invent a column for malformed historical answers without a question ID', () => {
    const columns = buildRawExportColumns(currentQuestions, [
      { answers: [{ questionTitle: '식별 불가', questionType: 'shortText', answer: 'unknown' }] },
    ]);

    expect(columns.map((column) => column.id)).toEqual(['q1', 'q3']);
  });

  it('keeps only actually stored answers so newly added questions remain blank', () => {
    const answerItems = keepStoredResponseAnswerItems(
      [
        { questionId: 'q1', answer: 'stored' },
        { questionId: 'q3', answer: undefined },
      ],
      [{ questionId: 'q1', answer: 'stored' }],
    );

    expect(answerItems).toEqual([{ questionId: 'q1', answer: 'stored' }]);
  });
});
