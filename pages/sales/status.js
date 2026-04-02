// pages/sales/status.js — 판매현황
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { apiGet } from '../../lib/useApi';
import { useLang } from '../../lib/i18n';

const fmt = n => Number(n || 0).toLocaleString();

export default function SalesStatus() {
  const { t } = useLang();

  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [tab, setTab] = useState('all'); // 'all' | 'customer' | 'product'
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  // 필터 상태
  const today = new Date().toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(today);
  const [week, setWeek] = useState('');
  const [manager, setManager] = useState('');

  // 거래처 검색
  const [custSearch, setCustSearch] = useState('');
  const [selectedCust, setSelectedCust] = useState(null);
  const [custList, setCustList] = useState([]);
  const [custOpen, setCustOpen] = useState(false);
  const custDebounce = useRef(null);
  const custRef = useRef(null);

  // 거래처 드롭다운 외부 클릭 닫기
  useEffect(() => {
    const handler = e => {
      if (custRef.current && !custRef.current.contains(e.target)) {
        setCustOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // 거래처 검색 디바운스
  useEffect(() => {
    if (custDebounce.current) clearTimeout(custDebounce.current);
    if (!custSearch.trim()) {
      setCustList([]);
      setCustOpen(false);
      return;
    }
    custDebounce.current = setTimeout(() => {
      apiGet('/api/customers/search', { q: custSearch })
        .then(d => {
          setCustList(d.customers || []);
          setCustOpen(true);
        })
        .catch(() => {});
    }, 300);
    return () => clearTimeout(custDebounce.current);
  }, [custSearch]);

  const handleSelectCust = useCallback((c) => {
    setSelectedCust(c);
    setCustSearch(c.CustName);
    setCustOpen(false);
  }, []);

  const handleClearCust = useCallback(() => {
    setSelectedCust(null);
    setCustSearch('');
    setCustList([]);
    setCustOpen(false);
  }, []);

  // 조회
  const load = useCallback(() => {
    setLoading(true);
    setErr('');
    const params = {};
    if (dateFrom) params.dateFrom = dateFrom;
    if (dateTo)   params.dateTo   = dateTo;
    if (week)     params.week     = week;
    if (manager)  params.manager  = manager;
    if (selectedCust) params.custKey = selectedCust.CustKey;

    apiGet('/api/sales/status', params)
      .then(d => {
        setRows(d.rows || []);
        setSummary(d.summary || null);
      })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo, week, manager, selectedCust]);

  // 초기 로드
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 거래처별 집계
  const byCustomer = useMemo(() => {
    const map = {};
    rows.forEach(r => {
      if (!map[r.CustKey]) {
        map[r.CustKey] = {
          CustKey: r.CustKey,
          custName: r.CustName,
          area: r.CustArea,
          manager: r.manager,
          qty: 0,
          supply: 0,
          vat: 0,
          count: 0,
        };
      }
      map[r.CustKey].qty    += Number(r.qty     || 0);
      map[r.CustKey].supply += Number(r.supplyAmt || 0);
      map[r.CustKey].vat    += Number(r.vatAmt   || 0);
      map[r.CustKey].count  += 1;
    });
    return Object.values(map).sort((a, b) => b.supply - a.supply);
  }, [rows]);

  // 품목별 집계
  const byProduct = useMemo(() => {
    const map = {};
    rows.forEach(r => {
      if (!map[r.ProdKey]) {
        map[r.ProdKey] = {
          ProdKey: r.ProdKey,
          prodName: r.ProdName,
          country: r.CounName,
          flower: r.FlowerName,
          unit: r.OutUnit,
          qty: 0,
          supply: 0,
          vat: 0,
        };
      }
      map[r.ProdKey].qty    += Number(r.qty     || 0);
      map[r.ProdKey].supply += Number(r.supplyAmt || 0);
      map[r.ProdKey].vat    += Number(r.vatAmt   || 0);
    });
    return Object.values(map).sort((a, b) => b.supply - a.supply);
  }, [rows]);

  // 엑셀 다운로드 (CSV + BOM)
  const handleExcel = useCallback(() => {
    const BOM = '\uFEFF';
    let csv = '';

    if (tab === 'all') {
      csv += '날짜,차수,거래처,지역,품목명,단위,수량,단가,공급가액,부가세,합계\n';
      rows.forEach(r => {
        const total = Number(r.supplyAmt || 0) + Number(r.vatAmt || 0);
        csv += [
          r.shipDate, r.week, r.CustName, r.CustArea,
          r.ProdName, r.OutUnit,
          r.qty, r.unitCost, r.supplyAmt, r.vatAmt, total,
        ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',') + '\n';
      });
      if (summary) {
        csv += `"합계",,,,,,"${fmt(summary.totalQty)}",,"${fmt(summary.totalSupply)}","${fmt(summary.totalVat)}","${fmt(summary.totalAmt)}"\n`;
      }
    } else if (tab === 'customer') {
      csv += '거래처,지역,담당자,건수,수량합계,공급가액,부가세,합계\n';
      byCustomer.forEach(r => {
        csv += [
          r.custName, r.area, r.manager,
          r.count, r.qty, r.supply, r.vat, r.supply + r.vat,
        ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',') + '\n';
      });
    } else if (tab === 'product') {
      csv += '품목명,국가,꽃종류,단위,수량합계,공급가액,부가세,합계\n';
      byProduct.forEach(r => {
        csv += [
          r.prodName, r.country, r.flower, r.unit,
          r.qty, r.supply, r.vat, r.supply + r.vat,
        ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',') + '\n';
      });
    }

    const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `판매현황_${dateFrom}_${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [tab, rows, byCustomer, byProduct, summary, dateFrom, dateTo]);

  // 합계 행 (전체탭)
  const totalRow = useMemo(() => {
    if (!rows.length) return null;
    return {
      qty:       rows.reduce((a, r) => a + Number(r.qty      || 0), 0),
      supplyAmt: rows.reduce((a, r) => a + Number(r.supplyAmt || 0), 0),
      vatAmt:    rows.reduce((a, r) => a + Number(r.vatAmt    || 0), 0),
    };
  }, [rows]);

  const TABS = [
    { key: 'all',      label: '전체' },
    { key: 'customer', label: '거래처별' },
    { key: 'product',  label: '품목별' },
  ];

  return (
    <div>
      {/* ── 필터 바 */}
      <div className="filter-bar" style={{ flexWrap: 'wrap', gap: 6 }}>
        <span className="filter-label">기간</span>
        <input
          type="date" className="filter-input"
          value={dateFrom} onChange={e => setDateFrom(e.target.value)}
        />
        <span style={{ color: 'var(--text3)' }}>~</span>
        <input
          type="date" className="filter-input"
          value={dateTo} onChange={e => setDateTo(e.target.value)}
        />

        <span className="filter-label" style={{ marginLeft: 6 }}>차수</span>
        <input
          className="filter-input"
          placeholder="빈칸=전체"
          value={week} onChange={e => setWeek(e.target.value)}
          style={{ width: 90 }}
        />

        <span className="filter-label" style={{ marginLeft: 6 }}>거래처</span>
        <div ref={custRef} style={{ position: 'relative' }}>
          <input
            className="filter-input"
            placeholder="거래처 검색..."
            value={custSearch}
            onChange={e => { setCustSearch(e.target.value); if (!e.target.value) handleClearCust(); }}
            style={{ width: 160 }}
          />
          {selectedCust && (
            <button
              onClick={handleClearCust}
              style={{
                position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text3)', fontSize: 13, lineHeight: 1,
              }}
            >×</button>
          )}
          {custOpen && custList.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, zIndex: 200,
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,.15)',
              maxHeight: 220, overflowY: 'auto', minWidth: 220,
            }}>
              {custList.map(c => (
                <div
                  key={c.CustKey}
                  onMouseDown={() => handleSelectCust(c)}
                  style={{
                    padding: '6px 10px', cursor: 'pointer', fontSize: 12,
                    borderBottom: '1px solid var(--border)',
                  }}
                  className="cust-option"
                >
                  <span style={{ fontWeight: 600 }}>{c.CustName}</span>
                  {c.CustArea && <span style={{ color: 'var(--text3)', marginLeft: 6, fontSize: 11 }}>{c.CustArea}</span>}
                  {c.Manager  && <span style={{ color: 'var(--text3)', marginLeft: 4, fontSize: 11 }}>· {c.Manager}</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        <span className="filter-label" style={{ marginLeft: 6 }}>담당자</span>
        <input
          className="filter-input"
          placeholder="담당자"
          value={manager} onChange={e => setManager(e.target.value)}
          style={{ width: 90 }}
        />

        <div className="page-actions" style={{ marginLeft: 'auto' }}>
          <button className="btn btn-primary" onClick={load} disabled={loading}>
            {loading ? '조회중...' : t('조회')}
          </button>
          <button className="btn btn-secondary" onClick={handleExcel} disabled={!rows.length}>
            {t('엑셀')}
          </button>
        </div>
      </div>

      {err && (
        <div style={{
          padding: '8px 14px', background: 'var(--red-bg)', color: 'var(--red)',
          borderRadius: 8, marginBottom: 10, fontSize: 13,
        }}>
          ⚠️ {err}
        </div>
      )}

      {/* ── 요약 카드 */}
      {summary && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          {[
            { label: '건수',         value: fmt(summary.rowCount) },
            { label: '거래처수',     value: fmt(summary.custCount) },
            { label: '공급가액',     value: fmt(summary.totalSupply) },
            { label: '부가세',       value: fmt(summary.totalVat) },
            { label: '합계금액',     value: fmt(summary.totalAmt), highlight: true },
          ].map(card => (
            <div key={card.label} className="card" style={{
              flex: '1 1 130px', minWidth: 120, padding: '10px 14px', textAlign: 'center',
            }}>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>{card.label}</div>
              <div style={{
                fontSize: 16, fontWeight: 700,
                color: card.highlight ? 'var(--blue)' : 'var(--text)',
                fontFamily: 'var(--mono)',
              }}>{card.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── 탭 */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
        {TABS.map(tb => (
          <button
            key={tb.key}
            onClick={() => setTab(tb.key)}
            className={`chip${tab === tb.key ? ' chip-active' : ''}`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {/* ── 전체 탭 */}
      {tab === 'all' && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">판매 내역</span>
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>{rows.length}건</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            {loading ? (
              <div className="skeleton" style={{ margin: 16, height: 300, borderRadius: 8 }} />
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>날짜</th>
                    <th>차수</th>
                    <th>거래처</th>
                    <th>지역</th>
                    <th>품목명</th>
                    <th>단위</th>
                    <th style={{ textAlign: 'right' }}>수량</th>
                    <th style={{ textAlign: 'right' }}>단가</th>
                    <th style={{ textAlign: 'right' }}>공급가액</th>
                    <th style={{ textAlign: 'right' }}>부가세</th>
                    <th style={{ textAlign: 'right' }}>합계</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={11} style={{ textAlign: 'center', padding: 32, color: 'var(--text3)' }}>
                        조회 조건을 설정 후 조회하세요
                      </td>
                    </tr>
                  ) : rows.map((r, i) => {
                    const total = Number(r.supplyAmt || 0) + Number(r.vatAmt || 0);
                    return (
                      <tr key={i}>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{r.shipDate}</td>
                        <td style={{ fontFamily: 'var(--mono)', fontWeight: 700 }}>{r.week}</td>
                        <td className="name">{r.CustName}</td>
                        <td>
                          {r.CustArea && (
                            <span className="badge badge-gray" style={{ fontSize: 10 }}>{r.CustArea}</span>
                          )}
                        </td>
                        <td style={{ fontSize: 12 }}>{r.ProdName}</td>
                        <td style={{ fontSize: 11, color: 'var(--text3)' }}>{r.OutUnit}</td>
                        <td className="num">{fmt(r.qty)}</td>
                        <td className="num" style={{ color: 'var(--text3)', fontSize: 11 }}>{fmt(r.unitCost)}</td>
                        <td className="num">{fmt(r.supplyAmt)}</td>
                        <td className="num" style={{ color: 'var(--text3)', fontSize: 11 }}>{fmt(r.vatAmt)}</td>
                        <td className="num" style={{ fontWeight: 700 }}>{fmt(total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                {totalRow && (
                  <tfoot>
                    <tr className="foot">
                      <td colSpan={6} style={{ textAlign: 'right', fontWeight: 700 }}>합계</td>
                      <td className="num">{fmt(totalRow.qty)}</td>
                      <td />
                      <td className="num">{fmt(totalRow.supplyAmt)}</td>
                      <td className="num">{fmt(totalRow.vatAmt)}</td>
                      <td className="num" style={{ fontWeight: 700, color: 'var(--blue)' }}>
                        {fmt(totalRow.supplyAmt + totalRow.vatAmt)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── 거래처별 탭 */}
      {tab === 'customer' && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">거래처별 판매 현황</span>
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>{byCustomer.length}개 거래처</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            {loading ? (
              <div className="skeleton" style={{ margin: 16, height: 300, borderRadius: 8 }} />
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>거래처</th>
                    <th>지역</th>
                    <th>담당자</th>
                    <th style={{ textAlign: 'right' }}>건수</th>
                    <th style={{ textAlign: 'right' }}>수량합계</th>
                    <th style={{ textAlign: 'right' }}>공급가액</th>
                    <th style={{ textAlign: 'right' }}>부가세</th>
                    <th style={{ textAlign: 'right' }}>합계</th>
                  </tr>
                </thead>
                <tbody>
                  {byCustomer.length === 0 ? (
                    <tr>
                      <td colSpan={9} style={{ textAlign: 'center', padding: 32, color: 'var(--text3)' }}>
                        조회 결과가 없습니다
                      </td>
                    </tr>
                  ) : byCustomer.map((r, i) => (
                    <tr key={r.CustKey}>
                      <td style={{
                        fontFamily: 'var(--mono)', fontWeight: 700,
                        color: i < 3 ? 'var(--amber)' : 'var(--text3)',
                        fontSize: 12,
                      }}>{i + 1}</td>
                      <td className="name">{r.custName}</td>
                      <td>
                        {r.area && (
                          <span className="badge badge-gray" style={{ fontSize: 10 }}>{r.area}</span>
                        )}
                      </td>
                      <td style={{ fontSize: 12 }}>{r.manager}</td>
                      <td className="num" style={{ color: 'var(--text3)' }}>{fmt(r.count)}</td>
                      <td className="num">{fmt(r.qty)}</td>
                      <td className="num">{fmt(r.supply)}</td>
                      <td className="num" style={{ color: 'var(--text3)', fontSize: 11 }}>{fmt(r.vat)}</td>
                      <td className="num" style={{ fontWeight: 700 }}>{fmt(r.supply + r.vat)}</td>
                    </tr>
                  ))}
                </tbody>
                {byCustomer.length > 0 && (
                  <tfoot>
                    <tr className="foot">
                      <td colSpan={5} style={{ textAlign: 'right', fontWeight: 700 }}>합계</td>
                      <td className="num">{fmt(byCustomer.reduce((a, r) => a + r.qty, 0))}</td>
                      <td className="num">{fmt(byCustomer.reduce((a, r) => a + r.supply, 0))}</td>
                      <td className="num">{fmt(byCustomer.reduce((a, r) => a + r.vat, 0))}</td>
                      <td className="num" style={{ fontWeight: 700, color: 'var(--blue)' }}>
                        {fmt(byCustomer.reduce((a, r) => a + r.supply + r.vat, 0))}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── 품목별 탭 */}
      {tab === 'product' && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">품목별 판매 현황</span>
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>{byProduct.length}개 품목</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            {loading ? (
              <div className="skeleton" style={{ margin: 16, height: 300, borderRadius: 8 }} />
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>품목명</th>
                    <th>국가</th>
                    <th>꽃종류</th>
                    <th>단위</th>
                    <th style={{ textAlign: 'right' }}>수량합계</th>
                    <th style={{ textAlign: 'right' }}>공급가액</th>
                    <th style={{ textAlign: 'right' }}>부가세</th>
                    <th style={{ textAlign: 'right' }}>합계</th>
                  </tr>
                </thead>
                <tbody>
                  {byProduct.length === 0 ? (
                    <tr>
                      <td colSpan={9} style={{ textAlign: 'center', padding: 32, color: 'var(--text3)' }}>
                        조회 결과가 없습니다
                      </td>
                    </tr>
                  ) : byProduct.map((r, i) => (
                    <tr key={r.ProdKey}>
                      <td style={{
                        fontFamily: 'var(--mono)', fontWeight: 700,
                        color: i < 3 ? 'var(--amber)' : 'var(--text3)',
                        fontSize: 12,
                      }}>{i + 1}</td>
                      <td className="name">{r.prodName}</td>
                      <td>
                        {r.country && (
                          <span className="badge badge-gray" style={{ fontSize: 10 }}>{r.country}</span>
                        )}
                      </td>
                      <td>
                        {r.flower && (
                          <span className="badge badge-purple" style={{ fontSize: 10 }}>{r.flower}</span>
                        )}
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--text3)' }}>{r.unit}</td>
                      <td className="num">{fmt(r.qty)}</td>
                      <td className="num">{fmt(r.supply)}</td>
                      <td className="num" style={{ color: 'var(--text3)', fontSize: 11 }}>{fmt(r.vat)}</td>
                      <td className="num" style={{ fontWeight: 700 }}>{fmt(r.supply + r.vat)}</td>
                    </tr>
                  ))}
                </tbody>
                {byProduct.length > 0 && (
                  <tfoot>
                    <tr className="foot">
                      <td colSpan={5} style={{ textAlign: 'right', fontWeight: 700 }}>합계</td>
                      <td className="num">{fmt(byProduct.reduce((a, r) => a + r.qty, 0))}</td>
                      <td className="num">{fmt(byProduct.reduce((a, r) => a + r.supply, 0))}</td>
                      <td className="num">{fmt(byProduct.reduce((a, r) => a + r.vat, 0))}</td>
                      <td className="num" style={{ fontWeight: 700, color: 'var(--blue)' }}>
                        {fmt(byProduct.reduce((a, r) => a + r.supply + r.vat, 0))}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            )}
          </div>
        </div>
      )}

      <style jsx>{`
        .cust-option:hover {
          background: var(--hover-bg, #f5f5f5);
        }
      `}</style>
    </div>
  );
}
