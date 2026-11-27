import desktopUi from '../../styles/DesktopOrderWorkspace.module.css';
import { memo, useEffect, useMemo, useState } from 'react';
import Layout from '../../components/Layout';

const PAGE_SIZE = 100;
const FONT_STACK = "'Pretendard Variable', 'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', '맑은 고딕', sans-serif";

export default function KakaoAuditPage() {
  const [text, setText] = useState('');
  const [orderYear, setOrderYear] = useState(String(new Date().getFullYear()));
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const rows = result?.rows || [];
  const indexedRows = useMemo(
    () => rows.map((r, idx) => ({
      row: r,
      key: `${r.week || ''}-${r.inputCustomer || ''}-${r.inputProduct || ''}-${idx}`,
      haystack: [
        r.week,
        r.inputCustomer,
        r.custMatch?.CustName,
        r.inputProduct,
        r.prodMatch?.DisplayName,
        r.prodMatch?.ProdName,
        r.issues?.join(' '),
        r.sourceLine,
      ].filter(Boolean).join(' ').toLowerCase(),
    })),
    [rows]
  );

  const filteredIndexed = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return indexedRows;
    return indexedRows.filter(item => item.haystack.includes(q));
  }, [indexedRows, search]);

  const filteredRows = useMemo(() => filteredIndexed.map(item => item.row), [filteredIndexed]);
  const needReviewRows = useMemo(() => filteredRows.filter(r => r.status === '확인필요'), [filteredRows]);

  async function runAudit() {
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/orders/kakao-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, orderYear }),
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
      <div className={desktopUi.page} style={{ padding: 20, maxWidth: 1500, margin: '0 auto', fontFamily: FONT_STACK, fontVariantNumeric: 'tabular-nums' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <div>
            <h1 data-desktop-chrome style={{ margin: 0, fontSize: 22 }}>카톡 변경사항 DB 검증</h1>
            <div style={{ marginTop: 4, color: '#667085', fontSize: 13 }}>
              카톡 원문에서 추가/취소 요청을 추출하고 주문등록/출고분배 DB 합계와 대조합니다.
            </div>
          </div>
          <button onClick={runAudit} disabled={loading || !text.trim()} style={primaryBtn}>
            {loading ? '검증 중...' : '검증 실행'}
          </button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 8 }}>
          <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            조회 연도
            <input value={orderYear} onChange={e => setOrderYear(e.target.value.replace(/\D/g, '').slice(0, 4))} style={{ width: 76, padding: 6, fontFamily: FONT_STACK }} />
          </label>
          {result && (
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="업체·품목·차수·이슈·원문 즉시 검색"
              aria-label="검증 결과 검색"
              style={{ minWidth: 240, padding: '6px 10px', border: '1px solid #cfd6e4', borderRadius: 4, fontSize: 12, fontFamily: FONT_STACK }}
            />
          )}
        </div>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="카카오톡 대화 텍스트를 붙여넣으세요."
          style={{ width: '100%', height: 220, boxSizing: 'border-box', padding: 12, border: '1px solid #cfd6e4', borderRadius: 6, fontSize: 13, lineHeight: 1.45, fontFamily: FONT_STACK }}
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
                <h2 style={h2}>확인 필요 항목 ({needReviewRows.length}건)</h2>
                <AuditTable rows={needReviewRows} />
              </section>
            )}

            <section style={{ marginTop: 18 }}>
              <details open={needReviewRows.length === 0}>
                <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 15, color: '#1f2937', marginBottom: 8 }}>
                  전체 추출 결과 ({filteredRows.length}건)
                </summary>
                <AuditTable rows={filteredRows} />
              </details>
            </section>
          </>
        )}
      </div>
    </Layout>
  );
}

const Summary = memo(function Summary({ label, value, danger }) {
  return (
    <div style={{ border: '1px solid #d9e2f1', borderRadius: 6, padding: 12, background: danger && value > 0 ? '#fff5f5' : '#fff' }}>
      <div style={{ fontSize: 12, color: '#667085' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: danger && value > 0 ? '#c62828' : '#1f2937' }}>{value}</div>
    </div>
  );
});

const AuditRow = memo(function AuditRow({ r }) {
  return (
    <tr style={{ borderTop: '1px solid #eef2f7', background: r.status === '확인필요' ? '#fffafa' : '#fff', contentVisibility: 'auto', containIntrinsicSize: '0 40px' }}>
      <Td><span style={badge(r.status)}>{r.status}</span></Td>
      <Td style={numTd}>{[r.sourceDate, r.sourceTime].filter(Boolean).join(' ')}</Td>
      <Td style={numTd}>{r.week || '-'}</Td>
      <Td>{r.inputCustomer}</Td>
      <Td>{r.custMatch ? `${r.custMatch.CustName} (${r.custMatch.CustArea || '-'})` : '-'}</Td>
      <Td>{r.inputProduct}</Td>
      <Td>{r.prodMatch ? `${r.prodMatch.DisplayName || r.prodMatch.ProdName} / ${r.prodMatch.CounName || ''} / ${r.prodMatch.score}` : '-'}</Td>
      <Td style={numTd}>{r.action} {r.qty}{r.unit}</Td>
      <Td style={numTd}>{Number(r.db?.orderQty || 0)}</Td>
      <Td style={numTd}>{Number(r.db?.shipQty || 0)}</Td>
      <Td>{r.issues?.join(', ') || '-'}</Td>
      <Td style={{ maxWidth: 260, whiteSpace: 'normal' }}>{r.sourceLine}</Td>
    </tr>
  );
});

const AuditTable = memo(function AuditTable({ rows }) {
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);
  useEffect(() => {
    setVisibleLimit(PAGE_SIZE);
  }, [rows]);

  const visibleRows = useMemo(() => rows.slice(0, visibleLimit), [rows, visibleLimit]);

  return (
    <div style={{ overflowX: 'auto', border: '1px solid #d9e2f1', borderRadius: 6, background: '#fff' }}>
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
          {visibleRows.map((r, i) => (
            <AuditRow key={`${r.week || ''}-${r.inputCustomer || ''}-${r.inputProduct || ''}-${i}`} r={r} />
          ))}
        </tbody>
      </table>
      {rows.length > visibleLimit && (
        <div style={{ padding: 10, borderTop: '1px solid #eef2f7', textAlign: 'center', background: '#f8fafc' }}>
          <button type="button" onClick={() => setVisibleLimit(v => v + PAGE_SIZE)} style={moreBtn}>
            더 보기 (+{PAGE_SIZE}건 · {visibleRows.length}/{rows.length}건 표시)
          </button>
        </div>
      )}
    </div>
  );
});

function Th({ children }) {
  return <th style={{ padding: '8px 10px', textAlign: 'left', color: '#344054', whiteSpace: 'nowrap' }}>{children}</th>;
}

function Td({ children, style }) {
  return <td style={{ padding: '8px 10px', verticalAlign: 'top', color: '#1f2937', whiteSpace: 'nowrap', ...style }}>{children}</td>;
}

const numTd = { fontVariantNumeric: 'tabular-nums' };

const primaryBtn = {
  padding: '10px 16px',
  border: '1px solid #1d4ed8',
  background: '#2563eb',
  color: '#fff',
  borderRadius: 6,
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: FONT_STACK,
};

const moreBtn = {
  padding: '6px 14px',
  border: '1px solid #cbd5e1',
  background: '#fff',
  color: '#1e293b',
  borderRadius: 4,
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: FONT_STACK,
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
