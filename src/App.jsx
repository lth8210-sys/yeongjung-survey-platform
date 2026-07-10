import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import AppLayout from './components/AppLayout';
import AdminRoute from './components/AdminRoute';
import HomePage from './pages/HomePage';
import NotFoundPage from './pages/NotFoundPage';
import SurveyListPage from './pages/SurveyListPage';
import SurveyResponsePage from './pages/SurveyResponsePage';

// 관리자 전용 페이지는 lazy load로 분리한다. 공개 응답 페이지(SurveyResponsePage)는
// QR코드로 접속하는 일반 응답자가 가장 많이 쓰는 경로라 관리자 페이지 코드까지
// 함께 받을 이유가 없다 — 위 4개(공개 경로에서 쓰이는 것)만 즉시 로드하고 나머지는
// 실제로 admin 라우트에 진입할 때만 받는다.
const AdminAuditLogsPage = lazy(() => import('./pages/AdminAuditLogsPage'));
const AdminDashboardPage = lazy(() => import('./pages/AdminDashboardPage'));
const AdminSettingsPage = lazy(() => import('./pages/AdminSettingsPage'));
const RecentResponsesPage = lazy(() => import('./pages/RecentResponsesPage'));
const SurveyBuilderPage = lazy(() => import('./pages/SurveyBuilderPage'));
const SurveyPreviewPage = lazy(() => import('./pages/SurveyPreviewPage'));
const SurveyReportPage = lazy(() => import('./pages/SurveyReportPage'));
const SurveyReportsAdminPage = lazy(() => import('./pages/SurveyReportsAdminPage'));
const SurveyResponsesAdminPage = lazy(() => import('./pages/SurveyResponsesAdminPage'));
const SurveyTemplatesAdminPage = lazy(() => import('./pages/SurveyTemplatesAdminPage'));
const UserManagementPage = lazy(() => import('./pages/UserManagementPage'));

function RouteLoadingFallback() {
  return <div className="empty-state">불러오는 중입니다.</div>;
}

function App() {
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <Routes>
        <Route path="surveys/:surveyId" element={<SurveyResponsePage />} />
        <Route path="survey/:surveyId" element={<SurveyResponsePage />} />
        <Route
          path="admin/surveys/:surveyId/report"
          element={
            <AdminRoute>
              <SurveyReportPage />
            </AdminRoute>
          }
        />
        <Route path="/" element={<AppLayout />}>
          <Route index element={<HomePage />} />
          <Route path="surveys" element={<SurveyListPage />} />
          <Route
            path="admin"
            element={
              <AdminRoute>
                <AdminDashboardPage />
              </AdminRoute>
            }
          />
          <Route
            path="admin/surveys"
            element={
              <AdminRoute>
                <SurveyListPage />
              </AdminRoute>
            }
          />
          <Route
            path="admin/responses"
            element={
              <AdminRoute>
                <RecentResponsesPage />
              </AdminRoute>
            }
          />
          <Route
            path="admin/reports"
            element={
              <AdminRoute requireCreate>
                <SurveyReportsAdminPage />
              </AdminRoute>
            }
          />
          <Route
            path="admin/templates"
            element={
              <AdminRoute requireCreate>
                <SurveyTemplatesAdminPage />
              </AdminRoute>
            }
          />
          <Route
            path="admin/surveys/new"
            element={
              <AdminRoute requireCreate>
                <SurveyBuilderPage />
              </AdminRoute>
            }
          />
          <Route
            path="admin/surveys/:surveyId/edit"
            element={
              <AdminRoute requireCreate>
                <SurveyBuilderPage />
              </AdminRoute>
            }
          />
          <Route
            path="admin/surveys/:surveyId/preview"
            element={
              <AdminRoute>
                <SurveyPreviewPage />
              </AdminRoute>
            }
          />
          <Route
            path="admin/surveys/:surveyId/responses"
            element={
              <AdminRoute>
                <SurveyResponsesAdminPage />
              </AdminRoute>
            }
          />
          <Route
            path="admin/users"
            element={
              <AdminRoute requireManageUsers>
                <UserManagementPage />
              </AdminRoute>
            }
          />
          <Route
            path="admin/audit-logs"
            element={
              <AdminRoute requireManageUsers>
                <AdminAuditLogsPage />
              </AdminRoute>
            }
          />
          <Route
            path="admin/settings"
            element={
              <AdminRoute requireSuperAdmin>
                <AdminSettingsPage />
              </AdminRoute>
            }
          />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}

export default App;
