# 운영 및 배포 절차

최종 업데이트: 2026-06-10

## 로컬 실행 방법

```bash
npm install
cp .env.example .env.local
npm run dev
```

- 개발 기본 주소는 `http://localhost:5173`입니다.
- Firebase Authentication 승인 도메인 설정에 따라 `127.0.0.1` 접속은 `auth/unauthorized-domain` 오류가 날 수 있습니다.
- `.env.local`에는 Firebase 웹 앱 설정과 관리자 이메일 목록을 넣습니다.
- 민감정보는 문서나 Git에 기록하지 않습니다.

## 빌드 방법

```bash
npm run build
```

- Vite production build가 `dist/`에 생성됩니다.
- 현재 큰 chunk 경고는 알려진 상태입니다. 빌드 실패가 아니면 배포 자체를 막지는 않습니다.

## GitHub push 절차

```bash
git status
git diff --stat
git add <변경 파일>
git commit -m "<작업 요약>"
git push origin <브랜치명>
```

- 기능 코드와 운영 문서 변경을 섞을 때는 diff 범위를 반드시 확인합니다.
- 민감정보, API key, token, 실제 개인정보가 포함되지 않았는지 확인합니다.

## Firebase Hosting 배포 절차

```bash
npm run build
firebase deploy --only hosting
```

- Hosting은 `dist/` 산출물을 배포합니다.
- SPA rewrite 설정은 `firebase.json`에 있습니다.

## Firestore rules 변경 시 배포 절차

`firestore.rules` 또는 `firestore.indexes.json`을 변경한 경우 Hosting 배포만으로는 반영되지 않습니다.

```bash
npm run build
firebase deploy --only firestore
firebase deploy --only hosting
```

전체 배포가 필요하면 다음 명령을 사용할 수 있습니다.

```bash
firebase deploy
```

## 배포 후 확인 항목

- https://yeongjung-survey-platform.web.app 접속 확인
- 관리자 Google 로그인 확인
- `/admin/surveys` 목록 로드 확인
- 공개 응답 URL `/surveys/:surveyId` 접속 확인
- 객관식 -> 주관식 -> 개인정보 동의 -> 제출 흐름 확인
- production 화면에 debug panel이 보이지 않는지 확인
- 브라우저 콘솔에 raw questions/sections 등 내부 설문 구조 로그가 노출되지 않는지 확인
- 응답 저장 후 관리자 응답 목록에 반영되는지 확인
- 삭제된 응답이 목록/통계/다운로드에서 제외되는지 확인

## 실제 설문 응답 테스트 방법

1. 관리자 계정으로 로그인합니다.
2. `/admin/surveys/new`에서 템플릿 기반 설문을 생성합니다.
3. 설문을 공개 상태로 저장합니다.
4. 공개 URL `/surveys/:surveyId`로 접속합니다.
5. 객관식 문항 응답 후 다음을 누릅니다.
6. 주관식/장문형 문항이 표시되는지 확인합니다.
7. 선택 주관식은 비운 채 제출 가능한지 확인합니다.
8. 필수 주관식은 비우면 제출되지 않는지 확인합니다.
9. 마지막 질문 페이지 버튼이 `제출하기` 또는 `제출 및 저장`인지 확인합니다.
10. 제출 완료 후 `/admin/surveys/:surveyId/responses`에서 저장 데이터를 확인합니다.

## 응답 삭제 테스트 방법

1. 관리자 또는 슈퍼관리자 계정으로 로그인합니다.
2. 테스트 응답 1건을 생성합니다.
3. `/admin/surveys/:surveyId/responses`로 이동합니다.
4. 개별 응답의 삭제 버튼을 누릅니다.
5. 확인 모달의 문구를 확인합니다.
   - `이 응답을 삭제하시겠습니까?`
   - `삭제된 응답은 복구할 수 없습니다.`
6. 삭제 후 응답 목록에서 즉시 사라지는지 확인합니다.
7. 통계 수치가 감소하는지 확인합니다.
8. CSV 다운로드에서 삭제 응답이 제외되는지 확인합니다.
9. 같은 응답을 다시 삭제하려고 할 때 중복 처리되지 않는지 확인합니다.

## 감사로그 확인 방법

- 화면: `/admin/audit-logs`
- Firestore collection: `audit_logs`
- 응답 삭제 로그 필수 값:
  - `action: response_delete`
  - `surveyId`
  - `responseId`
  - `deletedBy`
  - `deletedAt`
  - `createdAt`

## 운영 오류 기록 양식

```md
## 오류 기록

- 발생일시:
- 발견자:
- 화면/URL:
- 계정 역할:
- 설문 ID:
- 응답 ID:
- 재현 절차:
- 기대 결과:
- 실제 결과:
- 콘솔 오류:
- Firestore 데이터 특이사항:
- 임시 조치:
- 최종 조치:
```

## 직원 사용 전 점검 체크리스트

- 설문 제목/설명이 올바른지 확인
- 필수 문항 표시 확인
- 선택 문항이 비워도 제출 가능한지 확인
- 개인정보 동의 문항 확인
- 공개 기간/마감 상태 확인
- 응답 링크 QR/복사 링크 확인
- 테스트 응답 제출 후 관리자 화면에서 데이터 확인
- 테스트 응답 삭제 및 감사로그 확인

## 장애 발생 시 기본 대응

1. 배포 직후 문제라면 직전 commit과 배포 시간을 기록합니다.
2. 브라우저 콘솔 오류와 Firestore 권한 오류를 구분합니다.
3. `npm run build`를 로컬에서 재실행해 빌드 오류 여부를 확인합니다.
4. Firestore Rules 변경 여부를 확인하고 필요 시 `firebase deploy --only firestore`를 실행합니다.
5. 특정 설문 문제라면 Firestore의 `surveys/{surveyId}.questions`와 `sections`를 확인합니다.
6. 응답 누락 문제라면 `visibleQuestionIds`, `visibleSectionIds`, `answers` 저장값을 확인합니다.
7. 임시 운영 안내가 필요하면 설문을 `closed` 처리하거나 관리자에게 수동 대응 절차를 공유합니다.
