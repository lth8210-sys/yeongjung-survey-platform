import { Link } from 'react-router-dom';

function AdminSettingsPage() {
  return (
    <section className="stack-section">
      <div className="section-heading">
        <div>
          <span className="eyebrow">관리자 설정</span>
          <h1>시스템 설정</h1>
          <p>사용자 권한, 운영 도구, 시스템 점검 메뉴를 한 곳에서 확인하세요.</p>
        </div>
      </div>

      <div className="home-shortcut-grid settings-grid">
        <Link className="home-shortcut-card home-shortcut-card-link" to="/admin/users">
          <strong>사용자 관리</strong>
          <p>직원 권한과 사전 등록 현황을 관리합니다.</p>
        </Link>
        <Link className="home-shortcut-card home-shortcut-card-link" to="/admin/responses">
          <strong>응답 관리</strong>
          <p>최근 응답과 처리 대기 건을 빠르게 확인합니다.</p>
        </Link>
        <Link className="home-shortcut-card home-shortcut-card-link" to="/admin/surveys">
          <strong>설문 운영</strong>
          <p>설문 상태 변경과 응답 현황을 확인합니다.</p>
        </Link>
        <Link className="home-shortcut-card home-shortcut-card-link" to="/admin/audit-logs">
          <strong>감사로그</strong>
          <p>관리자 주요 활동 기록을 확인합니다.</p>
        </Link>
      </div>
    </section>
  );
}

export default AdminSettingsPage;
