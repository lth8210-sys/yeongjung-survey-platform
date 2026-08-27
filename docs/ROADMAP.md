# Roadmap

영중폼은 이미 운영 중인 시스템이다. 로드맵은 새 기능보다 운영 안정성과 회귀 방지를 우선한다.

## v1.0.x 운영 안정화

목표: 운영 중인 핵심 기능을 안정화한다.

- permission-denied 재발 방지
- creator 권한 안정화
- staff/viewer organization 조회 안정화
- 최근응답 조회 안정화
- 결과보고서 권한 안정화
- quota 제출과 count 안정화
- 감사로그 실패가 화면을 막지 않도록 유지
- QA 문서와 운영 문서 정비

## v1.1.x 운영 편의

목표: 기존 데이터 구조를 유지하면서 운영자 편의를 개선한다.

- 다운로드 편의 개선
- 결과보고서 작성 편의 개선
- 공유 기능 개선
- 템플릿 관리 편의 개선
- 관리자 화면 안내 문구 정리
- 오류 메시지와 진단 로그 개선

## 구현됨 — 내부 직원 의견 보내기 1차

로그인하고 활성화된 내부 직원이 오류·개선 제안·사용 문의를 서비스 안에서 전달할 수 있다.
주민 공개 응답 화면에는 제공하지 않으며, Storage 정책과 기관 카드 미등록 상태를 고려해
이미지·문서 첨부는 포함하지 않는다.

### 현재 1차 범위

- 대상: users 문서가 있고 active 상태인 `super_admin`, `admin`, `creator`, `viewer`
- 유형: 오류 신고, 개선 제안, 사용 문의, 기타
- 내용: 필수 입력 및 개인정보 입력 금지 안내
- 자동 기록: 현재 route, page name, 설문 화면이면 `surveyId`, app version/release, 제출자 UID·이름,
  생성 시각
- 상태: `received`(접수), `reviewing`(확인 중), `completed`(완료)
- 화면: 내가 보낸 의견 조회(`/feedback`)와 관리자 의견 관리(`/admin/feedback`)
- 금지: 현재 설문의 응답 원문이나 PII 자동 복제
- 권한: 일반 직원은 자기 의견만 조회하며, `admin`/`super_admin`만 전체 조회 및
  `received → reviewing → completed` 상태 변경을 할 수 있음

### 데이터 계약

컬렉션은 `feedback/{feedbackId}`다.

```text
type: bug | suggestion | question | other
content: string
status: received | reviewing | completed
createdByUid: string
createdByName: string
surveyId: string | null
route: string
pageName: string
appVersion: string
createdAt: timestamp
updatedAt: timestamp
```

### 다음 개발 순서

의견 보내기 1차 이후에는 다음 순서를 권장한다.

1. Viewer — 결과 같이 보기
2. Owner 인수인계
3. 필요성이 확인된 경우에만 Editor

## v1.2.x Draft 저장 / Publish 구조 준비

목표: 운영 설문과 편집 중 설문을 안전하게 분리할 준비를 한다.

- Draft 저장 정책 정리
- Publish 버튼 정책 정리
- 기존 공개 설문 호환성 검증
- 응답 중인 설문 수정 위험 최소화
- QA 체크리스트 확장
- 운영자 교육 문서 작성

## v1.3.x Versioning

목표: 운영 중 수정과 응답 버전관리를 분리한다.

- 설문 게시 버전 관리
- 응답 `submittedVersion` 기록
- 버전별 통계 계산 정책
- 버전별 보고서 정책
- 이전 버전 응답 다운로드 정책
- Draft/Publish와 Versioning 통합 QA

## v2.0 Draft + Publish + Version 운영 안정화

목표: AI 도움 없이도 운영자가 안정적으로 관리할 수 있는 플랫폼으로 전환한다.

- Draft + Publish 정식 운영
- Versioning 정식 운영
- 운영 중 수정 안정화
- 권한과 query 설계 문서 완성
- 장애 대응 runbook 완성
- 운영자 self-service 문서 완성

## 우선순위 원칙

1. 공개 응답 제출 안정성
2. 관리자 권한과 응답 조회 안정성
3. quota와 보고서 정확성
4. 다운로드 신뢰성
5. 운영 편의 기능
6. 신규 기능
