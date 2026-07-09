# 영중폼 현재 운영 상태

최종 업데이트: 2026-07-09
운영 기준: v0.36

## 1. 서비스 개요

영중폼은 영중종합사회복지관의 설문 수집, 응답 관리, 통계 분석, 결과보고서 작성 및 배포를 지원하는 내부 운영 플랫폼입니다.

현재 지원 흐름은 다음과 같습니다.

> 설문 또는 템플릿 생성 → 공개 응답 수집 → 응답 관리 → 통계 분석 → 결과보고서 생성·수정·저장 → Word/PDF/Excel 활용 → 감사로그 확인

### 운영 원칙

- Gemini, OpenAI 등 외부 AI API를 사용하지 않습니다.
- 자유의견 분석과 보고서 자동문은 규칙 기반으로 생성합니다.
- 원본 응답과 원본 자유의견은 보고서 편집으로 변경되지 않습니다.
- CSV 원본 데이터는 분석용 정규화의 영향을 받지 않습니다.
- Word와 통계 Excel은 브라우저에서 생성하며 별도 변환 서버를 사용하지 않습니다.

## 2. 기술 및 배포 구성

- Frontend: React 19, React Router, Vite
- Backend: Firebase Authentication, Cloud Firestore
- Hosting: Firebase Hosting
- Word 생성: `docx`, `file-saver`
- Excel 생성: `exceljs`, `file-saver`
- Hosting 산출물: `dist/`
- Firestore 규칙: `firestore.rules`
- Firestore 인덱스: `firestore.indexes.json`
- Firebase 프로젝트: `yeongjung-survey-platform`
- 운영 URL: <https://yeongjung-survey-platform.web.app>

`package.json`의 애플리케이션 버전은 현재 `0.1.0`이며, v0.35는 운영 기능 단계 명칭입니다.

## 3. 사용자 역할

| 역할 | 주요 권한 |
| --- | --- |
| `super_admin` | 전체 설문·응답·보고서 관리, 사용자 관리, 감사로그, 관리자 설정 |
| `admin` | 전체 설문·응답·보고서 관리, 사용자 관리, 감사로그 |
| `creator` | 본인이 소유한 설문·응답·보고서 생성 및 관리 |
| `viewer` | 허용된 관리 화면 조회 중심, 보고서 저장·관리 제한 |

- Firestore 사용자 문서는 `users/{uid}`를 사용합니다.
- 한국어 역할값 `슈퍼관리자`, `관리자`, `제작자`, `조회자`도 rules에서 표준 역할값으로 정규화합니다.
- 슈퍼관리자 이메일 목록은 `firestore.rules`와 `src/firebase/users.js`에서 동일하게 유지해야 합니다.
- 사내 계정은 `@yeongjung.or.kr` 도메인을 기준으로 판정합니다.

## 4. 관리자 메뉴와 경로

| 메뉴 | 경로 | 사용 권한 | 용도 |
| --- | --- | --- | --- |
| 설문 관리 | `/admin/surveys` | 관리자 접근 가능 사용자 | 설문 목록, 상태 확인, 편집, 미리보기 |
| 새 폼 만들기 | `/admin/surveys/new` | `creator` 이상 | 신규 설문 생성 |
| 설문 템플릿 관리 | `/admin/templates` | `creator` 이상 | 템플릿 검색·사용·복제, 관리자 수정·비활성화 |
| 응답 관리 | `/admin/responses` | 관리자 접근 가능 사용자 | 최근 응답 조회 |
| 설문별 응답 관리 | `/admin/surveys/{surveyId}/responses` | 해당 설문 관리 권한 | 응답 처리, 분석, 다운로드, 보고서 생성 |
| 결과보고서 관리 | `/admin/reports` | `creator` 이상 | 저장된 보고서 검색·열기·다운로드·복제·삭제 |
| 사용자 관리 | `/admin/users` | `admin` 이상 | 내부 사용자 역할 및 상태 관리 |
| 감사로그 | `/admin/audit-logs` | `admin` 이상 | 관리자 활동 조회 및 필터 |
| 관리자 설정 | `/admin/settings` | `super_admin` | 최고 관리자 설정 |

공개 응답 경로는 `/surveys/{surveyId}`이며, 기존 호환 경로 `/survey/{surveyId}`도 유지합니다.

## 5. 현재 주요 기능

### 설문

- 설문 생성, 편집, 미리보기 및 공개
- 빈 설문 또는 Firestore 템플릿으로 새 설문 생성
- 기존 설문의 구조를 응답 데이터 없이 템플릿으로 저장
- 템플릿 검색, 분류 필터, 복제 및 soft disable
- 객관식, 다중선택, 단답형, 장문형 등 문항 지원
- 필수 응답과 개인정보 동의 처리
- 공개 기간, 마감 및 정원 관련 상태 처리
- 템플릿과 레거시 문항 타입 정규화

### 응답 관리

- 설문별 응답 목록과 최근 응답 조회
- 처리 상태 변경 및 관리자 메모
- 응답 검색과 상태 필터
- 개인정보 문항 익명화
- 응답 soft delete
- 원본형, 명단형, 슬롯형 CSV 다운로드
- 통계 Excel 다운로드
- 만족도, 응답자 특성, 자유의견 분석

삭제된 응답은 `deleted: true`와 관련 필드로 관리하며 기본 목록, 통계 및 다운로드에서 제외됩니다. 원본 문서를 실제 삭제하지 않습니다.

### 결과보고서

