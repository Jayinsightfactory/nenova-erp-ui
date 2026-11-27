import desktopUi from '../../styles/DesktopOrderWorkspace.module.css';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
// Layout 은 _app.js 가 전역 래핑 — 페이지 자체 래핑 금지(이중 사이드바 원인)

const PAGE_SIZE = 100;
const FONT_STACK = "'Pretendard Variable', 'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', '맑은 고딕', sans-serif";

const inputStyle = {
  height: 32,
  border: '1px solid #cfd6e4',
  borderRadius: 4,
  padding: '0 8px',
  fontSize: 12,
  fontFamily: FONT_STACK,
};

function fmt(value) {
  return Number(value || 0).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
}

const SummaryRow = memo(function SummaryRow({ item }) {
  return (
    <tr style={rowStyle}>
      <td style={td}>{item.productName}</td>
      <td style={tdQty}>{fmt(item.quantity)}</td>
      <td style={td}>{item.unit}</td>
    </tr>
  );
});

export default function IncomingKakaoSummaryPage() {
  const [filters, setFilters] = useState({
    week: '',
    room: '수입',
    product: '',
    supplier: '',
    direction: '+',
  });
  const [quickSearch, setQuickSearch] = useState('');
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const params = useMemo(() => {
    const p = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) p.set(key, value);
    });
    return p.toString();
  }, [filters]);

  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    setError('');
    setVisibleLimit(PAGE_SIZE);
    try {
      const qs = fresh ? (params ? `${params}&fresh=1` : 'fresh=1') : params;
      const res = await fetch(`/api/kakao/summary${qs ? `?${qs}` : ''}`, { credentials: 'same-origin' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || '카톡 수량 집계 조회 실패');
      setData(json);
    } catch (e) {
      setData(null);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items = data?.items || [];
  const filteredItems = useMemo(() => {
    const q = quickSearch.trim().toLowerCase();
    if (!q) return items;
    return items.filter(item =>
      String(item.productName || '').toLowerCase().includes(q)
      || String(item.unit || '').toLowerCase().includes(q)
    );
  }, [items, quickSearch]);

  const visibleItems = useMemo(
    () => filteredItems.slice(0, visibleLimit),
    [filteredItems, visibleLimit]
  );

  return (
    <>
      <div className={desktopUi.page} style={{ padding: 18, maxWidth: 1200, margin: '0 auto', fontFamily: FONT_STACK, fontVariantNumeric: 'tabular-nums' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <div>
            <h1 data-desktop-chrome style={{ margin: 0, fontSize: 20 }}>수입방 카톡 수량집계</h1>
            <div style={{ marginTop: 4, fontSize: 12, color: '#667085' }}>
              Google Sheet의 카톡 구조화 데이터에서 품목과 수량만 집계합니다. (5분 캐시 · 조회 시 즉시 갱신)
            </div>
          </div>
          <button onClick={() => load(true)} disabled={loading} style={primaryBtn}>
            {loading ? '조회중...' : '조회'}
          </button>
        </div>

        <div style={filterBar}>
          <label style={fieldLabel}>차수</label>
          <input
            value={filters.week}
            onChange={e => setFilters(f => ({ ...f, week: e.target.value }))}
            placeholder="예: 21 또는 21-02"
            style={inputStyle}
          />
          <label style={fieldLabel}>카톡방</label>
          <input
            value={filters.room}
            onChange={e => setFilters(f => ({ ...f, room: e.target.value }))}
            placeholder="예: 수입"
            style={inputStyle}
          />
          <label style={fieldLabel}>품목</label>
          <input
            value={filters.product}
            onChange={e => setFilters(f => ({ ...f, product: e.target.value }))}
            placeholder="예: 반커부쉬"
            style={inputStyle}
          />
          <label style={fieldLabel}>거래처</label>
          <input
            value={filters.supplier}
            onChange={e => setFilters(f => ({ ...f, supplier: e.target.value }))}
            placeholder="예: 소재2호"
            style={inputStyle}
          />
          <select
            value={filters.direction}
            onChange={e => setFilters(f => ({ ...f, direction: e.target.value }))}
            style={inputStyle}
          >
            <option value="+">추가만</option>
            <option value="-">취소/차감만</option>
            <option value="all">전체</option>
          </select>
        </div>

        {error && (
          <div style={errorBox}>
            {error}
            <div style={{ marginTop: 4, fontSize: 12 }}>
              운영 환경에 Google 서비스 계정 JSON과 시트 공유가 필요합니다.
            </div>
          </div>
        )}

        {data && (
          <div style={summaryBar}>
            <span>품목 {fmt(data.summary.products)}개</span>
            <span>근거 행 {fmt(data.summary.rows)}건</span>
            <span>총수량 {fmt(data.summary.totalQuantity)}</span>
            <input
              value={quickSearch}
              onChange={e => { setQuickSearch(e.target.value); setVisibleLimit(PAGE_SIZE); }}
              placeholder="결과 내 품목·단위 즉시 필터"
              aria-label="결과 내 품목 즉시 필터"
              style={{ ...inputStyle, marginLeft: 'auto', minWidth: 200, fontWeight: 400 }}
            />
          </div>
        )}

        <div style={{ border: '1px solid #d9e2f1', borderRadius: 6, overflow: 'hidden', background: '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f6f8fb' }}>
                <th style={th}>품목</th>
                <th style={{ ...th, width: 140, textAlign: 'right' }}>수량</th>
                <th style={{ ...th, width: 90 }}>단위</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((item, index) => (
                <SummaryRow key={`${item.productName}-${item.unit}-${index}`} item={item} />
              ))}
              {!loading && filteredItems.length === 0 && (
                <tr>
                  <td colSpan={3} style={{ padding: 24, textAlign: 'center', color: '#667085' }}>
                    조회된 품목 수량이 없습니다.
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan={3} style={{ padding: 24, textAlign: 'center', color: '#667085' }}>
                    수량을 집계하는 중입니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {filteredItems.length > visibleLimit && (
            <div style={{ padding: 10, borderTop: '1px solid #eef2f7', textAlign: 'center', background: '#f8fafc' }}>
              <button
                type="button"
                onClick={() => setVisibleLimit(v => v + PAGE_SIZE)}
                style={moreBtn}
              >
                더 보기 (+{PAGE_SIZE}건 · {visibleItems.length}/{filteredItems.length}건 표시)
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

const primaryBtn = {
  height: 34,
  padding: '0 16px',
  border: '1px solid #1d4ed8',
  background: '#2563eb',
  color: '#fff',
  borderRadius: 4,
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: FONT_STACK,
};

const moreBtn = {
  height: 30,
  padding: '0 14px',
  border: '1px solid #cbd5e1',
  background: '#fff',
  color: '#1e293b',
  borderRadius: 4,
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: FONT_STACK,
};

const filterBar = {
  display: 'grid',
  gridTemplateColumns: '36px minmax(120px, 1fr) 52px minmax(120px, 1fr) 36px minmax(140px, 1.2fr) 48px minmax(120px, 1fr) 110px',
  gap: 8,
  alignItems: 'center',
  padding: 10,
  border: '1px solid #d9e2f1',
  borderRadius: 6,
  background: '#fff',
  marginBottom: 12,
};

const fieldLabel = { fontSize: 12, fontWeight: 700, color: '#344054' };
const summaryBar = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 14,
  alignItems: 'center',
  padding: '8px 10px',
  marginBottom: 10,
  border: '1px solid #d9e2f1',
  borderRadius: 6,
  background: '#f8fafc',
  color: '#344054',
  fontSize: 12,
  fontWeight: 700,
};
const errorBox = { marginBottom: 12, padding: 12, border: '1px solid #fecaca', background: '#fff5f5', color: '#b91c1c', borderRadius: 6 };
const rowStyle = { borderTop: '1px solid #eef2f7', contentVisibility: 'auto', containIntrinsicSize: '0 38px' };
const th = { padding: '9px 10px', textAlign: 'left', color: '#344054', borderBottom: '1px solid #d9e2f1' };
const td = { padding: '9px 10px', color: '#1f2937' };
const tdQty = { ...td, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' };
