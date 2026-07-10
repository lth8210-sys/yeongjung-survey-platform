# Change Impact Matrix

어느 파일이나 함수 하나를 수정했을 때 어디까지 회귀 위험이 퍼지는지 빠르게 확인하기 위한 문서다.

| 변경 대상 | 직접 영향 | 간접 영향 | 반드시 확인 |
| --- | --- | --- | --- |
| `submitSurveyResponse()` | `responses` 생성 | quotaCounts, responseCount, 최근응답, 통계, CSV, Excel, DOCX, 보고서 | 공개 제출, quota 제출 |
| `deleteSurveyResponse()` | 응답 삭제 상태 | quotaCounts 감소, 통계, Excel, 보고서 | 삭제 후 count 음수 방지 |
| `createSurvey()` | `surveys` 생성 | quotaConfig, quotaCounts, 템플릿, 설문 목록 | 새 설문 생성 |
| `updateSurvey()` | 설문 수정 | 공개 응답, 통계, 보고서, 다운로드 | 기존 응답 있는 설문 수정 |
| `changeSurveyStatus()` | 게시/마감 | 공개 접근, 응답 제출 | draft/published/closed |
| `duplicateSurvey()` | 설문 복제 | 템플릿, quota 설정 | 복제본 응답 수 0 |
| `deleteSurvey()` | 설문 삭제 | responses 표시, 보고서, 목록 | 삭제 설문 응답 보존 |
| `restoreSurvey()` | 설문 복구 | 목록, 응답관리 | 삭제/복구 표시 |
| `fetchManagedSurveys()` | 설문 목록 | 응답관리, 보고서, 대시보드 | role별 목록 |
| `fetchPublishedSurveys()` | 공개 목록 | 비로그인 접근 | 공개 설문 표시 |
| `fetchSurveyById()` | 단일 설문 | 응답 페이지, 수정, 보고서 | 권한과 quota subdoc |
| `subscribePublicSurvey()` | 공개 응답 화면 | 실시간 상태, 마감 처리 | 공개/마감 설문 |
| `fetchManagedRecentResponses()` | 최근응답 | 대시보드, 권한 | super_admin/admin/creator/staff |
| `fetchRecentResponses()` | 전체 최근응답 | admin 대시보드 | 전체 responses 권한 |
| `fetchResponsesBySurveyId()` | 설문별 응답 | pagination, CSV, Excel | surveyId query |
| `fetchResponsesForSurvey()` | 응답 관리 | deleted survey fallback | 설문 삭제 후 응답 |
| `fetchAllResponsesForSurveyExport()` | 전체 내보내기 | CSV, Excel, 보고서 | 큰 응답 수 성능 |
| `hydrateSurveyResponseCounts()` | 설문 목록 count | 대시보드 표시 | 응답 수 표시 |
| `buildSurveyAnalytics()` | 통계 | 보고서, Excel, 화면 요약 | 객관식/척도/서술형, 예외 발생 시 `SurveyReportPage`가 흰 화면으로 죽지 않는지(2026-07 안전망 추가) |
| `buildAgeQuotaDashboard()` | quota dashboard | 부족 현황 공유 | 연령대 목표(2026-07부터 지역 quota 폐지, 연령 전용) |
| `resolveAgeQuota()` | quota 매칭 | 제출 차단, count 증가 | 생년 응답(2026-07부터 지역 응답 매칭 없음) |
| `buildVisibleQuestionFlow()` question-level `visibilityConditions` | 문항 단위 조건부 표시 | 진행률, 제출 payload, 결과보고 문항 매핑 | 숨겨진 문항이 통계/보고서 집계에서 안전하게 제외되는지(질문 id 불일치 포함) |
| `applyTemplate()`(SurveyBuilderPage), `duplicateSection()`(SurveyBuilderPage) | 문항 ID 재발급 | branching, visibilityConditions, meta.conditionalConsentField, templateMetadata 등 문항 ID를 참조하는 모든 필드 | remap 누락 시 조건부 표시·조건부 동의가 새 ID로 저장된 설문에서 silently 깨짐(KI-016) — `remapStructureIds()`를 거치지 않는 새 ID 재발급 지점을 추가하지 않는다 |
| `saveSurveyReport()` | 보고서 저장 | survey_reports, audit_logs | 보고서 저장/재열람 |
| `fetchSurveyReport()` | 보고서 열람 | 인쇄, DOCX | reportId/surveyId 일치 |
| `fetchManagedSurveyReports()` | 보고서 목록 | 권한, 목록 화면 | surveyId별 report query |
| `copySurveyReport()` | 보고서 복제 | 목록, 저장본 | 복제본 작성자 |
| `softDeleteSurveyReport()` | 보고서 삭제 | 목록 필터 | deleted 처리 |
| `buildReportDocx()` | DOCX 생성 | 다운로드, 보고서 품질 | 파일 열림 확인 |
| `downloadBlob()` | 파일 저장 | CSV/Excel/DOCX | 브라우저 다운로드 |
| `fetchSurveyTemplates()` | 템플릿 목록 | 새 폼 만들기 | active/inactive 권한 |
| `createSurveyTemplate()` | 템플릿 생성 | 설문 복제, 새 폼 | surveyData 보존 |
| `incrementSurveyTemplateUsage()` | 템플릿 사용 횟수 | 템플릿 목록 | creator 권한 |
| `normalizeSurveyStatus()` | 상태 판정 | 공개 조회, 제출 가능 여부 | draft/published/closed |
| `normalizeSurveyVisibility()` | 공개 범위 | staff/viewer 조회 | private/organization |
| `canManageAllSurveys()` | admin 판정 | 전체 조회 권한 | super_admin/admin |
| `canReadManagedSurvey()` | 설문 읽기 | 목록, 응답, 보고서 | role별 접근 |
| `getFirestoreErrorMessage()` | 오류 표시 | 운영자 대응 | permission-denied 메시지 |
| `logger` | 운영 로그 | path 마스킹, DEV 진단 | DEV path / PROD masking |
| `SurveyResponsePage` | 공개 응답 UI | 제출, autosave, quota | 모바일 제출 |
| `SurveyBuilderPage` | 설문 편집 UI | questions, sections, publish | 기존 응답 호환 |
| `SurveyResponsesAdminPage` | 응답 관리 UI | 통계, 삭제, 다운로드 | role별 응답 접근 |
| `SurveyReportsAdminPage` | 보고서 목록 UI | survey_reports query | creator/private 차단 |
| `SurveyTemplatesAdminPage` | 템플릿 관리 UI | survey_templates rules | active/inactive |
| `AppLayout` | 상단 메뉴 | active 상태, 이동 | 메뉴 하나만 active |
| `firestore.rules` responses | 응답 권한 | 최근응답, 설문별 응답 | 전체 list 금지 |
| `firestore.rules` survey_reports | 보고서 권한 | 결과보고서 목록 | surveyId 기반 조회 |
| `firestore.rules` quotaCounts | quota 제출 | count 증가/감소 | 제출 트랜잭션 |
