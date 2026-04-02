// pages/sales/ar.js — 거래처별 채권관리
import { useState, useEffect, useCallback } from 'react';
import Layout from '../../components/Layout';
import { apiGet, apiPost } from '../../lib/useApi';
import { useLang } from '../../lib/i18n';

const fmt = n => Number(n || 0).toLocaleString();

const today = () => {
  const d = new Date();
  return d.toISOString().slice(0, 10);
};

const firstDayOfMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

export default function SalesAR() {
  const { t } = useLang();

  // ── 필터 상태
  const [dateFrom, setDateFrom]   = useState(firstDayOfMonth);
  const [dateTo,   setDateTo]     = useState(today);
  const [managerFilter, setManagerFilter] = useState('');
  const [onlyBalance,   setOnlyBalance]   = useState(false);

  // ── 데이터 상태
  const [customers,    setCustomers]    = useState([]);
  const [loading,      setLoading]      = useState(false);
  const [err,          setErr]          = useState('');

  // ── 원장 패널 상태
  const [selectedCust, setSelectedCust] = useState(null);
  const [ledger,       setLedger]       = useState([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerErr,    setLedgerErr]    = useState('');

  // ── 입금 모달 상태
  const [showPayment, setShowPayment] = useState(false);
  const [payForm, setPayForm] = useState({
    amount: '', ledgerDtm: today(), bankAccount: '', memo: '',
  });
  const [payLoading, setPayLoading] = useState(false);
  const [payErr, setPayErr] = useState('');

  // ── 거래처 목록 조회
  const load = useCallback(() => {
    setLoading(true);
    setErr('');
    apiGet('/api/sales/ar', { type: 'list', dateFrom, dateTo })
      .then(d => setCustomers(d.customers || []))
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo]);

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 원장 조회
  const loadLedger = useCallback((cust) => {
    setSelectedCust(cust);
    setLedger([]);
    setLedgerErr('');
    setLedgerLoading(true);
    apiGet('/api/sales/ar', { type: 'ledger', custKey: cust.custKey })
      .then(d => setLedger(d.ledger || []))
      .catch(e => setLedgerErr(e.message))
      .finally(() => setLedgerLoading(false));
  }, []);

  // ── 입금 등록 제출
  const submitPayment = async () => {
    if (!payForm.amount || !payForm.ledgerDtm) {
      setPayErr('입금금액과 입금일자를 입력하세요.');
      return;
    }
    setPayLoading(true);
    setPayErr('');
    try {
      await apiPost('/api/sales/ar', {
        custKey:     selectedCust.custKey,
        amount:      parseFloat(payForm.amount.replace(/,/g, '')),
        ledgerDtm:   payForm.ledgerDtm,
        bankAccount: payForm.bankAccount,
        memo:        payForm.memo,
      });
      setShowPayment(false);
      setPayForm({ amount: '', ledgerDtm: today(), bankAccount: '', memo: '' });
      // 원장과 목록 새로고침
      loadLedger(selectedCust);
      load();
    } catch (e) {
      setPayErr(e.message);
    } finally {
      setPayLoading(false);
    }
  };

  // ── 엑셀 다운로드
  const downloadExcel = () => {
    const rows = [
      ['거래처명', '지역', '담당자', '출고건수', '총매출', '입금액', '미수금', '최근출고일'],
      ...displayCustomers.map(c => [
        c.custName, c.area, c.manager, c.shipCount,
        c.totalSales, c.totalPaid, c.balance, c.lastShipDtm,
      ]),
    ];
    const csv = rows.map(r => r.join('\t')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/tab-separated-values;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `채권현황_${dateFrom}_${dateTo}.xls`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── 필터 적용된 목록
  const managers = [...new Set(customers.map(c => c.manager).filter(Boolean))].sort();
  const displayCustomers = customers.filter(c => {
    if (managerFilter && c.manager !== managerFilter) return false;
    if (onlyBalance && c.balance <= 0) return false;
    return true;
  });

  // ── 요약 합계
  const totalSalesSum  = displayCustomers.reduce((a, c) => a + c.totalSales, 0);
  const totalPaidSum   = displayCustomers.reduce((a, c) => a + c.totalPaid,  0);
  const totalBalanceSum = displayCustomers.reduce((a, c) => a + c.balance,   0);

  return (
    <Layout title="거래처별 채권">
      {/* ── 필터 바 ── */}
      <div className="filter-bar">
        <span className="filter-label">기간</span>
        <input
          type="date"
          className="filter-input"
          value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
          style={{ width: 120 }}
        />
        <span className="filter-label">~</span>
        <input
          type="date"
          className="filter-input"
          value={dateTo}
          onChange={e => setDateTo(e.target.value)}
          style={{ width: 120 }}
        />
        <span className="filter-label">담당자</span>
        <select
          className="filter-select"
          value={managerFilter}
          onChange={e => setManagerFilter(e.target.value)}
        >
          <option value="">전체</option>
          {managers.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={onlyBalance}
            onChange={e => setOnlyBalance(e.target.checked)}
          />
          미수금만
        </label>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={load} disabled={loading}>
            {loading ? '조회중...' : t('조회')}
          </button>
          <button className="btn" onClick={downloadExcel} disabled={displayCustomers.length === 0}>
            {t('엑셀')}
          </button>
        </div>
      </div>

      {/* ── 에러 배너 ── */}
      {err && (
        <div className="banner-err">오류: {err}</div>
      )}

      {/* ── 요약 KPI 카드 ── */}
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)', marginBottom: 6 }}>
        <div className="kpi-card kpi-accent">
          <div className="kpi-label">총 매출액</div>
          <div className="kpi-value">{fmt(totalSalesSum)}</div>
          <div className="kpi-sub">거래처 {displayCustomers.length}개</div>
        </div>
        <div className="kpi-card kpi-green">
          <div className="kpi-label">총 입금액</div>
          <div className="kpi-value">{fmt(totalPaidSum)}</div>
        </div>
        <div className="kpi-card kpi-red">
          <div className="kpi-label">총 미수금</div>
          <div className="kpi-value">{fmt(totalBalanceSum)}</div>
          <div className="kpi-sub">미수 거래처 {displayCustomers.filter(c => c.balance > 0).length}개</div>
        </div>
      </div>

      {/* ── 메인 영역: 목록 + 원장 패널 ── */}
      <div className={selectedCust ? 'split-panel' : ''} style={selectedCust ? {} : {}}>
        {/* 거래처 목록 */}
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="card-header">
            <span className="card-title">거래처별 채권 현황</span>
            <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 'auto' }}>
              {displayCustomers.length}건
            </span>
          </div>
          {loading ? (
            <div className="skeleton" style={{ margin: 8, height: 200, borderRadius: 4 }} />
          ) : displayCustomers.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📋</div>
              <div className="empty-text">조회된 채권 데이터가 없습니다.</div>
              <div className="empty-sub">기간을 조정하거나 [조회] 버튼을 눌러주세요.</div>
            </div>
          ) : (
            <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>거래처명</th>
                    <th>지역</th>
                    <th>담당자</th>
                    <th style={{ textAlign: 'right' }}>출고건수</th>
                    <th style={{ textAlign: 'right' }}>총매출</th>
                    <th style={{ textAlign: 'right' }}>입금액</th>
                    <th style={{ textAlign: 'right' }}>미수금</th>
                    <th>최근출고일</th>
                    <th style={{ width: 56 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {displayCustomers.map(c => (
                    <tr
                      key={c.custKey}
                      className={selectedCust?.custKey === c.custKey ? 'selected' : ''}
                      style={{ cursor: 'pointer' }}
                      onClick={() => loadLedger(c)}
                    >
                      <td className="name">{c.custName}</td>
                      <td>
                        {c.area && <span className="badge badge-blue">{c.area}</span>}
                      </td>
                      <td style={{ fontSize: 11 }}>{c.manager}</td>
                      <td className="num">{fmt(c.shipCount)}</td>
                      <td className="num">{fmt(c.totalSales)}</td>
                      <td className="num" style={{ color: 'var(--green)' }}>{fmt(c.totalPaid)}</td>
                      <td
                        className="num"
                        style={{
                          color: c.balance > 0 ? 'var(--red)' : 'var(--green)',
                          fontWeight: c.balance > 0 ? 700 : 400,
                        }}
                      >
                        {fmt(c.balance)}
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--text3)' }}>{c.lastShipDtm}</td>
                      <td>
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={e => { e.stopPropagation(); loadLedger(c); }}
                        >
                          원장
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="foot">
                    <td colSpan={4}>합계 ({displayCustomers.length}건)</td>
                    <td className="num">{fmt(totalSalesSum)}</td>
                    <td className="num">{fmt(totalPaidSum)}</td>
                    <td
                      className="num"
                      style={{ color: totalBalanceSum > 0 ? 'var(--red)' : 'var(--green)' }}
                    >
                      {fmt(totalBalanceSum)}
                    </td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {/* 원장 패널 */}
        {selectedCust && (
          <div className="card" style={{ marginBottom: 0 }}>
            <div className="card-header">
              <span className="card-title">
                [{selectedCust.custName}] 거래처 원장
              </span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                <button
                  className="btn btn-sm btn-success"
                  onClick={() => {
                    setPayForm({ amount: '', ledgerDtm: today(), bankAccount: '', memo: '' });
                    setPayErr('');
                    setShowPayment(true);
                  }}
                >
                  입금등록
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => { setSelectedCust(null); setLedger([]); }}
                >
                  닫기
                </button>
              </div>
            </div>

            {/* 원장 요약 */}
            <div style={{
              display: 'flex', gap: 16, padding: '6px 10px',
              background: 'var(--bg)', borderBottom: '1px solid var(--border)',
              fontSize: 12,
            }}>
              <span>지역: <strong>{selectedCust.area || '-'}</strong></span>
              <span>담당자: <strong>{selectedCust.manager || '-'}</strong></span>
              <span style={{ marginLeft: 'auto' }}>
                미수금:{' '}
                <strong style={{ color: selectedCust.balance > 0 ? 'var(--red)' : 'var(--green)' }}>
                  {fmt(selectedCust.balance)}
                </strong>
              </span>
            </div>

            {ledgerErr && <div className="banner-err" style={{ margin: 6 }}>오류: {ledgerErr}</div>}

            {ledgerLoading ? (
              <div className="skeleton" style={{ margin: 8, height: 200, borderRadius: 4 }} />
            ) : ledger.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📄</div>
                <div className="empty-text">원장 내역이 없습니다.</div>
              </div>
            ) : (
              <div className="table-wrap" style={{ border: 'none', borderRadius: 0, maxHeight: 420, overflowY: 'auto' }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>날짜</th>
                      <th>구분</th>
                      <th style={{ textAlign: 'right' }}>금액</th>
                      <th style={{ textAlign: 'right' }}>잔액</th>
                      <th>비고</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.map((row, i) => (
                      <tr key={i}>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{row.date}</td>
                        <td>
                          <span
                            className={row.type === '출고' ? 'badge badge-blue' : 'badge badge-green'}
                          >
                            {row.type}
                          </span>
                        </td>
                        <td
                          className="num"
                          style={{ color: row.type === '출고' ? 'var(--blue)' : 'var(--green)' }}
                        >
                          {row.type === '출고' ? '' : '-'}{fmt(row.amount)}
                        </td>
                        <td
                          className="num"
                          style={{
                            fontWeight: 700,
                            color: row.runningBalance > 0 ? 'var(--red)' : 'var(--green)',
                          }}
                        >
                          {fmt(row.runningBalance)}
                        </td>
                        <td style={{ fontSize: 11, color: 'var(--text3)' }}>
                          {row.memo || (row.bankAccount ? `[${row.bankAccount}]` : '')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="foot">
                      <td colSpan={3}>잔액</td>
                      <td
                        className="num"
                        style={{
                          color: (ledger[ledger.length - 1]?.runningBalance || 0) > 0
                            ? 'var(--red)' : 'var(--green)',
                        }}
                      >
                        {fmt(ledger[ledger.length - 1]?.runningBalance || 0)}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── 입금등록 모달 ── */}
      {showPayment && selectedCust && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowPayment(false); }}>
          <div className="modal">
            <div className="modal-header">
              <span className="modal-title">입금 등록</span>
              <button
                className="btn btn-sm"
                onClick={() => setShowPayment(false)}
                style={{ marginLeft: 'auto' }}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              {payErr && <div className="banner-err" style={{ marginBottom: 8 }}>{payErr}</div>}

              <div className="form-group" style={{ marginBottom: 8 }}>
                <label className="form-label">거래처</label>
                <input
                  className="form-control"
                  value={selectedCust.custName}
                  readOnly
                  style={{ background: 'var(--bg)', color: 'var(--text3)' }}
                />
              </div>

              <div className="form-row" style={{ marginBottom: 0 }}>
                <div className="form-group">
                  <label className="form-label">입금일자 *</label>
                  <input
                    type="date"
                    className="form-control"
                    value={payForm.ledgerDtm}
                    onChange={e => setPayForm(f => ({ ...f, ledgerDtm: e.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">입금금액 *</label>
                  <input
                    type="number"
                    className="form-control"
                    placeholder="0"
                    value={payForm.amount}
                    onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))}
                    style={{ textAlign: 'right' }}
                    min="0"
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginTop: 8, marginBottom: 8 }}>
                <label className="form-label">입금계좌</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="예: 국민은행 123-456"
                  value={payForm.bankAccount}
                  onChange={e => setPayForm(f => ({ ...f, bankAccount: e.target.value }))}
                />
              </div>

              <div className="form-group">
                <label className="form-label">메모</label>
                <textarea
                  className="form-control"
                  rows={2}
                  placeholder="메모 입력"
                  value={payForm.memo}
                  onChange={e => setPayForm(f => ({ ...f, memo: e.target.value }))}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-primary"
                onClick={submitPayment}
                disabled={payLoading}
              >
                {payLoading ? '등록중...' : '입금 등록'}
              </button>
              <button className="btn" onClick={() => setShowPayment(false)}>취소</button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