- 응답 관리 화면에서 보고서 설정 후 새 탭으로 생성
- 표지, 목차, 조사 개요, 응답자 특성, 만족도 분석, 자유의견, 종합 요약 구성
- 보고문 편집 및 Firestore 저장
- 저장본 우선 로드
- 규칙 기반 자유의견 다중 분류와 대표 의견 선정
- 규칙 기반 종합 요약 및 개선방향 생성
- 브라우저 인쇄/PDF 저장
- 편집 가능한 Word 문서 다운로드
- 저장된 보고서 검색, 복제 및 soft delete

세부 사용법과 데이터 구조는 [REPORT_FEATURES.md](./REPORT_FEATURES.md)를 참고합니다.

### 통계 Excel

응답 관리 화면의 `통계 Excel 다운로드` 버튼으로 다음 시트를 포함한 `.xlsx` 파일을 생성합니다.

1. 설문 개요
2. 응답 원본
3. 객관식 빈도분석
4. 만족도 분석
5. 응답자 특성
6. 자유의견 분석
7. 종합요약

## 6. 주요 Firestore 컬렉션

| 컬렉션 | 용도 |
| --- | --- |
| `users` | 내부 사용자 역할과 상태 |
| `memberships` | 내부 사용자 가입 및 역할 연결 |
| `surveys` | 설문 정의와 운영 상태 |
| `responses` | 설문 응답 및 처리 정보 |
| `survey_reports` | 결과보고서 설정, 편집 문구, 복제본, 삭제 상태 |
| `survey_templates` | 재사용 가능한 설문 구조와 운영 설정 |
| `audit_logs` | 관리자 활동 기록 |

## 7. 현재 운영상 주의사항

- Hosting 배포만으로 Firestore rules는 반영되지 않습니다.
- `/admin/reports` 또는 감사로그에서 `permission-denied`가 발생하면 운영 rules 배포 상태를 먼저 확인합니다.
- 관리자 전체 목록 조회와 달리 `creator`의 보고서 조회는 보고서 `surveyId`와 본인 소유 설문이 일치해야 합니다.
- 기존 보고서 문서에 `deleted`가 없어도 관리자 조회는 허용되며 화면에서는 삭제되지 않은 문서로 처리합니다.
- 보고서 상태는 `draft`와 `final`을 지원하지만 현재 일반 저장은 기본적으로 `draft`입니다.
- PDF의 날짜, URL, 페이지 번호는 브라우저 자체 머리글·바닥글입니다. 인쇄 설정에서 해제해야 합니다.
- 보고서와 Excel의 프로그램명 정규화는 분석 화면에만 적용되고 원본 응답과 CSV는 변경하지 않습니다.
- `src/firebase/surveys.js`와 주요 보고서·응답 페이지는 영향 범위가 넓으므로 변경 후 빌드와 실데이터 검증이 필요합니다.
- 템플릿은 저장 시점의 독립 스냅샷입니다. 원 설문과 템플릿을 이후 수정해도 서로 자동 동기화되지 않습니다.
- Quota는 2026-07부터 연령대 전용입니다. 지역(권역) quota는 폐지되었습니다 — Q1 거주지 문항이
  행정동 선택형에서 주소 자유 입력형으로 바뀌며 응답값을 권역으로 자동 매핑할 수 없기 때문입니다.
  `resolveAgeQuota`/`buildAgeQuotaDashboard`(`src/firebase/surveys.js`) 및
  `quotaConfig.targets`/`quotaCounts.cells`(연령대 flat 구조, [docs/DATA_SCHEMA.md](../docs/DATA_SCHEMA.md) 참고)를 사용합니다.
- "2026 영중 지역주민 욕구조사" 템플릿(Q1 주소, Q45→Q46 세대별 조건부 표시 등)은 코드
  저장소(`src/data/formTemplates.js`)에만 반영되어 있으며, 이미 운영 중인 라이브 Firestore
  설문 문서는 별도로 갱신해야 합니다 — [docs/KNOWN_ISSUES.md](../docs/KNOWN_ISSUES.md)의 KI-013 참고.

## 8. 현재 확인된 제한 및 후속 과제

- 감사로그 화면에 매핑되지 않은 과거 action은 영문 action 값으로 보일 수 있습니다.
- 로그인·로그아웃 및 모든 설문 CRUD가 현재 감사로그 action 목록에 포함되는 것은 아닙니다.
- 결과보고서 `final` 전환을 위한 별도 승인 UI는 아직 제공하지 않습니다.
- 대량 응답의 Word/Excel 생성은 브라우저 메모리와 기기 성능에 영향을 받을 수 있습니다.
- 운영 데이터 마이그레이션이나 Firestore 컬렉션 대개편은 현재 범위에서 제외합니다.
- "2026 영중 지역주민 욕구조사" 라이브 설문 문서와 quotaConfig/quotaCounts를 새 구조(주소
  자유입력, 연령대 전용 quota)로 이관하는 작업이 아직 남아 있습니다(KI-013).

## 9. 관련 문서

- [OPERATIONS.md](./OPERATIONS.md): 일상 운영, 배포, 장애 대응
- [REPORT_FEATURES.md](./REPORT_FEATURES.md): 결과보고서와 통계 Excel 상세
- [AUDIT_LOGS.md](./AUDIT_LOGS.md): 감사로그 구조, action, 권한 및 오류 대응
- [ARCHITECTURE.md](./ARCHITECTURE.md): 기존 시스템 구조
- [AI_HANDOFF.md](./AI_HANDOFF.md): 개발 작업 인수인계
