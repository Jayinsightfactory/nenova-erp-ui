import { useEffect, useMemo, useState } from 'react';
import Layout from '../../components/Layout';

const fmtDate = v => {
  if (!v) return '-';
  try { return new Date(v).toLocaleString('ko-KR'); } catch { return v; }
};

const badgeStyle = (type) => ({
  display: 'inline-flex',
  alignItems: 'center',
  height: 22,
  padding: '0 8px',
  borderRadius: 11,
  fontSize: 11,
  fontWeight: 700,
  background: type === 'ok' ? '#e8f5e9' : type === 'warn' ? '#fff3e0' : type === 'bad' ? '#ffebee' : '#eef2f7',
  color: type === 'ok' ? '#1b5e20' : type === 'warn' ? '#e65100' : type === 'bad' ? '#b71c1c' : '#334155',
  border: `1px solid ${type === 'ok' ? '#a5d6a7' : type === 'warn' ? '#ffcc80' : type === 'bad' ? '#ef9a9a' : '#cbd5e1'}`,
});

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  background: '#fff',
  border: '1px solid #e2e8f0',
};

const thStyle = {
  padding: '8px 10px',
  textAlign: 'left',
  fontSize: 12,
  color: '#475569',
  background: '#f8fafc',
  borderBottom: '1px solid #e2e8f0',
  whiteSpace: 'nowrap',
};

const tdStyle = {
  padding: '8px 10px',
  fontSize: 12,
  color: '#0f172a',
  borderBottom: '1px solid #edf2f7',
  verticalAlign: 'top',
};

