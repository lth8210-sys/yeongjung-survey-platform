import { FORM_TYPES, QUESTION_TYPES } from '../firebase/surveys';

const AGREEMENT_5_OPTIONS = [
  '1. 전혀 그렇지 않다',
  '2. 조금 그렇지 않다',
  '3. 보통이다',
  '4. 그렇다',
  '5. 매우 그렇다',
];

const YEONGDEUNGPO_AREAS = [
  '영등포동',
  '영등포본동',
  '당산1동',
  '당산2동',
  '문래동',
  '여의동',
  '양평1동',
  '양평2동',
  '영등포구 기타 동',
  '기타',
];

const GENDER_OPTIONS = ['남자', '여자', '기타', '응답 안함'];
const WELFARE_CENTER_USAGE_PERIODS = ['6개월 미만', '6개월 이상 ~ 1년 미만', '1년 이상'];
const RESIDENT_CONTACT_TYPE_OPTIONS = [
  '프로그램 신청',
  '상담',
  '행사참여',
  '자원봉사문의',
  '주민제안',
  '주민만나기',
  '기타',
];
const RESIDENT_AGE_OPTIONS = ['10대', '20대', '30대', '40대', '50대', '60대 이상'];
const RESIDENT_ROLE_OPTIONS = ['뒤에서 지원', '따라가는 식', '앞에서 진행', '새로운 사람 앞 어색'];
const FOLLOW_UP_CONTACT_OPTIONS = ['전화', '문자', '카톡', '방문'];

const DEFAULT_SATISFACTION_COMPLETION_MESSAGE =
  '소중한 의견 감사합니다.\n응답해주신 내용은 더 나은 복지관 운영과 프로그램 개선에 활용하겠습니다.';

const createAgreementQuestion = (title, analyticsKey) => ({
  title,
  type: QUESTION_TYPES.SINGLE_CHOICE,
  options: AGREEMENT_5_OPTIONS,
  required: true,
  meta: {
    analyticsGroup: 'satisfaction',
    analyticsKey,
    scaleMax: 5,
  },
});

const createNumberQuestion = (title, description, required = false, validation = {}) => ({
  title,
  description,
  type: QUESTION_TYPES.NUMBER,
  required,
  validation,
});

const createPrivacyConsentQuestion = () => ({
  title: '개인정보 수집·이용에 동의합니다.',
  type: QUESTION_TYPES.CONSENT_CHECKBOX,
  description: '동의하지 않으면 신청을 진행할 수 없습니다.',
  options: [],
  required: true,
  settings: {
    collectionItems: '이름, 연락처, 생년월일 등',
    usagePurpose: '신청 접수 및 안내',
    retentionPeriod: '사업 종료 후 파기',
    restrictionNotice: '동의 거부 시 신청이 제한될 수 있음',
  },
  meta: {
    consentApproval: true,
  },
});

