// pages/purchase/status.js
// 구매현황(외화/수입) — 이카운트 "구매현황" 화면

import { useState, useEffect, useCallback } from 'react';
import Layout from '../../components/Layout';
import { apiGet } from '../../lib/useApi';
import { useWeekInput, WeekInput } from '../../lib/useWeekInput';

const fmt  = n => Number(n || 0).toLocaleString();
const fmtD = n => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const CURRENCY_SYMBOL = { USD: '$', EUR: '€', COP: 'COP ' };

function currSymbol(code) {
  return CURRENCY_SYMBOL[code] || (code ? code + ' ' : '$');
}

// 오늘 날짜 문자열 (YYYY-MM-DD)
function today() {
  return new Date().toISOString().slice(0, 10);
}

// 결제 상태 판단
function paymentStatus(paymentDtm) {
  if (!paymentDtm) return { label: '-', color: 'var(--text3)', warn: false };
  const d = paymentDtm.slice(0, 10);
  if (d < today()) return { label: '⚠️ 결제필요', color: 'var(--red, #e53935)', warn: true };
  if (d === today()) return { label: '⚠️ 오늘결제', color: 'var(--orange, #f57c00)', warn: true };
  return { label: '예정', color: 'var(--text3)', warn: false };
}

// ── 빈 품목 행 ────────────────────────────────────────────
function emptyDetail() {
  return { prodName: '', boxQty: '', unitPrice: '', totalPrice: '', weight: '', memo: '' };
}

