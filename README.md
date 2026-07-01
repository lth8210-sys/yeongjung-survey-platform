# yeongjung-survey-platform

영중종합사회복지관에서 실제 운영 중인 React + Vite + Firebase 기반 통합 설문 운영 플랫폼입니다.

영중폼은 복지관 내부 운영자가 설문조사, 욕구조사, 만족도조사, 신청접수, 결과보고서, Quota 관리, 직원공유, 설문 템플릿을 한 곳에서 관리하기 위해 사용하는 운영 시스템입니다. 앞으로의 개발 원칙은 새 기능 추가보다 기존 운영 기능을 깨뜨리지 않는 Regression Zero를 우선합니다.

## 포함 기능

- Google 로그인
- 관리자 대시보드
- 설문 생성
- 설문 수정
- Draft 저장
- 설문 게시
- 설문 마감
- 설문 복제
- 일반 설문
- 욕구조사
- 만족도조사
- 신청접수
- 조건분기
- 기타 입력
- 최대 선택 개수
- Quota 관리
- 직원공유 설문
- 공개 응답 제출
- 설문별 응답 관리
- 최근응답 확인
- 결과보고서 관리
- CSV 다운로드
- Excel 다운로드
- DOCX 결과보고서 다운로드
- 설문 템플릿
- 감사로그
- Firestore Security Rules 기반 권한 관리

## 시작 방법

```bash
npm install
cp .env.example .env.local
npm run dev
```

개발 중 Google 로그인은 기본적으로 `http://localhost:5173`에서 테스트하세요.
`http://127.0.0.1:5173`로 접속하면 Firebase Authentication 승인 도메인 설정에 따라
`auth/unauthorized-domain` 오류가 날 수 있습니다.

## Firebase 설정 순서

1. Firebase 콘솔에서 프로젝트를 생성합니다.
2. Authentication에서 Google 로그인을 활성화합니다.
3. Firestore Database를 생성합니다.
4. `.env.local`에 Firebase 웹 앱 값을 입력합니다.
5. 관리자 이메일은 `VITE_ADMIN_EMAILS`에 쉼표로 구분해 입력합니다.

Authentication > Settings > Authorized domains에는 아래 도메인을 등록하세요.

- `localhost`
- `127.0.0.1`
- `yeongjung-survey-platform.web.app`

## Firestore 권장 컬렉션

- `surveys`
- `responses`

## 관리자 권한

`.env.local`의 `VITE_ADMIN_EMAILS`에 쉼표로 구분된 관리자 이메일 목록을 넣으면 관리자 화면 접근을 제어할 수 있습니다.

## Firestore 보안 규칙

프로젝트 루트의 [firestore.rules](/Users/itaehui/Library/CloudStorage/OneDrive-개인/영중종합사회복지관/yeongjung-survey-platform/firestore.rules)를 참고해 적용할 수 있습니다.

핵심 정책은 다음과 같습니다.

- 누구나 활성 설문은 읽을 수 있음
- 활성 상태의 `super_admin`, `admin`, `creator`는 설문 생성 가능
- `creator`는 본인이 만든 설문만 수정 가능
- 응답 작성은 누구나 가능
- 응답 조회는 관리자와 해당 설문 제작자만 가능

## Firebase CLI 배포

로컬에서 `firestore.rules`를 배포할 수 있도록 [firebase.json](/Users/itaehui/Library/CloudStorage/OneDrive-개인/영중종합사회복지관/yeongjung-survey-platform/firebase.json) 과 [.firebaserc](/Users/itaehui/Library/CloudStorage/OneDrive-개인/영중종합사회복지관/yeongjung-survey-platform/.firebaserc) 를 추가했습니다.

```bash
npm install
npm run firebase:login
npm run firebase:use
npm run firestore:deploy
```

## 배포 체크리스트

`firestore.rules`가 변경된 경우 Hosting 배포만으로는 권한 정책이 반영되지 않습니다. 배포 전 빌드를 확인하고 Firestore Rules와 Hosting을 함께 배포하세요.

```bash
npm run build
firebase deploy --only firestore
firebase deploy --only hosting
```

전체 리소스를 한 번에 배포할 때는 아래 명령을 사용할 수 있습니다.

```bash
firebase deploy
```

배포 전에는 Firebase Console의 `Firestore Database > Rules` 화면과 로컬 `firestore.rules` 내용을 비교하고, 배포 후에는 관리자 계정과 일반 계정으로 권한 동작을 각각 테스트하는 것을 권장합니다.

## 운영 문서

운영 문서는 `docs/` 폴더에서 관리합니다. 개발 전에는 프로젝트 가드레일과 QA 체크리스트를 먼저 확인하고, 데이터 구조나 권한을 건드릴 가능성이 있으면 관련 운영 문서를 함께 확인하세요.

- [프로젝트 가드레일](./docs/PROJECT_GUARDRAILS.md)
- [QA 체크리스트](./docs/QA_CHECKLIST.md)
- [Firestore Rules 가이드](./docs/FIRESTORE_RULES_GUIDE.md)
- [데이터 스키마](./docs/DATA_SCHEMA.md)
- [변경 영향 매트릭스](./docs/CHANGE_IMPACT_MATRIX.md)
- [Collection 의존관계](./docs/COLLECTION_DEPENDENCY.md)
- [아키텍처](./docs/ARCHITECTURE.md)
- [릴리즈 프로세스](./docs/RELEASE_PROCESS.md)
- [버전 정책](./docs/VERSION_POLICY.md)
- [알려진 이슈](./docs/KNOWN_ISSUES.md)
- [로드맵](./docs/ROADMAP.md)

운영 상태, 구조, 응답 흐름, 배포 절차, 기술부채, AI 협업 인수인계는 `ai/` 폴더에서 관리합니다.

- [현재 상태](./ai/CURRENT_STATUS.md)
- [아키텍처](./ai/ARCHITECTURE.md)
- [응답 흐름](./ai/RESPONSE_FLOW.md)
- [운영 및 배포](./ai/OPERATIONS.md)
- [기술부채](./ai/TECH_DEBT.md)
- [AI 인수인계](./ai/AI_HANDOFF.md)

## 관리자 화면

- `/admin`: 운영 요약 대시보드
- `/admin/surveys/new`: 새 설문 생성
- `/admin/surveys/:surveyId/responses`: 설문별 응답 조회
