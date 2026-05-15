import { useMemo, useState } from 'react';
import Layout from '../../components/Layout';

export default function KakaoAuditPage() {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const rows = result?.rows || [];
  const needReviewRows = useMemo(() => rows.filter(r => r.status === '확인필요'), [rows]);

  async function runAudit() {
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/orders/kakao-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || '검증 실패');
      setResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Layout>
      <div style={{ padding: 20, maxWidth: 1500, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22 }}>카톡 변경사항 DB 검증</h1>
            <div style={{ marginTop: 4, color: '#667085', fontSize: 13 }}>
              카톡 원문에서 추가/취소 요청을 추출하고 주문등록/출고분배 DB 합계와 대조합니다.
            </div>
          </div>
          <button onClick={runAudit} disabled={loading || !text.trim()} style={primaryBtn}>
            {loading ? '검증 중...' : '검증 실행'}
          </button>
        </div>

        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="카카오톡 대화 텍스트를 붙여넣으세요."
          style={{ width: '100%', height: 220, boxSizing: 'border-box', padding: 12, border: '1px solid #cfd6e4', borderRadius: 6, fontSize: 13, lineHeight: 1.45 }}
        />

        {error && <div style={errBox}>{error}</div>}

        {result && (
          <>
            <div style={summaryGrid}>
              <Summary label="추출" value={result.summary.total} />
              <Summary label="확인필요" value={result.summary.needReview} danger />
              <Summary label="업체 미매칭" value={result.summary.customerUnmatched} />
              <Summary label="품목 미매칭" value={result.summary.productUnmatched} />
              <Summary label="주문 0" value={result.summary.missingOrder} />
              <Summary label="분배 0" value={result.summary.missingShipment} />
            </div>

            {needReviewRows.length > 0 && (
              <section style={{ marginTop: 18 }}>
                <h2 style={h2}>확인 필요 항목</h2>
                <AuditTable rows={needReviewRows} />
              </section>
            )}

            <section style={{ marginTop: 18 }}>
              <h2 style={h2}>전체 추출 결과</h2>
              <AuditTable rows={rows} />
            </section>
          </>
        )}
      </div>
    </Layout>
  );
}

function Summary({ label, value, danger }) {
  return (
    <div style={{ border: '1px solid #d9e2f1', borderRadius: 6, padding: 12, background: danger && value > 0 ? '#fff5f5' : '#fff' }}>
      <div style={{ fontSize: 12, color: '#667085' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: danger && value > 0 ? '#c62828' : '#1f2937' }}>{value}</div>
    </div>
  );
}

function AuditTable({ rows }) {
  return (
    <div style={{ overflowX: 'auto', border: '1px solid #d9e2f1', borderRadius: 6 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 1300 }}>
        <thead>
          <tr style={{ background: '#f6f8fb' }}>
            <Th>상태</Th>
            <Th>시간</Th>
            <Th>차수</Th>
            <Th>요청 업체</Th>
            <Th>매칭 업체</Th>
            <Th>요청 품목</Th>
            <Th>매칭 품목</Th>
            <Th>요청</Th>
            <Th>주문합계</Th>
            <Th>분배합계</Th>
            <Th>이슈</Th>
            <Th>원문</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderTop: '1px solid #eef2f7', background: r.status === '확인필요' ? '#fffafa' : '#fff' }}>
              <Td><span style={badge(r.status)}>{r.status}</span></Td>
              <Td>{[r.sourceDate, r.sourceTime].filter(Boolean).join(' ')}</Td>
              <Td>{r.week || '-'}</Td>
              <Td>{r.inputCustomer}</Td>
              <Td>{r.custMatch ? `${r.custMatch.CustName} (${r.custMatch.CustArea || '-'})` : '-'}</Td>
              <Td>{r.inputProduct}</Td>
              <Td>{r.prodMatch ? `${r.prodMatch.DisplayName || r.prodMatch.ProdName} / ${r.prodMatch.CounName || ''} / ${r.prodMatch.score}` : '-'}</Td>
              <Td>{r.action} {r.qty}{r.unit}</Td>
              <Td>{Number(r.db?.orderQty || 0)}</Td>
              <Td>{Number(r.db?.shipQty || 0)}</Td>
              <Td>{r.issues?.join(', ') || '-'}</Td>
              <Td style={{ maxWidth: 260, whiteSpace: 'normal' }}>{r.sourceLine}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }) {
  return <th style={{ padding: '8px 10px', textAlign: 'left', color: '#344054', whiteSpace: 'nowrap' }}>{children}</th>;
}

function Td({ children, style }) {
  return <td style={{ padding: '8px 10px', verticalAlign: 'top', color: '#1f2937', whiteSpace: 'nowrap', ...style }}>{children}</td>;
}

const primaryBtn = {
  padding: '10px 16px',
  border: '1px solid #1d4ed8',
  background: '#2563eb',
  color: '#fff',
  borderRadius: 6,
  fontWeight: 700,
  cursor: 'pointer',
};

const errBox = { marginTop: 12, padding: 12, border: '1px solid #fecaca', background: '#fff5f5', color: '#b91c1c', borderRadius: 6 };
const summaryGrid = { display: 'grid', gridTemplateColumns: 'repeat(6, minmax(120px, 1fr))', gap: 10, marginTop: 16 };
const h2 = { fontSize: 16, margin: '0 0 8px' };

function badge(status) {
  return {
    display: 'inline-block',
    padding: '3px 7px',
    borderRadius: 999,
    fontWeight: 700,
    color: status === '확인필요' ? '#b91c1c' : '#166534',
    background: status === '확인필요' ? '#fee2e2' : '#dcfce7',
  };
}