function MappingTable({ rows, emptyText }) {
  if (!rows.length) {
    return <div style={{ padding: 16, color: '#64748b', fontSize: 13, border: '1px solid #e2e8f0', background: '#fff' }}>{emptyText}</div>;
  }
  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={thStyle}>거래처</th>
          <th style={thStyle}>붙여넣은 이름</th>
          <th style={thStyle}>매칭 품목</th>
          <th style={thStyle}>동작/수량</th>
          <th style={thStyle}>상태</th>
          <th style={thStyle}>매칭 키</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, idx) => (
          <tr key={`${r.orderId}-${r.inputName}-${idx}`}>
            <td style={tdStyle}>{r.custName || '-'}</td>
            <td style={tdStyle}>{r.inputName || '-'}</td>
            <td style={tdStyle}>
              <div style={{ fontWeight: 700 }}>{r.displayName || r.prodName || '-'}</div>
              {r.prodKey && <div style={{ color: '#64748b', marginTop: 2 }}>ProdKey {r.prodKey}</div>}
              {(r.flowerName || r.counName) && <div style={{ color: '#64748b', marginTop: 2 }}>{r.counName || ''} {r.flowerName || ''}</div>}
            </td>
            <td style={tdStyle}>{r.action || '추가'} {r.qty || 1}{r.unit || ''}</td>
            <td style={tdStyle}>
              {r.skip ? <span style={badgeStyle('warn')}>제외</span> :
                r.prodKey ? <span style={badgeStyle(r.fromMapping ? 'ok' : 'info')}>{r.fromMapping ? '저장 매칭 적용' : 'AI/직접 매칭'}</span> :
                <span style={badgeStyle('bad')}>미매칭</span>}
              {r.confidenceLabel && <div style={{ marginTop: 4, color: '#64748b' }}>신뢰도 {r.confidenceLabel}</div>}
              {r.fallbackSuspect && <div style={{ marginTop: 4, color: '#b71c1c' }}>반복 fallback 의심</div>}
            </td>
            <td style={tdStyle}>{r.mappingMatchKey || '-'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function MappingStatusPage() {
  const [snapshot, setSnapshot] = useState(null);
  const [serverMappings, setServerMappings] = useState({});
  const [err, setErr] = useState('');

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('nenova_paste_mapping_status');
      if (raw) setSnapshot(JSON.parse(raw));
    } catch (e) {
      setErr(e.message);
    }
    fetch('/api/orders/mappings', { credentials: 'same-origin' })
      .then(r => r.json())
      .then(d => {
        if (d.success) setServerMappings(d.mappings || {});
      })
      .catch(e => setErr(e.message));
  }, []);

  const rows = useMemo(() => {
    const out = [];
    (snapshot?.orders || []).forEach(order => {
      (order.items || []).forEach(item => {
        out.push({ ...item, orderId: order.id, custName: order.custName });
      });
    });
    return out;
  }, [snapshot]);

  const appliedRows = rows.filter(r => r.prodKey && r.fromMapping);
  const matchedRows = rows.filter(r => r.prodKey && !r.fromMapping && !r.skip);
  const unmatchedRows = rows.filter(r => !r.prodKey && !r.skip);
  const localEntries = Object.entries(snapshot?.mappingCache || {});
  const serverEntries = Object.entries(serverMappings);

  return (
    <Layout title="붙여넣기 매칭 적용 확인">
      <div style={{ padding: 20, maxWidth: 1160, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
          <div>
            <h2 style={{ margin: 0, color: '#1a237e', fontSize: 20 }}>붙여넣기 매칭 적용 확인</h2>
            <div style={{ marginTop: 6, color: '#64748b', fontSize: 12 }}>
              화면 저장 시각 {fmtDate(snapshot?.savedAt)} · 선택 차수 {snapshot?.week || snapshot?.detectedWeek || '-'}
            </div>
          </div>
          <button onClick={() => window.close()} style={{ padding: '7px 14px', border: '1px solid #cbd5e1', background: '#fff', borderRadius: 6, cursor: 'pointer' }}>창 닫기</button>
        </div>

        {err && <div style={{ marginBottom: 12, padding: 10, background: '#ffebee', color: '#b71c1c', border: '1px solid #ef9a9a' }}>{err}</div>}
        {!snapshot && <div style={{ marginBottom: 12, padding: 12, background: '#fff3e0', color: '#e65100', border: '1px solid #ffcc80' }}>붙여넣기 화면에서 열린 현재 매칭 스냅샷이 없습니다.</div>}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10, marginBottom: 18 }}>
          <div style={{ padding: 12, background: '#e8f5e9', border: '1px solid #a5d6a7' }}><b>{appliedRows.length}</b><div style={{ fontSize: 12 }}>저장 매칭 적용</div></div>
          <div style={{ padding: 12, background: '#e3f2fd', border: '1px solid #90caf9' }}><b>{matchedRows.length}</b><div style={{ fontSize: 12 }}>AI/직접 매칭</div></div>
          <div style={{ padding: 12, background: '#ffebee', border: '1px solid #ef9a9a' }}><b>{unmatchedRows.length}</b><div style={{ fontSize: 12 }}>미매칭</div></div>
          <div style={{ padding: 12, background: '#f8fafc', border: '1px solid #cbd5e1' }}><b>{serverEntries.length}</b><div style={{ fontSize: 12 }}>서버 저장 매칭</div></div>
        </div>

        <section style={{ marginBottom: 22 }}>
          <h3 style={{ fontSize: 15, margin: '0 0 8px', color: '#0f172a' }}>이번 붙여넣기에서 저장 매칭이 적용된 품목</h3>
          <MappingTable rows={appliedRows} emptyText="이번 화면에서 저장 매칭으로 자동 적용된 품목이 없습니다." />
        </section>

        <section style={{ marginBottom: 22 }}>
          <h3 style={{ fontSize: 15, margin: '0 0 8px', color: '#0f172a' }}>이번 붙여넣기에서 새로 매칭된 품목</h3>
          <MappingTable rows={matchedRows} emptyText="새로 매칭된 품목이 없습니다." />
        </section>

        <section style={{ marginBottom: 22 }}>
          <h3 style={{ fontSize: 15, margin: '0 0 8px', color: '#0f172a' }}>미매칭 품목</h3>
          <MappingTable rows={unmatchedRows} emptyText="미매칭 품목이 없습니다." />
        </section>

        <section style={{ marginBottom: 22 }}>
          <h3 style={{ fontSize: 15, margin: '0 0 8px', color: '#0f172a' }}>브라우저에 저장된 매칭</h3>
          <div style={{ maxHeight: 240, overflow: 'auto', border: '1px solid #e2e8f0', background: '#fff' }}>
            {localEntries.length === 0 ? <div style={{ padding: 12, color: '#64748b', fontSize: 13 }}>브라우저 저장 매칭이 없습니다.</div> :
              localEntries.map(([key, value]) => (
                <div key={key} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10, padding: '8px 10px', borderBottom: '1px solid #edf2f7', fontSize: 12 }}>
                  <div style={{ color: '#475569' }}>{key}</div>
                  <div><b>{value.displayName || value.prodName}</b> <span style={{ color: '#64748b' }}>ProdKey {value.prodKey}</span></div>
                </div>
              ))}
          </div>
        </section>

        <section>
          <h3 style={{ fontSize: 15, margin: '0 0 8px', color: '#0f172a' }}>서버 공용 저장 매칭</h3>
          <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid #e2e8f0', background: '#fff' }}>
            {serverEntries.length === 0 ? <div style={{ padding: 12, color: '#64748b', fontSize: 13 }}>서버 저장 매칭이 없습니다.</div> :
              serverEntries.map(([key, value]) => (
                <div key={key} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 130px', gap: 10, padding: '8px 10px', borderBottom: '1px solid #edf2f7', fontSize: 12 }}>
                  <div style={{ color: '#475569' }}>{key}</div>
                  <div><b>{value.displayName || value.prodName}</b> <span style={{ color: '#64748b' }}>ProdKey {value.prodKey}</span></div>
                  <div style={{ color: '#64748b' }}>{fmtDate(value.savedAt)}</div>
                </div>
              ))}
          </div>
        </section>
      </div>
    </Layout>
  );
}