export const FORM_TEMPLATES = [
  {
    id: 'resident_asset_interview_v1',
    title: '개인 자산 주민 인터뷰',
    description:
      '주민과의 만남에서 강점, 경험, 관심사, 나눌 수 있는 자산, 연결 가능성을 기록하는 현장 인터뷰 템플릿입니다.',
    preview:
      '지역주민과 만난 내용을 현장에서 기록하고, 주민의 강점·경험·관심사·나눌 수 있는 자산·연결 가능성을 정리합니다.',
    category: '주민만나기 / 자산기반실천 / 인터뷰 / 지역조직화',
    tags: ['주민만나기', '자산기반실천', '현장기록', '지역조직화'],
    formType: FORM_TYPES.GENERAL_SURVEY,
    settings: {
      branchingEnabled: false,
      quotaEnabled: false,
      duplicateCheckEnabled: false,
      applicantListView: false,
      processingStatusEnabled: false,
    },
    templateMetadata: {
      templateId: 'resident_asset_interview_v1',
      templateVersion: 1,
      templateCategory: 'community_organizing',
      templateType: 'resident_asset_interview',
      organization: '영중종합사회복지관',
      supportsFollowUp: true,
      supportsAssetMapping: true,
      defaultFormType: 'field_record',
    },
    survey: {
      title: '개인 자산 주민 인터뷰',
      description:
        '지역주민과 만난 내용을 현장에서 기록하고, 주민의 강점·경험·관심사·나눌 수 있는 자산·연결 가능성을 정리하는 내부 기록용 폼입니다.\n\n개인정보가 포함될 수 있으므로 공개 설문 배포보다는 복지관 내부 기록과 후속 연결 관리 목적으로 사용해주세요.',
      cautionText:
        '개인정보와 민감한 이야기는 필요한 범위에서만 기록하고, 외부 공개 링크로 배포하지 않도록 주의해주세요.',
      completionMessage: '주민 인터뷰 기록이 저장되었습니다.',
    },
    sections: [
      { key: 'meeting_info', title: '만남 기본 정보' },
      { key: 'resident_info', title: '주민 정보' },
      {
        key: 'strength_info',
        title: '강점 정보',
        description: '주민이 잘하는 것, 경험, 주변에서 인정받는 점을 기록합니다.',
      },
      {
        key: 'asset_info',
        title: '자산 정보',
        description: '주민이 나눌 수 있는 시간, 물건, 공간, 정보 등을 기록합니다.',
      },
      {
        key: 'interest_connection',
        title: '관심 정보 및 연결 가능성',
        description: '이 주민과 함께 무엇을 시도할 수 있을지 기록합니다.',
      },
      { key: 'follow_up', title: '후속 계획' },
    ],
    questions: [
      { title: '만난 날짜', type: QUESTION_TYPES.DATE, required: true, sectionKey: 'meeting_info', meta: { analyticsKey: 'meeting_date' } },
      { title: '만난 장소', type: QUESTION_TYPES.SHORT_TEXT, required: true, sectionKey: 'meeting_info', meta: { analyticsKey: 'meeting_place' } },
      { title: '접점유형', type: QUESTION_TYPES.SINGLE_CHOICE, options: RESIDENT_CONTACT_TYPE_OPTIONS, required: true, sectionKey: 'meeting_info', meta: { analyticsKey: 'contact_type' } },
      { title: '이름/닉네임', type: QUESTION_TYPES.SHORT_TEXT, sectionKey: 'resident_info', meta: { analyticsKey: 'resident_name' } },
      { title: '연령대', type: QUESTION_TYPES.SINGLE_CHOICE, options: RESIDENT_AGE_OPTIONS, sectionKey: 'resident_info', meta: { analyticsKey: 'age_group' } },
      { title: '자주 있는 곳', type: QUESTION_TYPES.SHORT_TEXT, sectionKey: 'resident_info', meta: { analyticsKey: 'frequent_location' } },
      { title: '연락처', type: QUESTION_TYPES.PHONE, sectionKey: 'resident_info', meta: { analyticsKey: 'phone' } },
      { title: '잘하는 것/손일', type: QUESTION_TYPES.LONG_TEXT, sectionKey: 'strength_info', meta: { analyticsKey: 'strengths' } },
      { title: '경험(이전 경험)', type: QUESTION_TYPES.LONG_TEXT, sectionKey: 'strength_info', meta: { analyticsKey: 'past_experience' } },
      { title: '남들이 칭찬하는 점', type: QUESTION_TYPES.LONG_TEXT, sectionKey: 'strength_info', meta: { analyticsKey: 'praised_points' } },
      { title: '배운 것/자격', type: QUESTION_TYPES.LONG_TEXT, sectionKey: 'strength_info', meta: { analyticsKey: 'certifications' } },
      { title: '나눌 수 있는 시간', description: '예: 월, 수, 금 오전 2시간', type: QUESTION_TYPES.SHORT_TEXT, sectionKey: 'asset_info', meta: { analyticsKey: 'shareable_time' } },
      { title: '나눌 수 있는 물건/재료', type: QUESTION_TYPES.LONG_TEXT, sectionKey: 'asset_info', meta: { analyticsKey: 'shareable_items' } },
      { title: '나눌 수 있는 공간', type: QUESTION_TYPES.LONG_TEXT, sectionKey: 'asset_info', meta: { analyticsKey: 'shareable_space' } },
      { title: '나눌 수 있는 정보/조언', type: QUESTION_TYPES.LONG_TEXT, sectionKey: 'asset_info', meta: { analyticsKey: 'shareable_info' } },
      { title: '비슷한 관심사를 가진 사람들', type: QUESTION_TYPES.LONG_TEXT, sectionKey: 'interest_connection', meta: { analyticsKey: 'similar_interest_people' } },
      { title: '자주 가는 모임', type: QUESTION_TYPES.LONG_TEXT, sectionKey: 'interest_connection', meta: { analyticsKey: 'regular_groups' } },
      { title: '직업 네트워크(동료)', type: QUESTION_TYPES.LONG_TEXT, sectionKey: 'interest_connection', meta: { analyticsKey: 'work_network' } },
      { title: '가족', type: QUESTION_TYPES.LONG_TEXT, sectionKey: 'interest_connection', meta: { analyticsKey: 'family' } },
      { title: '자주 가는 공간', type: QUESTION_TYPES.LONG_TEXT, sectionKey: 'interest_connection', meta: { analyticsKey: 'regular_spaces' } },
      { title: '함께 하고 싶은 활동', type: QUESTION_TYPES.LONG_TEXT, sectionKey: 'interest_connection', meta: { analyticsKey: 'desired_activity' } },
      { title: '역할 선호도', type: QUESTION_TYPES.SINGLE_CHOICE, options: RESIDENT_ROLE_OPTIONS, sectionKey: 'interest_connection', meta: { analyticsKey: 'role_preference' } },
      { title: '추천 사람', type: QUESTION_TYPES.LONG_TEXT, sectionKey: 'follow_up', meta: { analyticsKey: 'recommended_people' } },
      { title: '추천 활동/모임', type: QUESTION_TYPES.LONG_TEXT, sectionKey: 'follow_up', meta: { analyticsKey: 'recommended_activity' } },
      { title: '연락 방법', type: QUESTION_TYPES.MULTIPLE_CHOICE, options: FOLLOW_UP_CONTACT_OPTIONS, sectionKey: 'follow_up', meta: { analyticsKey: 'follow_up_contact_method' } },
      { title: '후속예정일', type: QUESTION_TYPES.DATE, sectionKey: 'follow_up', meta: { analyticsKey: 'follow_up_date' } },
      { title: '담당자', type: QUESTION_TYPES.SHORT_TEXT, sectionKey: 'follow_up', meta: { analyticsKey: 'staff' } },
    ],
  },
  {
    id: 'yeongjung_user_satisfaction_v1',
    title: '영중종합사회복지관 이용자 만족도 조사',
    description:
      '복지관 전체 이용자를 대상으로 서비스, 직원, 시설, 이용 편의성, 행복감 변화를 조사하는 기본 만족도 템플릿입니다.',
    preview: '복지관 전체 이용자 만족도와 일반적 사항, 사회적 관계망, 자유의견을 함께 조사합니다.',
    tags: ['만족도', '이용자조사', '기관평가', '연도반복형'],
    formType: FORM_TYPES.GENERAL_SURVEY,
    settings: {
      branchingEnabled: false,
      quotaEnabled: false,
      duplicateCheckEnabled: false,
      applicantListView: false,
      processingStatusEnabled: false,
    },
    templateMetadata: {
      templateId: 'yeongjung_user_satisfaction_v1',
      templateVersion: 1,
      templateCategory: 'satisfaction',
      templateType: 'organization_user_satisfaction',
      organization: '영중종합사회복지관',
      supportsYearCompare: true,
      defaultFormType: 'general_survey',
    },
    survey: {
      title: '영중종합사회복지관 이용자 만족도 조사',
      description:
        '안녕하세요.\n\n영중종합사회복지관은 “우리 마을이 만드는 행복한 일상”이라는 미션 아래 지역주민 여러분의 삶의 질 향상과 더 나은 서비스를 제공하기 위해 노력하고 있습니다.\n\n이번 조사는 복지관을 이용하시는 주민 여러분의 의견을 듣고, 향후 사업과 프로그램 개선에 반영하기 위해 마련되었습니다.\n\n응답해 주신 내용은 통계 목적 외에는 사용되지 않으며, 개인을 식별할 수 있는 정보는 공개되지 않습니다.\n\n여러분의 소중한 의견이 복지관의 발전과 우리 마을의 행복한 일상을 만들어 가는 중요한 밑거름이 됩니다.\n\n성실한 참여 부탁드립니다.\n귀한 시간을 내어 응답해 주셔서 진심으로 감사드립니다.\n\n관련 문의: 02-2679-2024',
      completionMessage: DEFAULT_SATISFACTION_COMPLETION_MESSAGE,
    },
    sections: [
      {
        key: 'satisfaction',
        title: '복지관 만족도 조사',
        description: '아래 항목에 대해 가장 가까운 의견을 선택해주세요.',
      },
      { key: 'demographics', title: '일반적 사항' },
      { key: 'social_network', title: '사회적 관계망' },
      { key: 'open_feedback', title: '자유의견' },
    ],
    questions: [
      createAgreementQuestion('현재 이용 중인 복지관 프로그램은 나에게 긍정적인 도움을 준다.', 'positive_help'),
      createAgreementQuestion('나는 계속 복지관을 이용할 것이다.', 'continued_use'),
      createAgreementQuestion('복지관 직원들은 성실하고 친절하다.', 'staff_kindness'),
      createAgreementQuestion('복지관은 전반적으로 이용하기 편리하였다.', 'convenience'),
      createAgreementQuestion('복지관 시설 및 프로그램 도구들에 대한 관리가 잘 이루어지고 있다.', 'facility_management'),
      createAgreementQuestion('복지관 프로그램 이용 이후, 나의 행복지수는 향상되었다.', 'happiness_improved'),
      {
        ...createNumberQuestion('출생년도를 작성해주세요.', '예: 1950', true, {
          min: 1900,
          max: new Date().getFullYear(),
        }),
        sectionKey: 'demographics',
      },
      { title: '성별', type: QUESTION_TYPES.SINGLE_CHOICE, options: GENDER_OPTIONS, required: true, sectionKey: 'demographics' },
      { title: '살고있는 곳(거주/생활 지역)', type: QUESTION_TYPES.SINGLE_CHOICE, options: YEONGDEUNGPO_AREAS, required: true, sectionKey: 'demographics' },
      { title: '복지관 이용기간', type: QUESTION_TYPES.SINGLE_CHOICE, options: WELFARE_CENTER_USAGE_PERIODS, required: true, sectionKey: 'demographics' },
      { ...createNumberQuestion('어려울 때 도움을 받을 수 있는 가족·친척은 몇 명입니까?', '없으면 0명을 입력해주세요.'), sectionKey: 'social_network', meta: { analyticsGroup: 'social_network' } },
      { ...createNumberQuestion('어려울 때 도움을 받을 수 있는 이웃·동료는 몇 명입니까?', '없으면 0명을 입력해주세요.'), sectionKey: 'social_network', meta: { analyticsGroup: 'social_network' } },
      { ...createNumberQuestion('어려울 때 도움을 받을 수 있는 전문가는 몇 명입니까?', '없으면 0명을 입력해주세요.'), sectionKey: 'social_network', meta: { analyticsGroup: 'social_network' } },
      { title: '프로그램 참여 이후, 귀하의 삶에 어떤 변화가 있었습니까?', type: QUESTION_TYPES.LONG_TEXT, sectionKey: 'open_feedback', meta: { analyticsGroup: 'open_feedback' } },
      { title: '복지관 이용 중 가장 만족스러웠던 부분은 무엇입니까?', type: QUESTION_TYPES.LONG_TEXT, sectionKey: 'open_feedback', meta: { analyticsGroup: 'open_feedback' } },
      { title: '복지관에 바라는 점이나 개선되었으면 하는 점이 있다면 작성해주세요.', type: QUESTION_TYPES.LONG_TEXT, sectionKey: 'open_feedback', meta: { analyticsGroup: 'open_feedback' } },
    ],
  },
  {
    id: 'education_lifelong_satisfaction_v1',
    title: '교육문화 및 평생교육 이용자 만족도 조사',
    description:
      '교육문화 및 평생교육 프로그램 이용자를 대상으로 프로그램 효과, 운영 만족도, 관계 형성, 건강·정서 변화를 조사하는 템플릿입니다.',
    preview: '프로그램별 만족도와 효과, 재참여 의향, 일반적 사항과 자유의견을 함께 확인합니다.',
    tags: ['만족도', '교육문화', '평생교육', '프로그램평가', '어르신', '연도반복형'],
    formType: FORM_TYPES.GENERAL_SURVEY,
    settings: {
      branchingEnabled: false,
      quotaEnabled: false,
      duplicateCheckEnabled: false,
      applicantListView: false,
      processingStatusEnabled: false,
    },
    templateMetadata: {
      templateId: 'education_lifelong_satisfaction_v1',
      templateVersion: 1,
      templateCategory: 'satisfaction',
      templateType: 'education_lifelong_program_satisfaction',
      organization: '영중종합사회복지관',
      programType: '교육문화 및 평생교육',
      supportsYearCompare: true,
      defaultFormType: 'general_survey',
    },
    survey: {
      title: '교육문화 및 평생교육 이용자 만족도 조사',
      description:
        '안녕하세요.\n\n영중종합사회복지관은 “우리 마을이 만드는 행복한 일상”이라는 미션 아래 지역주민 여러분의 삶의 질 향상과 더 나은 교육문화 및 평생교육 프로그램을 제공하기 위해 노력하고 있습니다.\n\n이번 조사는 교육문화 및 평생교육 프로그램을 이용하시는 주민 여러분의 의견을 듣고, 향후 프로그램 개선과 운영 방향에 반영하기 위해 마련되었습니다.\n\n응답해 주신 내용은 통계 목적 외에는 사용되지 않으며, 개인을 식별할 수 있는 정보는 공개되지 않습니다.\n\n여러분의 소중한 의견은 더 나은 교육문화 및 평생교육 프로그램을 만들어 가는 중요한 자료가 됩니다.\n\n성실한 참여 부탁드립니다.\n귀한 시간을 내어 응답해 주셔서 진심으로 감사드립니다.\n\n관련 문의: 02-2679-2024',
      completionMessage: DEFAULT_SATISFACTION_COMPLETION_MESSAGE,
    },
    sections: [
      { key: 'program_info', title: '교육문화 및 평생교육 프로그램 이용 정보' },
      { key: 'base_satisfaction', title: '복지관 기본 만족도', description: '아래 항목에 대해 가장 가까운 의견을 선택해주세요.' },
      { key: 'program_satisfaction', title: '교육문화 및 평생교육 프로그램 만족도', description: '참여하신 교육문화 및 평생교육 프로그램에 대한 의견을 선택해주세요.' },
      { key: 'demographics', title: '일반적 사항' },
      { key: 'open_feedback', title: '자유의견' },
    ],
    questions: [
      { title: '수강한 프로그램명을 작성해주세요.', description: '예: 스마트폰 교실, 요가교실, 노래교실, 캘리그라피 등', type: QUESTION_TYPES.SHORT_TEXT, required: true, meta: { analyticsGroup: 'program_name' } },
      { title: '프로그램 참여기간을 선택해주세요.', type: QUESTION_TYPES.SINGLE_CHOICE, options: ['1개월 미만', '1개월 이상 ~ 3개월 미만', '3개월 이상 ~ 6개월 미만', '6개월 이상'] },
      { ...createAgreementQuestion('현재 이용 중인 복지관 프로그램은 나에게 긍정적인 도움을 준다.', 'positive_help'), sectionKey: 'base_satisfaction' },
      { ...createAgreementQuestion('나는 계속 복지관을 이용할 것이다.', 'continued_use'), sectionKey: 'base_satisfaction' },
      { ...createAgreementQuestion('복지관 직원들은 성실하고 친절하다.', 'staff_kindness'), sectionKey: 'base_satisfaction' },
      { ...createAgreementQuestion('복지관은 전반적으로 이용하기 편리하였다.', 'convenience'), sectionKey: 'base_satisfaction' },
      { ...createAgreementQuestion('복지관 시설 및 프로그램 도구들에 대한 관리가 잘 이루어지고 있다.', 'facility_management'), sectionKey: 'base_satisfaction' },
      { ...createAgreementQuestion('복지관 프로그램 이용 이후, 나의 행복지수는 향상되었다.', 'happiness_improved'), sectionKey: 'base_satisfaction' },
      { ...createAgreementQuestion('프로그램을 통해 정서적인 안정감이 들었다.', 'emotional_stability'), sectionKey: 'program_satisfaction' },
      { ...createAgreementQuestion('프로그램을 통해 건강이 증진되었다.', 'health_improved'), sectionKey: 'program_satisfaction' },
      { ...createAgreementQuestion('프로그램을 통해 참여자들 간 관계, 즉 알고 지내는 이웃이 증가하였다.', 'relationship_growth'), sectionKey: 'program_satisfaction' },
      { ...createAgreementQuestion('프로그램을 통해 새로운 지식이나 기술을 습득하였다.', 'knowledge_skill'), sectionKey: 'program_satisfaction' },
      { ...createAgreementQuestion('프로그램 내용과 수준은 나에게 적절하였다.', 'content_level'), sectionKey: 'program_satisfaction' },
      { ...createAgreementQuestion('강사 또는 진행자의 설명과 진행 방식에 만족하였다.', 'instructor_satisfaction'), sectionKey: 'program_satisfaction' },
      { ...createAgreementQuestion('프로그램 운영시간과 일정은 적절하였다.', 'schedule_fit'), sectionKey: 'program_satisfaction' },
      { ...createAgreementQuestion('향후에도 같은 프로그램 또는 유사한 프로그램에 참여하고 싶다.', 'rejoin_intent'), sectionKey: 'program_satisfaction' },
      { ...createNumberQuestion('출생년도를 작성해주세요.', '예: 1950', true, { min: 1900, max: new Date().getFullYear() }), sectionKey: 'demographics' },
      { title: '성별', type: QUESTION_TYPES.SINGLE_CHOICE, options: GENDER_OPTIONS, required: true, sectionKey: 'demographics' },
      { title: '살고있는 곳(거주/생활 지역)', type: QUESTION_TYPES.SINGLE_CHOICE, options: YEONGDEUNGPO_AREAS, required: true, sectionKey: 'demographics' },
      { title: '복지관 이용기간', type: QUESTION_TYPES.SINGLE_CHOICE, options: WELFARE_CENTER_USAGE_PERIODS, required: true, sectionKey: 'demographics' },
      { ...createNumberQuestion('어려울 때 도움을 받을 수 있는 가족·친척은 몇 명입니까?', '없으면 0명을 입력해주세요.'), sectionKey: 'demographics', meta: { analyticsGroup: 'social_network' } },
      { ...createNumberQuestion('어려울 때 도움을 받을 수 있는 이웃·동료는 몇 명입니까?', '없으면 0명을 입력해주세요.'), sectionKey: 'demographics', meta: { analyticsGroup: 'social_network' } },
      { ...createNumberQuestion('어려울 때 도움을 받을 수 있는 전문가는 몇 명입니까?', '없으면 0명을 입력해주세요.'), sectionKey: 'demographics', meta: { analyticsGroup: 'social_network' } },
      { title: '프로그램 참여 이후, 귀하의 삶에 어떤 변화가 있었습니까?', type: QUESTION_TYPES.LONG_TEXT, sectionKey: 'open_feedback', meta: { analyticsGroup: 'open_feedback' } },
      { title: '프로그램 참여 중 가장 만족스러웠던 부분은 무엇입니까?', type: QUESTION_TYPES.LONG_TEXT, sectionKey: 'open_feedback', meta: { analyticsGroup: 'open_feedback' } },
      { title: '프로그램에서 개선되었으면 하는 점은 무엇입니까?', type: QUESTION_TYPES.LONG_TEXT, sectionKey: 'open_feedback', meta: { analyticsGroup: 'open_feedback' } },
      { title: '앞으로 참여하고 싶은 교육문화 및 평생교육 프로그램이 있다면 작성해주세요.', type: QUESTION_TYPES.LONG_TEXT, sectionKey: 'open_feedback', meta: { analyticsGroup: 'open_feedback' } },
    ],
  },
  {
    id: 'general-satisfaction',
    title: '일반 만족도 조사',
    description: '프로그램 종료 후 만족도와 의견을 빠르게 받을 때 적합합니다.',
    preview: '만족도 점수와 자유 의견 중심으로 가장 가볍게 시작할 수 있습니다.',
    formType: FORM_TYPES.GENERAL_SURVEY,
    settings: {
      branchingEnabled: false,
      quotaEnabled: false,
      duplicateCheckEnabled: false,
      applicantListView: false,
      processingStatusEnabled: false,
    },
    survey: {
      title: '프로그램 만족도 조사',
      description: '프로그램 운영 개선을 위해 참여 후 느낌과 의견을 남겨주세요.',
    },
    questions: [
      {
        title: '프로그램 만족도는 어떠셨나요?',
        type: QUESTION_TYPES.SINGLE_CHOICE,
        options: ['매우 만족', '만족', '보통', '불만족', '매우 불만족'],
        required: true,
      },
      {
        title: '좋았던 점은 무엇인가요?',
        type: QUESTION_TYPES.LONG_TEXT,
      },
      {
        title: '개선이 필요한 점은 무엇인가요?',
        type: QUESTION_TYPES.LONG_TEXT,
      },
    ],
  },
  {
    id: 'program-application',
    title: '프로그램 신청',
    description: '복지관 프로그램 참여 신청을 기본형으로 시작할 수 있습니다.',
    preview: '이름, 연락처, 신청 내용, 개인정보 동의까지 기본으로 준비됩니다.',
    formType: FORM_TYPES.GENERAL_APPLICATION,
    settings: {
      branchingEnabled: false,
      quotaEnabled: false,
      duplicateCheckEnabled: true,
      applicantListView: true,
      processingStatusEnabled: true,
    },
    survey: {
      title: '프로그램 참여 신청서',
      description: '기본 정보를 입력하고 프로그램 참여를 신청해주세요.',
      applicationGuide: '신청 후 담당자가 확인하여 순차적으로 연락드립니다.',
      cautionText: '연락 가능한 번호를 정확히 입력해주세요.',
    },
    questions: [
      {
        title: '이름',
        type: QUESTION_TYPES.SHORT_TEXT,
        required: true,
      },
      {
        title: '연락처',
        type: QUESTION_TYPES.PHONE,
        required: true,
        placeholder: '예: 010-1234-5678',
      },
      {
        title: '참여 동기 또는 신청 내용',
        type: QUESTION_TYPES.LONG_TEXT,
        required: true,
      },
      createPrivacyConsentQuestion(),
    ],
  },
  {
    id: 'event-slot-application',
    title: '행사 회차 신청',
    description: '회차별 정원을 운영하는 행사·체험 신청에 적합합니다.',
    preview: '신청 슬롯형 질문이 포함되어 있어 오전/오후 회차처럼 자리별 현황을 바로 운영할 수 있습니다.',
    formType: FORM_TYPES.GENERAL_APPLICATION,
    settings: {
      branchingEnabled: false,
      quotaEnabled: false,
      duplicateCheckEnabled: true,
      applicantListView: true,
      processingStatusEnabled: true,
    },
    survey: {
      title: '행사 회차 신청서',
      description: '참여를 원하는 회차를 선택하고 신청 정보를 입력해주세요.',
      scheduleSummary: '오전반 10:00~10:45 / 오후반 14:00~14:45',
      applicationGuide: '회차별 정원이 있어 마감 시 선택이 제한될 수 있습니다.',
    },
    questions: [
      {
        title: '신청할 회차를 선택해주세요.',
        description: '회차별 남은 자리를 확인하고 선택할 수 있습니다.',
        type: QUESTION_TYPES.APPLICATION_SLOT_CHOICE,
        required: true,
        options: ['오전반 1회차', '오전반 2회차', '오후반 1회차'],
        optionSettings: {
          '오전반 1회차': {
            title: '오전반 1회차',
            date: '2026-05-15',
            time: '10:00~10:45',
            place: '4층 강당',
            ageGroup: '전 연령',
            capacity: 20,
            sortOrder: 1,
          },
          '오전반 2회차': {
            title: '오전반 2회차',
            date: '2026-05-15',
            time: '11:00~11:45',
            place: '4층 강당',
            ageGroup: '전 연령',
            capacity: 20,
            sortOrder: 2,
          },
          '오후반 1회차': {
            title: '오후반 1회차',
            date: '2026-05-15',
            time: '14:00~14:45',
            place: '4층 강당',
            ageGroup: '전 연령',
            capacity: 20,
            sortOrder: 3,
          },
        },
      },
      {
        title: '신청자 이름',
        type: QUESTION_TYPES.SHORT_TEXT,
        required: true,
      },
      {
        title: '연락처',
        type: QUESTION_TYPES.PHONE,
        required: true,
      },
      createPrivacyConsentQuestion(),
    ],
  },
  {
    id: 'age-based-application',
    title: '연령대별 참여신청',
    description: '영유아/초등학생처럼 대상에 따라 신청 흐름이 갈리는 경우에 적합합니다.',
    preview: '연령대 선택 질문과 후속 정보 질문을 함께 넣어두어 쉬운 규칙 모드와 바로 연결할 수 있습니다.',
    formType: FORM_TYPES.TARGETED_PARTICIPATION_APPLICATION,
    settings: {
      branchingEnabled: true,
      quotaEnabled: true,
      maxResponses: 40,
      duplicateCheckEnabled: true,
      applicantListView: true,
      processingStatusEnabled: true,
    },
    survey: {
      title: '연령대별 참여 신청서',
      description: '참여 대상에 맞는 정보를 순서대로 입력해주세요.',
      applicationGuide: '연령대에 따라 추가로 보이는 질문이 달라질 수 있습니다.',
    },
    questions: [
      {
        title: '참여 연령대를 선택해주세요.',
        type: QUESTION_TYPES.SINGLE_CHOICE,
        options: ['영유아', '초등학생', '청소년', '기타'],
        required: true,
      },
      {
        title: '신청자 이름',
        type: QUESTION_TYPES.SHORT_TEXT,
        required: true,
      },
      {
        title: '연락처',
        type: QUESTION_TYPES.PHONE,
        required: true,
      },
      {
        title: '생년월일',
        type: QUESTION_TYPES.DATE,
        required: true,
      },
      createPrivacyConsentQuestion(),
    ],
  },
  {
    id: 'counseling-application',
    title: '상담 신청',
    description: '상담 주제, 희망 시간, 연락처를 받아 접수하는 기본형입니다.',
    preview: '상담 신청자 명단과 처리 상태를 바로 운영할 수 있습니다.',
    formType: FORM_TYPES.GENERAL_APPLICATION,
    settings: {
      branchingEnabled: false,
      quotaEnabled: false,
      duplicateCheckEnabled: true,
      applicantListView: true,
      processingStatusEnabled: true,
    },
    survey: {
      title: '상담 신청서',
      description: '상담을 원하는 내용을 입력해주시면 담당자가 연락드립니다.',
      cautionText: '민감한 개인정보는 꼭 필요한 범위에서만 입력해주세요.',
    },
    questions: [
      {
        title: '이름',
        type: QUESTION_TYPES.SHORT_TEXT,
        required: true,
      },
      {
        title: '연락처',
        type: QUESTION_TYPES.PHONE,
        required: true,
      },
      {
        title: '희망 상담 분야',
        type: QUESTION_TYPES.DROPDOWN,
        options: ['가족상담', '심리정서', '경제/복지', '진로/교육', '기타'],
        required: true,
      },
      {
        title: '상담을 신청하는 이유 또는 현재 고민',
        type: QUESTION_TYPES.LONG_TEXT,
        required: true,
      },
      {
        title: '상담 가능 시간',
        type: QUESTION_TYPES.SHORT_TEXT,
      },
      createPrivacyConsentQuestion(),
    ],
  },
  {
    id: 'volunteer-application',
    title: '자원봉사 신청',
    description: '봉사 희망일과 가능한 시간을 받는 기본형 신청서입니다.',
    preview: '봉사 분야, 가능한 날짜, 연락처를 받아 운영자가 명단과 상태를 관리할 수 있습니다.',
    formType: FORM_TYPES.GENERAL_APPLICATION,
    settings: {
      branchingEnabled: false,
      quotaEnabled: false,
      duplicateCheckEnabled: true,
      applicantListView: true,
      processingStatusEnabled: true,
    },
    survey: {
      title: '자원봉사 신청서',
      description: '봉사를 희망하는 일정과 가능한 역할을 알려주세요.',
    },
    questions: [
      {
        title: '이름',
        type: QUESTION_TYPES.SHORT_TEXT,
        required: true,
      },
      {
        title: '연락처',
        type: QUESTION_TYPES.PHONE,
        required: true,
      },
      {
        title: '희망 봉사 분야',
        type: QUESTION_TYPES.MULTIPLE_CHOICE,
        options: ['행사 지원', '학습 보조', '환경 정리', '배식 지원', '기타'],
        allowOther: true,
      },
      {
        title: '봉사 희망 날짜',
        type: QUESTION_TYPES.DATE,
      },
      {
        title: '봉사 가능 시간',
        type: QUESTION_TYPES.SHORT_TEXT,
        placeholder: '예: 평일 오후 2시 이후',
      },
      createPrivacyConsentQuestion(),
    ],
  },
  {
    id: 'needs-survey',
    title: '욕구조사 기본형',
    description: '복지 서비스 욕구와 필요한 지원을 조사하는 기본 템플릿입니다.',
    preview: '지역이나 연령대, 필요한 서비스, 자유 의견 중심으로 가볍게 시작할 수 있습니다.',
    formType: FORM_TYPES.GENERAL_SURVEY,
    settings: {
      branchingEnabled: false,
      quotaEnabled: false,
      duplicateCheckEnabled: false,
      applicantListView: false,
      processingStatusEnabled: false,
    },
    survey: {
      title: '복지 욕구조사',
      description: '현재 필요한 도움과 서비스에 대한 의견을 남겨주세요.',
    },
    questions: [
      {
        title: '연령대',
        type: QUESTION_TYPES.DROPDOWN,
        options: ['아동', '청소년', '청년', '중장년', '노년'],
      },
      {
        title: '현재 가장 필요한 지원은 무엇인가요?',
        type: QUESTION_TYPES.MULTIPLE_CHOICE,
        options: ['정서 지원', '경제 지원', '돌봄 지원', '교육 지원', '건강 지원'],
        allowOther: true,
      },
      {
        title: '복지관에 바라는 점이 있다면 적어주세요.',
        type: QUESTION_TYPES.LONG_TEXT,
      },
    ],
  },
];
