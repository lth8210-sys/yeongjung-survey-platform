# Release Process

영중폼 운영 릴리즈는 반드시 아래 순서를 따른다.

```text
영향 분석
↓
설계
↓
개발
↓
Build
↓
Rules Compile
↓
QA
↓
Commit
↓
Push
↓
Deploy
↓
운영 확인
```

## 1. 영향 분석

변경 대상 화면, 함수, Firestore collection, rules, role, 기존 데이터 영향을 확인한다. 영향이 불명확한 경우 개발을 시작하지 않는다.

## 2. 설계

수정 범위와 회귀 테스트 범위를 정한다. 새 구조가 필요한 경우 기존 데이터와 호환되는지 먼저 문서화한다.

## 3. 개발

최소 수정 원칙으로 구현한다. 관련 없는 리팩터링과 스타일 변경은 하지 않는다.

## 4. Build

다음 명령을 실행한다.

```bash
npm run build
```

빌드 경고는 실패가 아니지만, 새 경고가 생겼다면 원인을 기록한다.

## 5. Rules Compile

Firestore rules 변경이 있거나 권한 관련 작업이면 다음 명령을 실행한다.

```bash
firebase deploy --only firestore:rules --dry-run --project yeongjung-survey-platform
```

dry-run은 배포가 아니다. rules 컴파일과 프로젝트 접근 가능 여부를 확인하기 위한 검증이다.

## 6. QA

[QA_CHECKLIST.md](./QA_CHECKLIST.md)를 기준으로 회귀 테스트를 수행한다. 수행하지 못한 항목은 "미확인"으로 표시하고 이유를 기록한다.

## 7. Commit

QA 완료 후 의미 단위로 커밋한다. 커밋 메시지에는 변경 목적과 검증 결과를 포함한다.

## 8. Push

원격 브랜치에 push한다. 운영 브랜치로 직접 push하지 않는다.

## 9. Deploy

운영 승인 후 배포한다. rules, hosting, functions 등 배포 대상이 무엇인지 명확히 한다.

## 10. 운영 확인

배포 후 실제 운영 계정으로 핵심 경로를 확인한다.

- super_admin 로그인
- 설문 목록
- 설문 수정
- 최근 응답
- 설문별 응답
- 결과보고서
- 공개 응답 제출
- 다운로드

## 설문 문항 구조 변경 릴리즈의 라이브 Firestore 반영 절차

`src/data/formTemplates.js`처럼 문항 구조 자체(타입, 조건부 표시, quota shape 등)를
바꾸는 릴리즈는 코드 배포만으로 라이브 설문에 반영되지 않는다(템플릿은 신규 설문
생성 시드일 뿐 기존 Firestore `surveys/{surveyId}` 문서와 자동 동기화되지 않음).
이런 릴리즈는 아래 순서를 코드 배포와 별도로 밟는다.

```text
백업(surveys/{id}, quotaConfig/main, quotaCounts/main 문서 export)
↓
조사기간 중인지 확인 — 진행 중이면 운영진 승인 필수
↓
Survey Builder 재구성 또는 마이그레이션 스크립트로 questions/sections 반영
↓
quotaConfig/quotaCounts 이관 방식 결정(연령대 합산 이관 vs 재시작) 후 반영
↓
공개 응답 화면에서 새 문항/조건부 표시가 실제로 보이는지 확인
↓
운영 확인
```

- **조사기간 중 변경 위험**: 응답이 이미 접수되고 있는 도중에 문항 구조를 바꾸면
  (a) 이미 제출된 응답과 새 문항 구조 간 문항 id/보기 불일치가 생기고, (b) 응답
  도중이던 사용자의 자동저장 초안이 깨질 수 있다. 가능하면 접수량이 적은 시간대에
  반영하고, 반영 직후 공개 응답 제출 smoke test를 반드시 수행한다.
- **Quota 이관**: quota shape이 바뀌는 경우(예: 지역+연령 → 연령 전용) 기존
  `quotaCounts`를 0으로 재시작할지, 기존 누적치를 새 shape으로 합산해 이관할지
  운영진이 먼저 결정한다. 이미 접수된 응답 수와 결정한 목표치가 어긋나면 quota
  대시보드 수치가 실제 접수 현황과 맞지 않게 된다.
- 이 절차 자체도 "프로덕션 Firestore 데이터 수정"이므로 코드 작업자가 임의로
  수행하지 않고 운영 승인을 받은 담당자가 수행한다.

## Rollback 기준

다음 중 하나라도 발생하면 즉시 롤백 또는 hotfix를 검토한다.

- 공개 응답 제출 실패
- 관리자 설문 목록 접근 실패
- super_admin 응답 조회 실패
- creator 본인 설문 수정 실패
- staff/viewer private 데이터 노출
- quotaCounts 비정상 증가 또는 감소
- 결과보고서 저장 실패

## Rollback 절차

운영 배포 후 치명적 회귀가 확인되면 아래 순서로 진행한다.

```text
이전 commit 확인
↓
복구 브랜치 또는 hotfix 브랜치 생성
↓
Build
↓
Rules Compile
↓
Hosting Deploy
↓
Smoke Test
↓
운영 확인
```

### Rollback 체크

- 되돌릴 commit이 운영 직전 정상 commit인지 확인한다.
- Firestore rules 변경이 포함됐는지 확인한다.
- 데이터 구조 변경이 있었다면 단순 rollback이 안전한지 확인한다.
- `npm run build`를 실행한다.
- rules 변경이 있으면 dry-run을 실행한다.
- 배포 후 공개 응답 제출과 최근응답을 먼저 확인한다.

## Hotfix 절차

운영 장애는 큰 리팩터링으로 해결하지 않는다. 최소 수정으로 장애를 차단한다.

```text
운영 장애 발생
↓
실패 path와 재현 조건 확보
↓
hotfix 브랜치 생성
↓
최소 수정
↓
Build
↓
Rules Compile
↓
QA
↓
Patch Release
↓
배포
↓
운영 확인
```

### Hotfix 원칙

- 장애와 직접 관련 없는 개선을 포함하지 않는다.
- 권한 장애는 실제 Firestore path를 먼저 확보한다.
- 응답 제출 장애는 `submitSurveyResponse`, `responses`, `quotaCounts`, `responseCount`를 함께 확인한다.
- 보고서 장애는 `survey_reports`, `responses`, DOCX 다운로드를 함께 확인한다.
- hotfix 후 [KNOWN_ISSUES.md](./KNOWN_ISSUES.md)에 원인과 재발방지를 기록한다.
