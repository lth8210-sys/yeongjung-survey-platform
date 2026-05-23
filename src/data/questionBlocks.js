import { QUESTION_TYPES } from '../firebase/surveys';

export const QUESTION_BLOCKS = [
  {
    id: 'promotion-path',
    title: '홍보 유입 경로',
    description: '복지관 홍보 유입 경로를 묻는 질문 묶음입니다.',
    questions: [
      {
        title: '홍보를 어떻게 접하셨나요?',
        description: '',
        type: QUESTION_TYPES.MULTIPLE_CHOICE,
        options: [
          '복지관 안내문',
          '현수막',
          '홈페이지',
          'SNS',
          '카카오톡 채널',
          '지인 소개',
          '지역 커뮤니티',
        ],
        allowOther: true,
        required: false,
      },
    ],
  },
  {
    id: 'participant-basic',
    title: '기본 참여자 정보',
    description: '이름, 연락처, 연령을 빠르게 추가합니다.',
    questions: [
      {
        title: '이름',
        description: '',
        type: QUESTION_TYPES.SHORT_TEXT,
        options: [],
        required: true,
        allowOther: false,
      },
      {
        title: '연락처',
        description: '',
        type: QUESTION_TYPES.PHONE,
        options: [],
        required: true,
        allowOther: false,
        placeholder: '예: 010-1234-5678',
      },
      {
        title: '연령',
        description: '',
        type: QUESTION_TYPES.NUMBER,
        options: [],
        required: false,
        allowOther: false,
      },
    ],
  },
  {
    id: 'satisfaction-basic',
    title: '만족도 조사 기본형',
    description: '만족도 조사에 자주 쓰는 질문 묶음입니다.',
    questions: [
      {
        title: '프로그램 만족도는 어떠셨나요?',
        description: '',
        type: QUESTION_TYPES.SINGLE_CHOICE,
        options: ['매우 만족', '만족', '보통', '불만족', '매우 불만족'],
        required: true,
        allowOther: false,
      },
      {
        title: '좋았던 점은 무엇인가요?',
        description: '',
        type: QUESTION_TYPES.LONG_TEXT,
        options: [],
        required: false,
        allowOther: false,
      },
      {
        title: '개선이 필요한 점은 무엇인가요?',
        description: '',
        type: QUESTION_TYPES.LONG_TEXT,
        options: [],
        required: false,
        allowOther: false,
      },
    ],
  },
];
