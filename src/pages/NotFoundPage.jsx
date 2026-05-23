import { Link } from 'react-router-dom';

function NotFoundPage() {
  return (
    <section className="empty-state">
      <h1>페이지를 찾을 수 없습니다.</h1>
      <p>주소를 다시 확인하거나 아래 메뉴로 이동해주세요.</p>
      <div className="card-actions">
        <Link className="primary-button" to="/">
          홈으로 가기
        </Link>
        <Link className="secondary-button" to="/admin/surveys">
          설문 목록 보기
        </Link>
        <Link className="secondary-button" to="/admin/surveys/new">
          새 폼 만들기
        </Link>
      </div>
    </section>
  );
}

export default NotFoundPage;
