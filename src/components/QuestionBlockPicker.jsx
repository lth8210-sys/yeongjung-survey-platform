import { useState } from 'react';
import { QUESTION_BLOCKS } from '../data/questionBlocks';
import { QUESTION_TYPES } from '../firebase/surveys';

const COMMON_FIELD_BLOCKS = [
  {
    id: 'common-name',
    title: '이름',
    description: '이름 항목 1개를 추가합니다.',
    questions: [
      {
        title: '이름',
        type: QUESTION_TYPES.SHORT_TEXT,
        required: true,
      },
    ],
  },
  {
    id: 'common-phone',
    title: '연락처',
    description: '연락처 항목 1개를 추가합니다.',
    questions: [
      {
        title: '연락처',
        type: QUESTION_TYPES.PHONE,
        required: true,
        placeholder: '예: 010-1234-5678',
      },
    ],
  },
  {
    id: 'common-email',
    title: '이메일',
    description: '이메일 항목 1개를 추가합니다.',
    questions: [
      {
        title: '이메일',
        type: QUESTION_TYPES.EMAIL,
        required: false,
      },
    ],
  },
  {
    id: 'common-birthdate',
    title: '생년월일',
    description: '생년월일 항목 1개를 추가합니다.',
    questions: [
      {
        title: '생년월일',
        type: QUESTION_TYPES.DATE,
        required: false,
      },
    ],
  },
  {
    id: 'common-address',
    title: '주소',
    description: '주소 항목 1개를 추가합니다.',
    questions: [
      {
        title: '주소',
        type: QUESTION_TYPES.SHORT_TEXT,
        required: false,
      },
    ],
  },
];

function QuestionBlockPicker({ onAddBlock, onAddConsentTemplate, onClose }) {
  const [showMore, setShowMore] = useState(false);
  const primaryBlocks = COMMON_FIELD_BLOCKS.filter((block) =>
    ['common-name', 'common-phone', 'common-birthdate'].includes(block.id),
  );
  const extraBlocks = [
    ...COMMON_FIELD_BLOCKS.filter((block) =>
      ['common-email', 'common-address'].includes(block.id),
    ),
    ...QUESTION_BLOCKS,
  ];

  return (
    <div className="panel block-picker">
      <div className="builder-header-row">
        <h2>공통 항목 넣기</h2>
        <button className="text-button" onClick={onClose} type="button">
          닫기
        </button>
      </div>
      <div className="block-list">
        {primaryBlocks.map((block) => (
          <div className="block-card" key={block.id}>
            <div>
              <strong>{block.title}</strong>
              <p>{block.description}</p>
            </div>
            <button className="secondary-button" onClick={() => onAddBlock(block.questions)} type="button">
              추가
            </button>
          </div>
        ))}
        <div className="block-card">
          <div>
            <strong>개인정보 동의</strong>
            <p>개인정보 안내와 필수 동의 체크 항목을 질문 1개로 추가합니다.</p>
          </div>
          <button className="secondary-button" onClick={onAddConsentTemplate} type="button">
            추가
          </button>
        </div>
        <button
          className="text-button block-picker-toggle"
          onClick={() => setShowMore((current) => !current)}
          type="button"
        >
          {showMore ? '접기' : '더 보기'}
        </button>
        {showMore &&
          extraBlocks.map((block) => (
            <div className="block-card" key={block.id}>
              <div>
                <strong>{block.title}</strong>
                <p>{block.description}</p>
              </div>
              <button className="secondary-button" onClick={() => onAddBlock(block.questions)} type="button">
                추가
              </button>
            </div>
          ))}
      </div>
    </div>
  );
}

export default QuestionBlockPicker;
