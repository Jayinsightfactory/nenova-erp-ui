// pages/finance/bank.js
// 입/출금 계좌 조회 (샘플 모드)

import { useState, useEffect, useCallback } from 'react';
import Layout from '../../components/Layout';
import { apiGet, apiPost, apiDelete } from '../../lib/useApi';

const fmt = n => Number(n || 0).toLocaleString();

function today() {
  return new Date().toISOString().slice(0, 10);
}
function monthAgo() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
}

export default function BankPage() {
  // 필터
  const [dateFrom, setDateFrom] = useState(monthAgo);
  const [dateTo,   setDateTo]   = useState(today);
  const [txType,   setTxType]   = useState('전체');
  const [accountFilter, setAccountFilter] = useState('');
  const [custFilter,    setCustFilter]    = useState('');

  // 데이터
  const [transactions, setTransactions] = useState([]);
  const [summary, setSummary] = useState({ totalIn: 0, totalOut: 0, netAmount: 0 });
  const [loading, setLoading]  = useState(false);
  const [err, setErr]          = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // 수동입력 모달
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    txDtm: today(), txType: '입금',
    accountNo: '', accountName: '', custName: '',
    amount: '', balance: '', counterpart: '',
    bankName: '', branchName: '', memo: '',
  });
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setErr('');
    apiGet('/api/finance/bank', {
      dateFrom:  dateFrom  || undefined,
      dateTo:    dateTo    || undefined,
      txType:    txType !== '전체' ? txType : undefined,
      accountNo: accountFilter || undefined,
      custName:  custFilter    || undefined,
    })
      .then(d => {
        setTransactions(d.transactions || []);
        setSummary(d.summary || { totalIn: 0, totalOut: 0, netAmount: 0 });
        setErr('');
      })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo, txType, accountFilter, custFilter]);

  useEffect(() => { load(); }, []);

  const openModal = () => {
    setForm({
      txDtm: today(), txType: '입금',
      accountNo: '', accountName: '', custName: '',
      amount: '', balance: '', counterpart: '',
      bankName: '', branchName: '', memo: '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.txDtm || !form.amount) {
      alert('일자와 금액은 필수입니다.');
      return;
    }
    setSaving(true);
    try {
      await apiPost('/api/finance/bank', {
        txDtm:       form.txDtm,
        txType:      form.txType,
        accountNo:   form.accountNo,
        accountName: form.accountName,
        custName:    form.custName,
        amount:      parseFloat(form.amount) || 0,
        balance:     parseFloat(form.balance) || 0,
        counterpart: form.counterpart,
        bankName:    form.bankName,
        branchName:  form.branchName,
        memo:        form.memo,
      });
      setShowModal(false);
      setSuccessMsg('저장되었습니다.');
      setTimeout(() => setSuccessMsg(''), 3000);
      load();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async (tx) => {
    if (!confirm(`[${tx.txDtm?.slice(0, 10)} / ${tx.txType} / ${fmt(tx.amount)}원] 항목을 삭제하시겠습니까?`)) return;
    try {
      await apiDelete('/api/finance/bank', { txKey: tx.txKey });
      setSuccessMsg('삭제되었습니다.');
      setTimeout(() => setSuccessMsg(''), 3000);
      load();
    } catch (e) { alert(e.message); }
  };

  const f = k => e => setForm(prev => ({ ...prev, [k]: e.target.value }));

  return (
    <Layout title="입/출금 계좌 조회">
      {/* 샘플모드 배너 */}
      <div style={{
        background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8,
        padding: '10px 16px', marginBottom: 14, display: 'flex',
        alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 13, color: '#1d4ed8', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 16 }}>🏦</span>
            <strong>현재 샘플 모드입니다.</strong>
            &nbsp;신한은행 API 연동 완료 후 실시간 데이터로 전환됩니다.
          </span>
          <span style={{ fontSize: 12, color: '#3b82f6', paddingLeft: 22 }}>
            💡 신한은행 API 연동 후 수납 데이터는 이카운트 회계 자동분개와 연동되어 전표가 자동 생성됩니다.
            &nbsp;<a href="/ecount/dashboard" style={{ color: '#1d4ed8', textDecoration: 'underline' }}>이카운트 연동 현황 보기 →</a>
          </span>
        </div>
        <button className="btn btn-sm btn-primary" onClick={openModal}>
          직접 입력으로 테스트하기
        </button>
      </div>

      {/* 필터바 */}
      <div className="filter-bar">
        <label style={{ fontSize: 12, color: 'var(--text3)' }}>기간</label>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          style={inputSt} />
        <span style={{ color: 'var(--text3)' }}>~</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          style={inputSt} />
        <div style={{ display: 'flex', gap: 4 }}>
          {['전체', '입금', '출금'].map(t => (
            <button key={t}
              className={txType === t ? 'chip chip-active' : 'chip'}
              onClick={() => setTxType(t)}>{t}
            </button>
          ))}
        </div>
        <input className="filter-input" placeholder="계좌번호"
          value={accountFilter} onChange={e => setAccountFilter(e.target.value)}
          style={{ minWidth: 120 }} />
        <input className="filter-input" placeholder="거래처명"
          value={custFilter} onChange={e => setCustFilter(e.target.value)}
          style={{ minWidth: 130 }} />
        <div className="page-actions">
          <button className="btn btn-primary" onClick={load}>조회</button>
          <button className="btn btn-success" onClick={openModal}>＋ 수동입력</button>
        </div>
      </div>

      {/* 메시지 배너 */}
      {err        && <div className="banner-err" style={{ marginBottom: 10 }}>⚠️ {err}</div>}
      {successMsg && <div className="banner-ok"  style={{ marginBottom: 10 }}>✔ {successMsg}</div>}

      {/* 요약 카드 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
        <div className="card" style={{ padding: '12px 16px', borderTop: '3px solid #1d4ed8' }}>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>총 입금</div>
          <div style={{ fontSize: 20, fontWeight: 900, color: '#1d4ed8' }}>{fmt(summary.totalIn)}<span style={{ fontSize: 12, marginLeft: 2 }}>원</span></div>
        </div>
        <div className="card" style={{ padding: '12px 16px', borderTop: '3px solid #dc2626' }}>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>총 출금</div>
          <div style={{ fontSize: 20, fontWeight: 900, color: '#dc2626' }}>{fmt(summary.totalOut)}<span style={{ fontSize: 12, marginLeft: 2 }}>원</span></div>
        </div>
        <div className="card" style={{ padding: '12px 16px', borderTop: `3px solid ${summary.netAmount >= 0 ? '#065f46' : '#dc2626'}` }}>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>잔액 (입금 - 출금)</div>
          <div style={{ fontSize: 20, fontWeight: 900, color: summary.netAmount >= 0 ? '#065f46' : '#dc2626' }}>
            {summary.netAmount < 0 ? '-' : ''}{fmt(Math.abs(summary.netAmount))}<span style={{ fontSize: 12, marginLeft: 2 }}>원</span>
          </div>
        </div>
      </div>

      {/* 테이블 */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">입/출금 내역</span>
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>총 {transactions.length}건</span>
        </div>
        {loading ? (
          <div className="skeleton" style={{ height: 300, borderRadius: 0 }}></div>
        ) : transactions.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text3)', fontSize: 14 }}>
            조회된 데이터가 없습니다. 수동 입력으로 테스트 데이터를 추가해보세요.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>입출금일자</th>
                  <th>구분</th>
                  <th>계좌번호</th>
                  <th>계좌명</th>
                  <th>거래처명</th>
                  <th style={{ textAlign: 'right' }}>금액</th>
                  <th style={{ textAlign: 'right' }}>원화잔액</th>
                  <th>입금처/출금처</th>
                  <th>비고</th>
                  <th>지점명</th>
                  <th>상대은행</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {transactions.map(tx => (
                  <tr key={tx.txKey}>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{tx.txDtm?.slice(0, 10)}</td>
                    <td>
                      <span style={{
                        display: 'inline-block', padding: '2px 10px', borderRadius: 12,
                        fontSize: 11, fontWeight: 700,
                        background: tx.txType === '입금' ? '#dbeafe' : '#fee2e2',
                        color: tx.txType === '입금' ? '#1d4ed8' : '#dc2626',
                      }}>
                        {tx.txType}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{tx.accountNo || '—'}</td>
                    <td style={{ fontSize: 12 }}>{tx.accountName || '—'}</td>
                    <td style={{ fontWeight: 500 }}>{tx.custName || '—'}</td>
                    <td className="num" style={{
                      fontWeight: 700,
                      color: tx.txType === '입금' ? '#1d4ed8' : '#dc2626',
                    }}>
                      {tx.txType === '출금' ? '−' : ''}{fmt(tx.amount)}
                    </td>
                    <td className="num" style={{ color: 'var(--text3)' }}>{fmt(tx.balance)}</td>
                    <td style={{ fontSize: 12 }}>{tx.counterpart || '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--text3)' }}>{tx.memo || '—'}</td>
                    <td style={{ fontSize: 12 }}>{tx.branchName || '—'}</td>
                    <td style={{ fontSize: 12 }}>{tx.bankName || '—'}</td>
                    <td>
                      {tx.isSample && (
                        <button className="btn btn-sm"
                          style={{ color: 'var(--red)', borderColor: 'var(--red)' }}
                          onClick={() => handleDelete(tx)}
                          title="샘플 데이터 삭제"
                        >
                          삭제
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 수동입력 모달 */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ minWidth: 480, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16 }}>입/출금 수동 입력 (샘플)</div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label style={rowLbl}>
                <span>입출금일자 *</span>
                <input type="date" value={form.txDtm} onChange={f('txDtm')} style={inputSt} />
              </label>
              <div style={rowLbl}>
                <span>구분 *</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  {['입금', '출금'].map(t => (
                    <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 13 }}>
                      <input type="radio" name="txType" value={t}
                        checked={form.txType === t}
                        onChange={f('txType')} />
                      {t}
                    </label>
                  ))}
                </div>
              </div>
              <label style={rowLbl}>
                <span>계좌번호</span>
                <input type="text" value={form.accountNo} onChange={f('accountNo')} placeholder="000-000-0000" style={inputSt} />
              </label>
              <label style={rowLbl}>
                <span>계좌명</span>
                <input type="text" value={form.accountName} onChange={f('accountName')} placeholder="계좌명" style={inputSt} />
              </label>
              <label style={rowLbl}>
                <span>거래처명</span>
                <input type="text" value={form.custName} onChange={f('custName')} placeholder="거래처명" style={inputSt} />
              </label>
              <label style={rowLbl}>
                <span>금액 *</span>
                <input type="number" value={form.amount} onChange={f('amount')} placeholder="0" style={{ ...inputSt, textAlign: 'right' }} />
              </label>
              <label style={rowLbl}>
                <span>원화잔액</span>
                <input type="number" value={form.balance} onChange={f('balance')} placeholder="0" style={{ ...inputSt, textAlign: 'right' }} />
              </label>
              <label style={rowLbl}>
                <span>입금처/출금처</span>
                <input type="text" value={form.counterpart} onChange={f('counterpart')} placeholder="상대방 이름" style={inputSt} />
              </label>
              <label style={rowLbl}>
                <span>상대은행</span>
                <input type="text" value={form.bankName} onChange={f('bankName')} placeholder="은행명" style={inputSt} />
              </label>
              <label style={rowLbl}>
                <span>지점명</span>
                <input type="text" value={form.branchName} onChange={f('branchName')} placeholder="지점명" style={inputSt} />
              </label>
              <label style={{ ...rowLbl, gridColumn: '1 / -1' }}>
                <span>비고</span>
                <input type="text" value={form.memo} onChange={f('memo')} placeholder="메모" style={inputSt} />
              </label>
            </div>

            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 10 }}>
              ※ IsSample=1로 저장되며, 이후 실제 은행 API 연동 시 샘플 데이터를 정리할 수 있습니다.
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn" onClick={() => setShowModal(false)}>취소</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

const inputSt = { padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, flex: 1 };
const rowLbl  = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text2)' };
