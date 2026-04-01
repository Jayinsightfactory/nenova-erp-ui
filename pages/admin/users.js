import { useState, useEffect } from 'react';
import { apiGet } from '../../lib/useApi';
import { useLang } from '../../lib/i18n';

const AUTH_MAP = { 1: { label: '관리자', color: 'badge-red' }, 2: { label: '영업지원', color: 'badge-blue' }, 3: { label: '경영지원', color: 'badge-purple' }, 4: { label: '수입부', color: 'badge-amber' }, 5: { label: '현장팀', color: 'badge-green' }, 6: { label: '영업부', color: 'badge-blue' }, 7: { label: '수입부(관리)', color: 'badge-amber' } };

export default function Users() {
  const { t } = useLang();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    apiGet('/api/master', { entity: 'users' })
      .then(d => { setUsers(d.data || []); setErr(''); })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div style={{ background: 'var(--amber-bg)', border: '1px solid #FDE68A', borderRadius: 8, padding: '10px 16px', marginBottom: 14, fontSize: 13, color: 'var(--amber)' }}>
        🔒 사용자 관리는 <strong>관리자(1등급)</strong>만 접근할 수 있습니다.
      </div>
      <div className="card">
        <div className="card-header"><span className="card-title">사용자 목록</span><span style={{ fontSize: 12, color: 'var(--text3)' }}>{users.length}명</span></div>
        {err ? (
          <div className="empty-state"><div className="empty-icon">🔒</div><div className="empty-text">{err}</div></div>
        ) : loading ? <div className="skeleton" style={{ margin: 16, height: 300, borderRadius: 8 }}></div> : (
          <table className="tbl">
            <thead><tr><th>아이디</th><th>이름</th><th>부서</th><th>권한</th><th>이메일</th><th>전화</th></tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.UserID}>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{u.UserID}</td>
                  <td className="name">{u.UserName}</td>
                  <td style={{ fontSize: 12 }}>{u.DeptName}</td>
                  <td><span className={`badge ${AUTH_MAP[u.Authority]?.color || 'badge-gray'}`}>{AUTH_MAP[u.Authority]?.label}</span></td>
                  <td style={{ fontSize: 11, color: 'var(--text3)' }}>{u.Email || '—'}</td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{u.Phone || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
