import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  deactivateUser,
  deleteMembershipById,
  fetchAllMemberships,
  fetchAllUsers,
  getRoleLabel,
  getUserStatusLabel,
  SUPER_ADMIN_EMAILS,
  updateMembership,
  updateUserProfile,
  upsertMembership,
  USER_ROLES,
  USER_STATUSES,
} from '../firebase/users';

const SORT_OPTIONS = {
  created_desc: '최근 등록순',
  name_asc: '이름순',
  email_asc: '이메일순',
  department_asc: '부서순',
  role_asc: '역할순',
};

function compareUsers(first, second, sortBy) {
  const safeFirstName = String(first.displayName ?? '');
  const safeSecondName = String(second.displayName ?? '');
  const safeFirstEmail = String(first.email ?? '');
  const safeSecondEmail = String(second.email ?? '');
  const safeFirstDepartment = String(first.department ?? '');
  const safeSecondDepartment = String(second.department ?? '');
  const safeFirstRole = getRoleLabel(first.role);
  const safeSecondRole = getRoleLabel(second.role);

  switch (sortBy) {
    case 'name_asc':
      return safeFirstName.localeCompare(safeSecondName, 'ko');
    case 'email_asc':
      return safeFirstEmail.localeCompare(safeSecondEmail, 'ko');
    case 'department_asc':
      return safeFirstDepartment.localeCompare(safeSecondDepartment, 'ko');
    case 'role_asc':
      return safeFirstRole.localeCompare(safeSecondRole, 'ko');
    case 'created_desc':
    default:
      return 0;
  }
}

function filterPeople(items, { searchTerm, roleFilter, departmentFilter, sortBy }) {
  const normalizedSearch = searchTerm.trim().toLowerCase();

  return items
    .filter((item) => {
      const matchesSearch =
        !normalizedSearch ||
        [item.displayName, item.email, item.department]
          .join(' ')
          .toLowerCase()
          .includes(normalizedSearch);
      const matchesRole = !roleFilter || item.role === roleFilter;
      const matchesDepartment = !departmentFilter || item.department === departmentFilter;

      return matchesSearch && matchesRole && matchesDepartment;
    })
    .sort((first, second) => compareUsers(first, second, sortBy));
}

