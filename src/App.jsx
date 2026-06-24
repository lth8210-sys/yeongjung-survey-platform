import { Route, Routes } from 'react-router-dom';
import AppLayout from './components/AppLayout';
import AdminRoute from './components/AdminRoute';
import AdminAuditLogsPage from './pages/AdminAuditLogsPage';
import AdminDashboardPage from './pages/AdminDashboardPage';
import AdminSettingsPage from './pages/AdminSettingsPage';
import HomePage from './pages/HomePage';
import NotFoundPage from './pages/NotFoundPage';
import RecentResponsesPage from './pages/RecentResponsesPage';
import SurveyBuilderPage from './pages/SurveyBuilderPage';
import SurveyListPage from './pages/SurveyListPage';
import SurveyPreviewPage from './pages/SurveyPreviewPage';
import SurveyReportPage from './pages/SurveyReportPage';
import SurveyReportsAdminPage from './pages/SurveyReportsAdminPage';
import SurveyResponsesAdminPage from './pages/SurveyResponsesAdminPage';
import SurveyResponsePage from './pages/SurveyResponsePage';
import UserManagementPage from './pages/UserManagementPage';

function App() {
  return (
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
  );
}

export default App;
