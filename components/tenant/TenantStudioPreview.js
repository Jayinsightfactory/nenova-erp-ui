import { companyBlockFromTenant, filterMenuForTenant, isFeatureOn } from '../../lib/tenantStudio';

const MOCK_ROWS = [
  { cust: '샘플거래처A', prod: 'ROSE / Freedom', qty: 120, unit: '단' },
  { cust: '샘플거래처B', prod: 'HYDRANGEA / White', qty: 45, unit: '단' },
];

export default function TenantStudioPreview({ tenant }) {
  const b = tenant.branding || {};
  const primary = b.primaryColor || '#1565c0';
  const accent = b.accentColor || '#15803d';
  const company = companyBlockFromTenant(tenant);
  const menuGroups = filterMenuForTenant(tenant);
  const bucket = tenant.industry?.timeBucketLabel || '차수';
  const units = (tenant.industry?.units || []).join(' · ');
  const weekdays = (tenant.industry?.weekdayLabels || []).join(' ');

  return (
    <div style={{
      border: '2px solid #e2e8f0',
      borderRadius: 12,
      overflow: 'hidden',
      background: '#f1f5f9',
      minHeight: 520,
      display: 'flex',
      flexDirection: 'column',
      boxShadow: '0 12px 40px rgba(15,23,42,0.08)',
    }}
    >
      <div style={{ padding: '8px 12px', background: '#0f172a', color: '#94a3b8', fontSize: 11, display: 'flex', justifyContent: 'space-between' }}>
        <span>라이브 미리보기 — {tenant.displayName || tenant.tenantId}</span>
        <span>{tenant.domains?.web || 'https://your-erp.example'}</span>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* 사이드바 */}
        <aside style={{ width: 200, background: '#1e293b', color: '#e2e8f0', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          <div style={{ padding: '14px 12px', borderBottom: '1px solid #334155', display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 32, height: 32, borderRadius: 6, background: primary, display: 'grid', placeItems: 'center', fontSize: 14, fontWeight: 900, color: '#fff' }}>
              {(tenant.displayName || 'E').slice(0, 1)}
            </div>
            <div style={{ fontSize: 12, fontWeight: 800, lineHeight: 1.2 }}>{b.appTitle || 'ERP'}</div>
          </div>
          <nav style={{ flex: 1, overflow: 'auto', padding: '8px 0', fontSize: 11 }}>
            {menuGroups.map((g) => (
              <div key={g.group} style={{ marginBottom: 8 }}>
                <div style={{ padding: '4px 12px', color: '#64748b', fontWeight: 700, fontSize: 10 }}>{g.group}</div>
                {g.items.slice(0, 5).map((item) => (
                  <div
                    key={item.href}
                    style={{
                      padding: '5px 12px 5px 16px',
                      color: item.href === '/estimate' ? '#fff' : '#cbd5e1',
                      background: item.href === '/estimate' ? primary : 'transparent',
                      borderLeft: item.href === '/estimate' ? `3px solid ${accent}` : '3px solid transparent',
                    }}
                  >
                    {item.labelKey}
                  </div>
                ))}
                {g.items.length > 5 && (
                  <div style={{ padding: '2px 16px', color: '#64748b', fontSize: 10 }}>+{g.items.length - 5} 메뉴</div>
                )}
              </div>
            ))}
          </nav>
        </aside>

        {/* 메인 */}
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: '#fff' }}>
          <header style={{ padding: '10px 14px', borderBottom: '1px solid #e2e8f0', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontWeight: 800, fontSize: 14, color: primary }}>견적서 관리</span>
            <span style={{ fontSize: 11, color: '#64748b' }}>{bucket}</span>
            <input readOnly value="26" style={{ width: 36, height: 26, textAlign: 'center', border: `1px solid ${primary}`, borderRadius: 4, fontSize: 12, fontWeight: 700 }} />
            <button type="button" style={{ height: 26, padding: '0 10px', border: 'none', borderRadius: 4, background: accent, color: '#fff', fontSize: 11, fontWeight: 700 }}>
              주문등록+분배
            </button>
            {isFeatureOn(tenant, 'shipmentExeReconcile') && (
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, background: '#dbeafe', color: '#1d4ed8' }}>exe 정합 ON</span>
            )}
            {!tenant.legacyAdapter?.enabled && (
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, background: '#fef3c7', color: '#92400e' }}>웹 단독</span>
            )}
          </header>

          <div style={{ flex: 1, overflow: 'auto', padding: 14, display: 'grid', gap: 12 }}>
            {/* 견적 인쇄 헤더 미리보기 */}
            <section style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, background: '#fafafa' }}>
              <div style={{ fontSize: 10, color: '#64748b', marginBottom: 8 }}>견적서 / 거래명세표 인쇄 헤더</div>
              <div style={{ fontSize: 16, fontWeight: 900, textAlign: 'center', marginBottom: 10, color: primary }}>견 적 서</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 11 }}>
                <div><span style={{ color: '#64748b' }}>수신</span> ○○호텔</div>
                <div><span style={{ color: '#64748b' }}>회사명</span> {company.name}</div>
                <div><span style={{ color: '#64748b' }}>사업자</span> {company.bizNo}</div>
                <div><span style={{ color: '#64748b' }}>주소</span> {company.address}</div>
                <div><span style={{ color: '#64748b' }}>계좌</span> {company.account}</div>
                <div><span style={{ color: '#64748b' }}>TEL/FAX</span> {company.telFax}</div>
              </div>
            </section>

            {/* 주문 UI 스니펫 */}
            <section style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ padding: '8px 10px', background: '#f8fafc', fontSize: 11, fontWeight: 700, color: '#475569' }}>
                {bucket} 피벗 · 단위: {units || '—'} · 출고요일: {weekdays || '—'}
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ background: '#f1f5f9' }}>
                    <th style={{ padding: 6, textAlign: 'left' }}>거래처</th>
                    <th style={{ padding: 6, textAlign: 'left' }}>품목</th>
                    <th style={{ padding: 6 }}>수량</th>
                  </tr>
                </thead>
                <tbody>
                  {MOCK_ROWS.map((r, i) => (
                    <tr key={i} style={{ borderTop: '1px solid #eee' }}>
                      <td style={{ padding: 6 }}>{r.cust}</td>
                      <td style={{ padding: 6 }}>{r.prod}</td>
                      <td style={{ padding: 6, textAlign: 'center', fontWeight: 700, color: primary }}>{r.qty}{r.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            {/* 연동 배지 */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {Object.entries(tenant.integrations || {}).map(([k, v]) => (
                <span
                  key={k}
                  style={{
                    fontSize: 10,
                    padding: '3px 8px',
                    borderRadius: 6,
                    background: v?.enabled !== false ? '#ecfdf5' : '#f1f5f9',
                    color: v?.enabled !== false ? '#047857' : '#94a3b8',
                    border: `1px solid ${v?.enabled !== false ? '#86efac' : '#e2e8f0'}`,
                  }}
                >
                  {k} {v?.enabled !== false ? 'ON' : 'OFF'}
                </span>
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