function UserManagementPage() {
  const { canManageUsers, firebaseStatusMessage, isFirebaseConfigured } = useAuth();
  const [users, setUsers] = useState([]);
  const [memberships, setMemberships] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeUserId, setActiveUserId] = useState('');
  const [addingUser, setAddingUser] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [sortBy, setSortBy] = useState('created_desc');
  const [editingUserId, setEditingUserId] = useState('');
  const [editingMembershipId, setEditingMembershipId] = useState('');
  const [editingUserForm, setEditingUserForm] = useState({
    displayName: '',
    department: '',
    role: USER_ROLES.CREATOR,
    status: USER_STATUSES.ACTIVE,
  });
  const [editingMembershipForm, setEditingMembershipForm] = useState({
    displayName: '',
    email: '',
    department: '',
    role: USER_ROLES.CREATOR,
  });
  const [newUser, setNewUser] = useState({
    displayName: '',
    email: '',
    role: USER_ROLES.CREATOR,
    department: '',
  });

  const loadUsers = async () => {
    if (!isFirebaseConfigured) {
      setError(firebaseStatusMessage || 'Firebase 설정이 필요합니다.');
      setLoading(false);
      return;
    }

    if (!canManageUsers) {
      setError('사용자 역할을 관리할 권한이 없습니다.');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError('');
      const [nextUsers, nextMemberships] = await Promise.all([
        fetchAllUsers(),
        fetchAllMemberships(),
      ]);
      setUsers(nextUsers);
      setMemberships(nextMemberships);
    } catch (loadError) {
      setError(loadError.message || '사용자 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, [canManageUsers, firebaseStatusMessage, isFirebaseConfigured]);

  const startEditUser = (item) => {
    setEditingMembershipId('');
    setEditingUserId(item.id);
    setEditingUserForm({
      displayName: item.displayName ?? '',
      department: item.department ?? '',
      role: item.role ?? USER_ROLES.CREATOR,
      status: item.status ?? USER_STATUSES.ACTIVE,
    });
  };

  const startEditMembership = (item) => {
    setEditingUserId('');
    setEditingMembershipId(item.id);
    setEditingMembershipForm({
      displayName: item.displayName ?? '',
      email: item.email ?? '',
      department: item.department ?? '',
      role: item.role ?? USER_ROLES.CREATOR,
    });
  };

  const handleSaveUser = async (userId) => {
    try {
      setActiveUserId(userId);
      await updateUserProfile(userId, editingUserForm);
      await loadUsers();
      setEditingUserId('');
    } catch (actionError) {
      setError(actionError.message || '사용자 수정에 실패했습니다.');
    } finally {
      setActiveUserId('');
    }
  };

  const handleDeactivateUser = async (userId) => {
    if (!window.confirm('정말 삭제하시겠습니까? 실제 로그인 사용자는 비활성화 처리됩니다.')) {
      return;
    }

    try {
      setActiveUserId(userId);
      await deactivateUser(userId);
      await loadUsers();
    } catch (actionError) {
      setError(actionError.message || '사용자 비활성화에 실패했습니다.');
    } finally {
      setActiveUserId('');
    }
  };

  const handleApproveUser = async (item) => {
    try {
      setActiveUserId(item.id);
      await updateUserProfile(item.id, {
        displayName: item.displayName ?? item.name ?? '',
        department: item.department ?? '',
        team: item.team ?? item.department ?? '',
        role: item.role ?? USER_ROLES.VIEWER,
        status: USER_STATUSES.ACTIVE,
      });
      await loadUsers();
    } catch (actionError) {
      setError(actionError.message || '사용자 승인에 실패했습니다.');
    } finally {
      setActiveUserId('');
    }
  };

  const handleAddUser = async (event) => {
    event.preventDefault();

    try {
      setAddingUser(true);
      setError('');
      await upsertMembership(newUser);
      setNewUser({
        displayName: '',
        email: '',
        role: USER_ROLES.CREATOR,
        department: '',
      });
      await loadUsers();
    } catch (actionError) {
      setError(actionError.message || '직원 추가에 실패했습니다.');
    } finally {
      setAddingUser(false);
    }
  };

  const handleSaveMembership = async (membershipId) => {
    try {
      setActiveUserId(membershipId);
      await updateMembership(membershipId, editingMembershipForm);
      await loadUsers();
      setEditingMembershipId('');
    } catch (actionError) {
      setError(actionError.message || '사전 등록 수정에 실패했습니다.');
    } finally {
      setActiveUserId('');
    }
  };

  const handleDeleteMembership = async (membershipId) => {
    if (!window.confirm('정말 삭제하시겠습니까?')) {
      return;
    }

    try {
      setActiveUserId(membershipId);
      await deleteMembershipById(membershipId);
      await loadUsers();
    } catch (actionError) {
      setError(actionError.message || '사전 등록 삭제에 실패했습니다.');
    } finally {
      setActiveUserId('');
    }
  };

  const departmentOptions = useMemo(() => {
    return [...new Set([...users, ...memberships].map((item) => item.department).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, 'ko'),
    );
  }, [memberships, users]);

  const filteredUsers = useMemo(
    () => filterPeople(users, { searchTerm, roleFilter, departmentFilter, sortBy }),
    [departmentFilter, roleFilter, searchTerm, sortBy, users],
  );

  const filteredMemberships = useMemo(
    () => filterPeople(memberships, { searchTerm, roleFilter, departmentFilter, sortBy }),
    [departmentFilter, memberships, roleFilter, searchTerm, sortBy],
  );

  const summary = useMemo(() => {
    const createRoleCounts = (items) =>
      items.reduce(
        (result, item) => {
          result[item.role] = (result[item.role] ?? 0) + 1;
          return result;
        },
        {
          [USER_ROLES.SUPER_ADMIN]: 0,
          [USER_ROLES.ADMIN]: 0,
          [USER_ROLES.CREATOR]: 0,
          [USER_ROLES.VIEWER]: 0,
        },
      );

    return {
      totalUsers: users.length,
      totalMemberships: memberships.length,
      totalDepartments: departmentOptions.length,
      userRoleCounts: createRoleCounts(users),
      membershipRoleCounts: createRoleCounts(memberships),
    };
  }, [departmentOptions.length, memberships.length, users]);

  if (loading) {
    return <div className="empty-state">사용자 목록을 불러오는 중입니다.</div>;
  }

  if (error) {
    return <div className="empty-state">{error}</div>;
  }

  return (
    <section className="stack-section">
      <div className="section-heading">
        <div>
          <span className="eyebrow">사용자 관리</span>
          <h1>직원 역할과 사전 등록 현황을 관리하세요.</h1>
          <p>검색, 부서/팀 필터, 역할 필터로 필요한 직원만 빠르게 찾아볼 수 있습니다.</p>
        </div>
      </div>

      <div className="dashboard-grid dashboard-metrics-grid">
        <article className="dashboard-card metric-card">
          <span className="status-chip published-chip">전체 사용자</span>
          <h2>등록된 직원 수</h2>
          <strong className="metric-value">{summary.totalUsers}명</strong>
          <p>실제로 로그인해 사용자 문서가 생성된 직원 수입니다.</p>
        </article>
        <article className="dashboard-card metric-card">
          <span className="status-chip draft-chip">사전 등록</span>
          <h2>사전 등록 수</h2>
          <strong className="metric-value">{summary.totalMemberships}명</strong>
          <p>첫 로그인 전이라도 역할을 미리 부여한 직원 수입니다.</p>
        </article>
        <article className="dashboard-card metric-card">
          <span className="status-chip published-chip">부서/팀</span>
          <h2>등록된 부서 수</h2>
          <strong className="metric-value">{summary.totalDepartments}개</strong>
          <p>현재 사용자와 사전 등록 목록에 등록된 부서/팀 수입니다.</p>
        </article>
        <article className="dashboard-card metric-card">
          <span className="status-chip published-chip">역할 분포</span>
          <h2>역할별 인원</h2>
          <p>
            실제 사용자: 관리자 {summary.userRoleCounts[USER_ROLES.ADMIN]}명 · 제작자{' '}
            {summary.userRoleCounts[USER_ROLES.CREATOR]}명 · 조회자{' '}
            {summary.userRoleCounts[USER_ROLES.VIEWER]}명
          </p>
          <p>
            사전등록: 관리자 {summary.membershipRoleCounts[USER_ROLES.ADMIN]}명 · 제작자{' '}
            {summary.membershipRoleCounts[USER_ROLES.CREATOR]}명 · 조회자{' '}
            {summary.membershipRoleCounts[USER_ROLES.VIEWER]}명
          </p>
        </article>
      </div>

      <div className="panel response-toolbar">
        <div className="response-toolbar-main">
          <label className="field response-toolbar-search">
            <span>검색</span>
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="이름, 이메일, 부서로 검색"
            />
          </label>

          <label className="field response-toolbar-filter">
            <span>역할</span>
            <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
              <option value="">전체</option>
              <option value={USER_ROLES.SUPER_ADMIN}>슈퍼관리자</option>
              <option value={USER_ROLES.ADMIN}>관리자</option>
              <option value={USER_ROLES.CREATOR}>제작자</option>
              <option value={USER_ROLES.VIEWER}>조회자</option>
            </select>
          </label>

          <label className="field response-toolbar-filter">
            <span>부서/팀</span>
            <select
              value={departmentFilter}
              onChange={(event) => setDepartmentFilter(event.target.value)}
            >
              <option value="">전체</option>
              {departmentOptions.map((department) => (
                <option key={department} value={department}>
                  {department}
                </option>
              ))}
            </select>
          </label>

          <label className="field response-toolbar-filter">
            <span>정렬</span>
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
              {Object.entries(SORT_OPTIONS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="panel survey-config-panel">
        <div className="builder-header-row">
          <h2>직원 추가</h2>
        </div>

        <form className="builder-form" onSubmit={handleAddUser}>
          <label className="field">
            <span>이름</span>
            <input
              type="text"
              value={newUser.displayName}
              onChange={(event) =>
                setNewUser((current) => ({ ...current, displayName: event.target.value }))
              }
              placeholder="예: 홍길동"
            />
          </label>

          <label className="field">
            <span>이메일</span>
            <input
              type="email"
              value={newUser.email}
              onChange={(event) =>
                setNewUser((current) => ({ ...current, email: event.target.value }))
              }
              placeholder="예: user@yeongjung.or.kr"
            />
          </label>

          <label className="field">
            <span>역할</span>
            <select
              value={newUser.role}
              onChange={(event) =>
                setNewUser((current) => ({ ...current, role: event.target.value }))
              }
            >
              <option value={USER_ROLES.ADMIN}>관리자</option>
              <option value={USER_ROLES.CREATOR}>제작자</option>
              <option value={USER_ROLES.VIEWER}>조회자</option>
            </select>
          </label>

          <label className="field">
            <span>부서/팀</span>
            <input
              type="text"
              value={newUser.department}
              onChange={(event) =>
                setNewUser((current) => ({ ...current, department: event.target.value }))
              }
              placeholder="예: 서비스제공연계팀"
            />
          </label>

          <div className="builder-footer">
            <button className="primary-button" disabled={addingUser} type="submit">
              {addingUser ? '저장 중...' : '직원 추가'}
            </button>
          </div>
        </form>
      </div>

      <div className="panel">
        <div className="builder-header-row">
          <h2>등록된 직원</h2>
          <p className="meta-description">현재 필터 기준 {filteredUsers.length}명</p>
        </div>
        <div className="response-table-wrapper">
          <table className="response-table">
            <thead>
              <tr>
                <th>이름</th>
                <th>이메일</th>
                <th>부서</th>
                <th>현재 역할</th>
                <th>상태</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((item) => {
                const isFixedSuperAdmin = SUPER_ADMIN_EMAILS.includes(item.email);

                return (
                  <tr key={item.id}>
                    <td>{item.displayName || '이름 없음'}</td>
                    <td>{item.email}</td>
                    <td>{item.department || '-'}</td>
                    <td>{getRoleLabel(item.role)}</td>
                    <td>{getUserStatusLabel(item.status)}</td>
                    <td>
                      {isFixedSuperAdmin ? (
                        <span>고정 슈퍼관리자</span>
                      ) : editingUserId === item.id ? (
                        <div className="builder-form">
                          <label className="field">
                            <span>이름</span>
                            <input
                              type="text"
                              value={editingUserForm.displayName}
                              onChange={(event) =>
                                setEditingUserForm((current) => ({
                                  ...current,
                                  displayName: event.target.value,
                                }))
                              }
                            />
                          </label>
                          <label className="field">
                            <span>부서/팀</span>
                            <input
                              type="text"
                              value={editingUserForm.department}
                              onChange={(event) =>
                                setEditingUserForm((current) => ({
                                  ...current,
                                  department: event.target.value,
                                }))
                              }
                            />
                          </label>
                          <label className="field">
                            <span>역할</span>
                            <select
                              value={editingUserForm.role}
                              onChange={(event) =>
                                setEditingUserForm((current) => ({
                                  ...current,
                                  role: event.target.value,
                                }))
                              }
                            >
                              <option value={USER_ROLES.ADMIN}>관리자</option>
                              <option value={USER_ROLES.CREATOR}>제작자</option>
                              <option value={USER_ROLES.VIEWER}>조회자</option>
                            </select>
                          </label>
                          <label className="field">
                            <span>상태</span>
                            <select
                              value={editingUserForm.status}
                              onChange={(event) =>
                                setEditingUserForm((current) => ({
                                  ...current,
                                  status: event.target.value,
                                }))
                              }
                            >
                              <option value={USER_STATUSES.ACTIVE}>활성</option>
                              <option value={USER_STATUSES.PENDING}>승인 대기</option>
                              <option value={USER_STATUSES.INACTIVE}>비활성</option>
                              <option value={USER_STATUSES.BLOCKED}>차단</option>
                            </select>
                          </label>
                          <div className="card-actions">
                            <button
                              className="secondary-button"
                              disabled={activeUserId === item.id}
                              onClick={() => handleSaveUser(item.id)}
                              type="button"
                            >
                              저장
                            </button>
                            <button className="text-button" onClick={() => setEditingUserId('')} type="button">
                              취소
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="card-actions">
                          {item.status === USER_STATUSES.PENDING && (
                            <button
                              className="secondary-button"
                              disabled={activeUserId === item.id}
                              onClick={() => handleApproveUser(item)}
                              type="button"
                            >
                              승인
                            </button>
                          )}
                          <button className="secondary-button" onClick={() => startEditUser(item)} type="button">
                            수정
                          </button>
                          <button
                            className="text-button danger-text"
                            disabled={activeUserId === item.id}
                            onClick={() => handleDeactivateUser(item.id)}
                            type="button"
                          >
                            삭제
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan="6">조건에 맞는 사용자가 없습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="builder-header-row">
          <h2>사전 등록 목록</h2>
          <p className="meta-description">현재 필터 기준 {filteredMemberships.length}명</p>
        </div>
        {filteredMemberships.length === 0 ? (
          <div className="empty-state compact-state">조건에 맞는 사전 등록 직원이 없습니다.</div>
        ) : (
          <div className="response-table-wrapper">
            <table className="response-table">
              <thead>
                <tr>
                  <th>이름</th>
                  <th>이메일</th>
                  <th>부서</th>
                  <th>역할</th>
                  <th>가입 상태</th>
                  <th>관리</th>
                </tr>
              </thead>
              <tbody>
                {filteredMemberships.map((item) => (
                  <tr key={item.id}>
                    <td>{item.displayName || '이름 없음'}</td>
                    <td>{item.email}</td>
                    <td>{item.department || '-'}</td>
                    <td>{getRoleLabel(item.role)}</td>
                    <td>
                      {item.isJoined
                        ? item.linkedUserStatus === 'inactive'
                          ? '가입됨 · 비활성'
                          : '가입 완료'
                        : '사전 등록'}
                    </td>
                    <td>
                      {editingMembershipId === item.id ? (
                        <div className="builder-form">
                          <label className="field">
                            <span>이름</span>
                            <input
                              type="text"
                              value={editingMembershipForm.displayName}
                              onChange={(event) =>
                                setEditingMembershipForm((current) => ({
                                  ...current,
                                  displayName: event.target.value,
                                }))
                              }
                            />
                          </label>
                          <label className="field">
                            <span>이메일</span>
                            <input
                              type="email"
                              value={editingMembershipForm.email}
                              onChange={(event) =>
                                setEditingMembershipForm((current) => ({
                                  ...current,
                                  email: event.target.value,
                                }))
                              }
                            />
                          </label>
                          <label className="field">
                            <span>부서/팀</span>
                            <input
                              type="text"
                              value={editingMembershipForm.department}
                              onChange={(event) =>
                                setEditingMembershipForm((current) => ({
                                  ...current,
                                  department: event.target.value,
                                }))
                              }
                            />
                          </label>
                          <label className="field">
                            <span>역할</span>
                            <select
                              value={editingMembershipForm.role}
                              onChange={(event) =>
                                setEditingMembershipForm((current) => ({
                                  ...current,
                                  role: event.target.value,
                                }))
                              }
                            >
                              <option value={USER_ROLES.ADMIN}>관리자</option>
                              <option value={USER_ROLES.CREATOR}>제작자</option>
                              <option value={USER_ROLES.VIEWER}>조회자</option>
                            </select>
                          </label>
                          <div className="card-actions">
                            <button
                              className="secondary-button"
                              disabled={activeUserId === item.id}
                              onClick={() => handleSaveMembership(item.id)}
                              type="button"
                            >
                              저장
                            </button>
                            <button className="text-button" onClick={() => setEditingMembershipId('')} type="button">
                              취소
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="card-actions">
                          <button className="secondary-button" onClick={() => startEditMembership(item)} type="button">
                            수정
                          </button>
                          <button
                            className="text-button danger-text"
                            disabled={activeUserId === item.id}
                            onClick={() => handleDeleteMembership(item.id)}
                            type="button"
                          >
                            삭제
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

export default UserManagementPage;
