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