export default function PurchaseStatus() {
  // 필터
  const [dateFrom, setDateFrom]           = useState('');
  const [dateTo, setDateTo]               = useState('');
  const [filterWeek, setFilterWeek]       = useState('');
  const [filterInvoice, setFilterInvoice] = useState('');
  const [filterSupplier, setFilterSupplier] = useState('');

  // 목록/로딩
  const [orders, setOrders]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // 상세 모달
  const [showDetail, setShowDetail]       = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [detailItems, setDetailItems]     = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // 입력 모달
  const [showInput, setShowInput] = useState(false);
  const [saving, setSaving]       = useState(false);
  const [form, setForm] = useState({
    invoiceNo: '', week: '', supplierName: '',
    currencyCode: 'USD', exchangeRate: '1300',
    paymentDtm: '', importDtm: '',
    totalBoxes: '', totalWeight: '', freightCost: '',
    memo: '',
  });
  const [details, setDetails] = useState([emptyDetail()]);

  // 초기 날짜 설정
  useEffect(() => {
    const t = new Date();
    setDateTo(t.toISOString().slice(0, 10));
    t.setDate(t.getDate() - 90);
    setDateFrom(t.toISOString().slice(0, 10));
  }, []);

  // 목록 조회
  const load = useCallback(() => {
    setLoading(true);
    setErr('');
    apiGet('/api/purchase', {
      dateFrom, dateTo,
      week:         filterWeek,
      invoiceNo:    filterInvoice,
      supplierName: filterSupplier,
    })
      .then(d => setOrders(d.orders || []))
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo, filterWeek, filterInvoice, filterSupplier]);

  useEffect(() => {
    if (dateFrom && dateTo) load();
  }, [dateFrom, dateTo]);

  // 행 클릭 → 상세
  const openDetail = (order) => {
    setSelectedOrder(order);
    setShowDetail(true);
    setDetailLoading(true);
    setDetailItems([]);
    apiGet('/api/purchase', { importKey: order.importKey })
      .then(d => setDetailItems(d.details || []))
      .catch(() => setDetailItems([]))
      .finally(() => setDetailLoading(false));
  };

  // 상세 모달 삭제
  const handleDelete = async () => {
    if (!selectedOrder) return;
    if (!confirm(`[${selectedOrder.invoiceNo}] 구매 주문을 삭제하시겠습니까?`)) return;
    try {
      const res = await fetch('/api/purchase', {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importKey: selectedOrder.importKey }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setShowDetail(false);
      setSelectedOrder(null);
      setSuccessMsg('삭제되었습니다.');
      setTimeout(() => setSuccessMsg(''), 3000);
      load();
    } catch (e) {
      alert('삭제 오류: ' + e.message);
    }
  };

  // 폼 초기화
  const resetForm = () => {
    setForm({
      invoiceNo: '', week: '', supplierName: '',
      currencyCode: 'USD', exchangeRate: '1300',
      paymentDtm: '', importDtm: '',
      totalBoxes: '', totalWeight: '', freightCost: '',
      memo: '',
    });
    setDetails([emptyDetail()]);
  };

  // 품목 행 업데이트
  const updateDetail = (idx, field, val) => {
    setDetails(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: val };
      // 외화금액 자동 계산
      if (field === 'boxQty' || field === 'unitPrice') {
        const bq = parseFloat(field === 'boxQty' ? val : next[idx].boxQty) || 0;
        const up = parseFloat(field === 'unitPrice' ? val : next[idx].unitPrice) || 0;
        next[idx].totalPrice = bq && up ? (bq * up).toFixed(2) : '';
      }
      return next;
    });
  };

  // 신규 저장
  const handleSave = async () => {
    if (!form.invoiceNo.trim()) { alert('인보이스번호를 입력하세요.'); return; }
    const validDetails = details.filter(d => d.prodName.trim());
    if (validDetails.length === 0) { alert('품목을 1개 이상 입력하세요.'); return; }

    setSaving(true);
    try {
      const res = await fetch('/api/purchase', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, details: validDetails }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setShowInput(false);
      resetForm();
      setSuccessMsg(`구매 주문이 등록되었습니다. (ImportKey: ${data.importKey})`);
      setTimeout(() => setSuccessMsg(''), 4000);
      load();
    } catch (e) {
      alert('저장 오류: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  // 엑셀 다운
  const handleExcel = () => {
    const rows = [
      ['차수','인보이스번호','거래처(농장)','통화','환율','결제일','입고일','박스수','무게(kg)','외화금액','운임','원화합계','품목수','상태'],
    ];
    orders.forEach(o => {
      const st = paymentStatus(o.paymentDtm);
      rows.push([
        o.week, o.invoiceNo, o.supplierName, o.currencyCode,
        o.exchangeRate, o.paymentDtm, o.importDtm,
        o.totalBoxes, o.totalWeight,
        o.totalForeignAmt, o.freightCost, o.totalKRW,
        o.detailCount, st.label.replace('⚠️ ',''),
      ]);
    });
    const csv = rows.map(r => r.map(v => `"${v == null ? '' : v}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `구매현황_${today()}.csv`;
    a.click();
  };

  // 요약 계산
  const totalCount       = orders.length;
  const totalBoxes       = orders.reduce((a, b) => a + (b.totalBoxes || 0), 0);
  const totalForeignAmt  = orders.reduce((a, b) => a + (b.totalForeignAmt || 0), 0);
  const totalKRW         = orders.reduce((a, b) => a + (b.totalKRW || 0), 0);
  const overdueCount     = orders.filter(o => {
    if (!o.paymentDtm) return false;
    return o.paymentDtm.slice(0, 10) < today();
  }).length;

  return (
    <Layout title="구매현황(외화/수입)">
      {/* 필터 바 */}
      <div className="filter-bar" style={{ flexWrap: 'wrap', gap: 6 }}>
        <span className="filter-label">기간</span>
        <input type="date" className="filter-input" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        <span style={{ color: 'var(--text3)' }}>~</span>
        <input type="date" className="filter-input" value={dateTo} onChange={e => setDateTo(e.target.value)} />

        <span className="filter-label" style={{ marginLeft: 8 }}>차수</span>
        <input
          className="filter-input"
          style={{ width: 70 }}
          placeholder="14-01"
          value={filterWeek}
          onChange={e => setFilterWeek(e.target.value)}
        />

        <span className="filter-label" style={{ marginLeft: 8 }}>인보이스</span>
        <input
          className="filter-input"
          style={{ width: 110 }}
          placeholder="INV-001"
          value={filterInvoice}
          onChange={e => setFilterInvoice(e.target.value)}
        />

        <span className="filter-label" style={{ marginLeft: 8 }}>거래처(농장)</span>
        <input
          className="filter-input"
          style={{ width: 120 }}
          placeholder="농장명"
          value={filterSupplier}
          onChange={e => setFilterSupplier(e.target.value)}
        />

        <div className="page-actions" style={{ marginLeft: 'auto' }}>
          <button className="btn btn-primary" onClick={load}>조회</button>
          <button className="btn btn-success" onClick={() => { resetForm(); setShowInput(true); }}>＋ 신규 구매입력</button>
          <button className="btn btn-secondary" onClick={handleExcel}>📊 엑셀 다운</button>
        </div>
      </div>

      {/* 메시지 */}
      {err && (
        <div style={{ padding: '8px 14px', background: 'var(--red-bg, #fff0f0)', color: 'var(--red, #e53935)', borderRadius: 8, marginBottom: 10, fontSize: 13 }}>
          ⚠️ {err}
        </div>
      )}
      {successMsg && (
        <div style={{ padding: '8px 14px', background: 'var(--green-bg, #f0fff4)', color: 'var(--green, #2e7d32)', borderRadius: 8, marginBottom: 10, fontSize: 13 }}>
          ✅ {successMsg}
        </div>
      )}

      {/* 요약 카드 */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        {[
          { label: '총 건수', value: `${fmt(totalCount)} 건`, color: 'var(--blue, #1565c0)' },
          { label: '총 박스수', value: `${fmt(totalBoxes)} 박스`, color: 'var(--text1, #333)' },
          { label: '총 외화금액', value: `$ ${fmtD(totalForeignAmt)}`, color: 'var(--text1, #333)' },
          { label: '총 원화금액', value: `₩ ${fmt(Math.round(totalKRW))}`, color: 'var(--text1, #333)' },
          { label: '미결제', value: `${fmt(overdueCount)} 건`, color: overdueCount > 0 ? 'var(--red, #e53935)' : 'var(--text3)' },
        ].map(card => (
          <div key={card.label} style={{
            flex: '1 1 160px', background: '#fff', border: '1px solid var(--border, #e0e0e0)',
            borderRadius: 8, padding: '10px 14px', minWidth: 140,
          }}>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>{card.label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: card.color }}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* 테이블 */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="card-header">
          <span className="card-title">구매 주문 목록</span>
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>{orders.length}건</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          {loading ? (
            <div className="skeleton" style={{ margin: 16, height: 300, borderRadius: 8 }} />
          ) : (
            <table className="tbl" style={{ minWidth: 1000 }}>
              <thead>
                <tr>
                  <th>차수</th>
                  <th>인보이스번호</th>
                  <th>거래처(농장)</th>
                  <th>통화</th>
                  <th style={{ textAlign: 'right' }}>환율</th>
                  <th>결제일</th>
                  <th>입고일</th>
                  <th style={{ textAlign: 'right' }}>박스수</th>
                  <th style={{ textAlign: 'right' }}>무게(kg)</th>
                  <th style={{ textAlign: 'right' }}>외화금액</th>
                  <th style={{ textAlign: 'right' }}>운임</th>
                  <th style={{ textAlign: 'right' }}>원화합계</th>
                  <th style={{ textAlign: 'right' }}>품목수</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {orders.length === 0 ? (
                  <tr>
                    <td colSpan={14} style={{ textAlign: 'center', padding: 48, color: 'var(--text3)' }}>
                      데이터 없음
                    </td>
                  </tr>
                ) : orders.map(o => {
                  const st = paymentStatus(o.paymentDtm);
                  return (
                    <tr
                      key={o.importKey}
                      style={{ cursor: 'pointer' }}
                      onClick={() => openDetail(o)}
                    >
                      <td style={{ fontFamily: 'var(--mono)', fontWeight: 700 }}>{o.week}</td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{o.invoiceNo}</td>
                      <td className="name">{o.supplierName}</td>
                      <td style={{ fontSize: 12 }}>{o.currencyCode}</td>
                      <td className="num">{fmt(o.exchangeRate)}</td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{o.paymentDtm}</td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{o.importDtm}</td>
                      <td className="num">{fmt(o.totalBoxes)}</td>
                      <td className="num">{fmtD(o.totalWeight)}</td>
                      <td className="num">{currSymbol(o.currencyCode)}{fmtD(o.totalForeignAmt)}</td>
                      <td className="num">{currSymbol(o.currencyCode)}{fmtD(o.freightCost)}</td>
                      <td className="num">₩ {fmt(Math.round(o.totalKRW))}</td>
                      <td className="num">{o.detailCount}</td>
                      <td style={{ fontSize: 12, color: st.color, fontWeight: st.warn ? 700 : 400 }}>
                        {st.label}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {orders.length > 0 && (
                <tfoot>
                  <tr className="foot">
                    <td colSpan={7}>합계</td>
                    <td className="num">{fmt(totalBoxes)}</td>
                    <td className="num">{fmtD(orders.reduce((a, b) => a + (b.totalWeight || 0), 0))}</td>
                    <td className="num">$ {fmtD(totalForeignAmt)}</td>
                    <td className="num">$ {fmtD(orders.reduce((a, b) => a + (b.freightCost || 0), 0))}</td>
                    <td className="num">₩ {fmt(Math.round(totalKRW))}</td>
                    <td className="num">{fmt(orders.reduce((a, b) => a + (b.detailCount || 0), 0))}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </div>
      </div>

      {/* ── 상세 모달 ─────────────────────────────────────── */}
      {showDetail && selectedOrder && (
        <div className="modal-overlay" onClick={() => setShowDetail(false)}>
          <div className="modal" style={{ maxWidth: 760, width: '96%' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">구매 상세 — {selectedOrder.invoiceNo}</span>
            </div>
            <div className="modal-body">
              {/* 헤더 정보 */}
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                gap: '6px 16px', fontSize: 13, marginBottom: 14,
                padding: '10px 12px', background: 'var(--bg, #f8f9fa)', borderRadius: 6,
              }}>
                {[
                  ['차수', selectedOrder.week],
                  ['거래처(농장)', selectedOrder.supplierName],
                  ['통화/환율', `${selectedOrder.currencyCode} / ${fmt(selectedOrder.exchangeRate)}`],
                  ['결제일', selectedOrder.paymentDtm],
                  ['입고일', selectedOrder.importDtm],
                  ['총 박스수', fmt(selectedOrder.totalBoxes)],
                  ['총 무게', fmtD(selectedOrder.totalWeight) + ' kg'],
                  ['운임/부대비', currSymbol(selectedOrder.currencyCode) + fmtD(selectedOrder.freightCost)],
                  ['메모', selectedOrder.memo],
                ].map(([k, v]) => (
                  <div key={k}>
                    <span style={{ color: 'var(--text3)', fontSize: 11 }}>{k}: </span>
                    <span style={{ fontWeight: 600 }}>{v || '-'}</span>
                  </div>
                ))}
              </div>

              {/* 품목 테이블 */}
              <div style={{ overflowX: 'auto', border: '1px solid var(--border, #e0e0e0)', borderRadius: 6 }}>
                {detailLoading ? (
                  <div className="skeleton" style={{ margin: 12, height: 120, borderRadius: 6 }} />
                ) : (
                  <table className="tbl" style={{ fontSize: 13 }}>
                    <thead>
                      <tr>
                        <th>품목명</th>
                        <th style={{ textAlign: 'right' }}>박스수</th>
                        <th style={{ textAlign: 'right' }}>외화단가</th>
                        <th style={{ textAlign: 'right' }}>외화금액</th>
                        <th style={{ textAlign: 'right' }}>무게(kg)</th>
                        <th>비고</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailItems.length === 0 ? (
                        <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--text3)' }}>품목 없음</td></tr>
                      ) : detailItems.map((d, i) => (
                        <tr key={d.detailKey || i}>
                          <td style={{ fontWeight: 500 }}>{d.prodName}</td>
                          <td className="num">{fmtD(d.boxQty)}</td>
                          <td className="num">{currSymbol(selectedOrder.currencyCode)}{fmtD(d.unitPrice)}</td>
                          <td className="num">{currSymbol(selectedOrder.currencyCode)}{fmtD(d.totalPrice)}</td>
                          <td className="num">{fmtD(d.weight)}</td>
                          <td style={{ fontSize: 12, color: 'var(--text3)' }}>{d.memo}</td>
                        </tr>
                      ))}
                    </tbody>
                    {detailItems.length > 0 && (
                      <tfoot>
                        <tr className="foot">
                          <td>합계</td>
                          <td className="num">{fmtD(detailItems.reduce((a, b) => a + (b.boxQty || 0), 0))}</td>
                          <td />
                          <td className="num">{currSymbol(selectedOrder.currencyCode)}{fmtD(detailItems.reduce((a, b) => a + (b.totalPrice || 0), 0))}</td>
                          <td className="num">{fmtD(detailItems.reduce((a, b) => a + (b.weight || 0), 0))}</td>
                          <td />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-danger" onClick={handleDelete}>🗑️ 삭제</button>
              <button className="btn btn-secondary" onClick={() => setShowDetail(false)}>닫기</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 신규입력 모달 ──────────────────────────────────── */}
      {showInput && (
        <div className="modal-overlay" onClick={() => {}}>
          <div
            className="modal"
            style={{ maxWidth: 820, width: '98%', maxHeight: '92vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="modal-header">
              <span className="modal-title">신규 구매 입력</span>
            </div>
            <div className="modal-body">
              {/* 기본 정보 */}
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 8 }}>기본 정보</div>
              <div className="form-row">
                <div className="form-group" style={{ flex: '2 1 200px' }}>
                  <label className="form-label">인보이스번호 *</label>
                  <input
                    className="form-control"
                    placeholder="INV-2026-001"
                    value={form.invoiceNo}
                    onChange={e => setForm(f => ({ ...f, invoiceNo: e.target.value }))}
                  />
                </div>
                <div className="form-group" style={{ flex: '1 1 120px' }}>
                  <label className="form-label">차수</label>
                  <input
                    className="form-control"
                    placeholder="14-01"
                    value={form.week}
                    onChange={e => setForm(f => ({ ...f, week: e.target.value }))}
                  />
                </div>
                <div className="form-group" style={{ flex: '2 1 180px' }}>
                  <label className="form-label">거래처/농장명</label>
                  <input
                    className="form-control"
                    placeholder="GROWER NAME"
                    value={form.supplierName}
                    onChange={e => setForm(f => ({ ...f, supplierName: e.target.value }))}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group" style={{ flex: '1 1 110px' }}>
                  <label className="form-label">통화</label>
                  <select
                    className="form-control"
                    value={form.currencyCode}
                    onChange={e => {
                      const code = e.target.value;
                      const defaultRate = code === 'USD' ? '1300' : code === 'EUR' ? '1430' : '0.31';
                      setForm(f => ({ ...f, currencyCode: code, exchangeRate: defaultRate }));
                    }}
                  >
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                    <option value="COP">COP</option>
                  </select>
                </div>
                <div className="form-group" style={{ flex: '1 1 120px' }}>
                  <label className="form-label">환율</label>
                  <input
                    type="number"
                    className="form-control"
                    value={form.exchangeRate}
                    onChange={e => setForm(f => ({ ...f, exchangeRate: e.target.value }))}
                  />
                </div>
                <div className="form-group" style={{ flex: '1 1 140px' }}>
                  <label className="form-label">결제일</label>
                  <input
                    type="date"
                    className="form-control"
                    value={form.paymentDtm}
                    onChange={e => setForm(f => ({ ...f, paymentDtm: e.target.value }))}
                  />
                </div>
                <div className="form-group" style={{ flex: '1 1 140px' }}>
                  <label className="form-label">입고일</label>
                  <input
                    type="date"
                    className="form-control"
                    value={form.importDtm}
                    onChange={e => setForm(f => ({ ...f, importDtm: e.target.value }))}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group" style={{ flex: '1 1 120px' }}>
                  <label className="form-label">총 박스수</label>
                  <input
                    type="number"
                    className="form-control"
                    value={form.totalBoxes}
                    onChange={e => setForm(f => ({ ...f, totalBoxes: e.target.value }))}
                  />
                </div>
                <div className="form-group" style={{ flex: '1 1 120px' }}>
                  <label className="form-label">총 무게(kg)</label>
                  <input
                    type="number"
                    className="form-control"
                    value={form.totalWeight}
                    onChange={e => setForm(f => ({ ...f, totalWeight: e.target.value }))}
                  />
                </div>
                <div className="form-group" style={{ flex: '1 1 140px' }}>
                  <label className="form-label">운임/부대비용</label>
                  <input
                    type="number"
                    className="form-control"
                    value={form.freightCost}
                    onChange={e => setForm(f => ({ ...f, freightCost: e.target.value }))}
                  />
                </div>
                <div className="form-group" style={{ flex: '2 1 200px' }}>
                  <label className="form-label">메모</label>
                  <input
                    className="form-control"
                    value={form.memo}
                    onChange={e => setForm(f => ({ ...f, memo: e.target.value }))}
                  />
                </div>
              </div>

              {/* 품목 상세 */}
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', margin: '14px 0 8px' }}>
                품목 상세
              </div>
              <div style={{ overflowX: 'auto', border: '1px solid var(--border, #e0e0e0)', borderRadius: 6 }}>
                <table className="tbl" style={{ fontSize: 13, minWidth: 700 }}>
                  <thead>
                    <tr>
                      <th style={{ minWidth: 180 }}>품목명 *</th>
                      <th style={{ minWidth: 80, textAlign: 'right' }}>박스수</th>
                      <th style={{ minWidth: 90, textAlign: 'right' }}>외화단가</th>
                      <th style={{ minWidth: 100, textAlign: 'right' }}>외화금액</th>
                      <th style={{ minWidth: 80, textAlign: 'right' }}>무게(kg)</th>
                      <th style={{ minWidth: 120 }}>비고</th>
                      <th style={{ width: 32 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {details.map((d, i) => (
                      <tr key={i}>
                        <td>
                          <input
                            className="form-control"
                            style={{ width: '100%', fontSize: 12 }}
                            placeholder="품목명"
                            value={d.prodName}
                            onChange={e => updateDetail(i, 'prodName', e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            className="form-control"
                            style={{ width: '100%', textAlign: 'right', fontSize: 12 }}
                            value={d.boxQty}
                            onChange={e => updateDetail(i, 'boxQty', e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            className="form-control"
                            style={{ width: '100%', textAlign: 'right', fontSize: 12 }}
                            value={d.unitPrice}
                            onChange={e => updateDetail(i, 'unitPrice', e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            className="form-control"
                            style={{ width: '100%', textAlign: 'right', fontSize: 12, background: '#f5f5f5' }}
                            value={d.totalPrice}
                            onChange={e => updateDetail(i, 'totalPrice', e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            className="form-control"
                            style={{ width: '100%', textAlign: 'right', fontSize: 12 }}
                            value={d.weight}
                            onChange={e => updateDetail(i, 'weight', e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            className="form-control"
                            style={{ width: '100%', fontSize: 12 }}
                            value={d.memo}
                            onChange={e => updateDetail(i, 'memo', e.target.value)}
                          />
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <button
                            type="button"
                            style={{
                              background: 'none', border: 'none', color: 'var(--red, #e53935)',
                              cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '2px 4px',
                            }}
                            onClick={() => setDetails(prev => prev.filter((_, j) => j !== i))}
                            title="행 삭제"
                          >×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ marginTop: 8 }}
                onClick={() => setDetails(prev => [...prev, emptyDetail()])}
              >
                ＋ 품목 추가
              </button>

              {/* 합계 미리보기 */}
              {details.some(d => d.totalPrice) && (
                <div style={{
                  marginTop: 12, padding: '8px 12px', background: 'var(--blue-bg, #e3f2fd)',
                  borderRadius: 6, fontSize: 13, color: 'var(--blue, #1565c0)',
                }}>
                  외화 합계: <strong>
                    {currSymbol(form.currencyCode)}
                    {fmtD(details.reduce((a, d) => a + (parseFloat(d.totalPrice) || 0), 0))}
                  </strong>
                  &nbsp;→ 원화: <strong>
                    ₩ {fmt(Math.round(
                      details.reduce((a, d) => a + (parseFloat(d.totalPrice) || 0), 0)
                      * (parseFloat(form.exchangeRate) || 0)
                    ))}
                  </strong>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => { setShowInput(false); resetForm(); }}>취소</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? '저장 중...' : '💾 저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
