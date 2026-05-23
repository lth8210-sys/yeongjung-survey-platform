import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import SurveyPreviewContent from '../components/SurveyPreviewContent';
import { useAuth } from '../contexts/AuthContext';
import { getManageSurvey } from '../firebase/surveys';

function SurveyPreviewPage() {
  const { user, role } = useAuth();
  const { surveyId } = useParams();
  const navigate = useNavigate();
  const [survey, setSurvey] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadSurvey() {
      try {
        setLoading(true);
        setError('');
        const result = await getManageSurvey(surveyId, {
          uid: user?.uid ?? '',
          email: user?.email ?? '',
          role,
        });
        setSurvey(result);
      } catch (loadError) {
        setError(loadError.message || '미리보기 설문을 불러오지 못했습니다.');
      } finally {
        setLoading(false);
      }
    }

    loadSurvey();
  }, [role, surveyId, user?.email, user?.uid]);

  if (loading) {
    return <div className="empty-state">미리보기 화면을 불러오는 중입니다.</div>;
  }

  if (error) {
    return <div className="empty-state">{error}</div>;
  }

  if (!survey) {
    return <div className="empty-state">설문 정보를 찾을 수 없습니다.</div>;
  }

  return (
    <section className="response-layout preview-layout">
      <div className="panel response-panel preview-panel">
        <SurveyPreviewContent
          survey={survey}
          actions={
            <div className="card-actions">
              <button
                className="primary-button"
                onClick={() => navigate(`/admin/surveys/${surveyId}/edit`)}
                type="button"
              >
                수정 화면으로 돌아가기
              </button>
              <Link className="secondary-button" to={`/admin/surveys/${surveyId}/responses`}>
                응답관리 보기
              </Link>
            </div>
          }
        />
      </div>
    </section>
  );
}

export default SurveyPreviewPage;
