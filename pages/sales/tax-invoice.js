// pages/sales/tax-invoice.js
// 세금계산서 진행단계 — 이카운트 "(세금)계산서진행단계" 화면

import { useState, useEffect, useCallback } from 'react';
// Layout은 _app.js에서 전역 제공
import { apiGet, apiPost, apiPatch, apiDelete } from '../../lib/useApi';


const fmt = n => Number(n || 0).toLocaleString();

// 진행단계 정의
const STEPS = ['출고완료', '판매반영', '발행완료', '전자발송', '완료'];
const STEP_COLORS = {
  '출고완료': { bg: '#e5e7eb', color: '#374151' },
  '판매반영': { bg: '#dbeafe', color: '#1d4ed8' },
  '발행완료': { bg: '#fed7aa', color: '#c2410c' },
  '전자발송': { bg: '#d1fae5', color: '#065f46' },
  '완료':     { bg: '#064e3b', color: '#ecfdf5' },
};

const TAX_TYPES = ['세금계산서', '계산서', '영수증'];

function StepBadge({ step }) {
  const c = STEP_COLORS[step] || { bg: '#e5e7eb', color: '#374151' };
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 12,
      fontSize: 11, fontWeight: 700, background: c.bg, color: c.color,
    }}>
      {step}
    </span>
  );
}

// 다음 단계 반환
function nextStep(cur) {
  const idx = STEPS.indexOf(cur);
  return idx >= 0 && idx < STEPS.length - 1 ? STEPS[idx + 1] : null;
}

export default function TaxInvoice() {
  // 필터 상태
  const today = new Date();
  const defaultMonth = today.toISOString().slice(0, 7);
  const [month, setMonth]       = useState(defaultMonth);
  const [custFilter, setCustFilter] = useState('');
  const [stepFilter, setStepFilter] = useState('전체');

  // 데이터 상태
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading]   = useState(false);
  const [err, setErr]           = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // 신규등록 모달
  const [showNew, setShowNew]   = useState(false);
  const [newForm, setNewForm]   = useState({
    invDtm: today.toISOString().slice(0, 10),
    custName: '', supplyAmt: '', vatAmt: '', taxType: '세금계산서', memo: '',
  });
  const [saving, setSaving]     = useState(false);

  // 단계변경 모달
  const [stepTarget, setStepTarget] = useState(null); // { taxInvKey, progressStep, custName }
  const [elecTaxNo, setElecTaxNo]   = useState('');
  const [stepping, setStepping]     = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setErr('');
    apiGet('/api/sales/tax-invoice', {
      month: month || undefined,
      custName: custFilter || undefined,
      step: stepFilter !== '전체' ? stepFilter : undefined,
    })
      .then(d => setInvoices(d.invoices || []))
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [month, custFilter, stepFilter]);

  useEffect(() => { load(); }, []);

  // 부가세 자동계산
  const handleSupplyChange = (v) => {
    const n = parseFloat(v) || 0;
    setNewForm(f => ({ ...f, supplyAmt: v, vatAmt: String(Math.round(n * 0.1)) }));
  };

  const handleCreate = async () => {
    if (!newForm.custName) { alert('거래처명을 입력하세요.'); return; }
    if (!newForm.invDtm)   { alert('일자를 입력하세요.'); return; }
    setSaving(true);
    try {
      await apiPost('/api/sales/tax-invoice', {
        invDtm:    newForm.invDtm,
        custName:  newForm.custName,
        supplyAmt: parseFloat(newForm.supplyAmt) || 0,
        vatAmt:    parseFloat(newForm.vatAmt) || 0,
        taxType:   newForm.taxType,
        memo:      newForm.memo,
      });
      setShowNew(false);
      setSuccessMsg('등록되었습니다.');
      setTimeout(() => setSuccessMsg(''), 3000);
      load();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const openStepModal = (inv) => {
    setStepTarget(inv);
    setElecTaxNo(inv.elecTaxNo || '');
    setStepping(false);
  };

  const handleStepChange = async () => {
    if (!stepTarget) return;
    const next = nextStep(stepTarget.progressStep);
    if (!next) return;

    // 전자발송 단계로 이동할 때 전자발송번호 필수
    if (next === '전자발송' && !elecTaxNo.trim()) {
      alert('전자발송번호를 입력하세요.');
      return;
    }

    setStepping(true);
    try {
      await apiPatch('/api/sales/tax-invoice', {
        taxInvKey:    stepTarget.taxInvKey,
        progressStep: next,
        elecTaxNo:    elecTaxNo || undefined,
      });
      setStepTarget(null);
      setSuccessMsg('단계가 변경되었습니다.');
      setTimeout(() => setSuccessMsg(''), 3000);
      load();
    } catch (e) { alert(e.message); }
    finally { setStepping(false); }
  };

  const handleDelete = async (inv) => {
    if (!confirm(`[${inv.custName}] 항목을 삭제하시겠습니까?`)) return;
    try {
      await apiDelete('/api/sales/tax-invoice', { taxInvKey: inv.taxInvKey });
      setSuccessMsg('삭제되었습니다.');
      setTimeout(() => setSuccessMsg(''), 3000);
      load();
    } catch (e) { alert(e.message); }
  };

  // 이카운트 자동분개
  const handleAccounting = async (inv) => {
    if (!confirm(`[${inv.custName}] 자동분개를 이카운트에 전송하시겠습니까?`)) return;
    try {
      const data = await apiPost('/api/ecount/accounting', { taxInvKeys: [inv.taxInvKey] });
      setSuccessMsg(`자동분개 전송 완료: ${data.pushed}건`);
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (e) {
      alert(`자동분개 오류: ${e.message}`);
    }
  };

  // 단계별 집계
  const stepSummary = STEPS.map(step => ({
    step,
    count:  invoices.filter(i => i.progressStep === step).length,
    total:  invoices.filter(i => i.progressStep === step).reduce((a, i) => a + i.totalAmt, 0),
  }));

  return (
    <>
      {/* 필터바 */}
      <div className="filter-bar">
        <label style={{ fontSize: 12, color: 'var(--text3)' }}>월</label>
        <input
          type="month" value={month}
          onChange={e => setMonth(e.target.value)}
          style={{ padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }}
        />
        <label style={{ fontSize: 12, color: 'var(--text3)' }}>거래처</label>
        <input
          className="filter-input" placeholder="거래처명"
          value={custFilter} onChange={e => setCustFilter(e.target.value)}
          style={{ minWidth: 160 }}
        />
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          {['전체', ...STEPS].map(s => (
            <button
              key={s}
              className={stepFilter === s ? 'chip chip-active' : 'chip'}
              onClick={() => setStepFilter(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={load}>조회</button>
          <button className="btn btn-success" onClick={() => {
            setNewForm({ invDtm: new Date().toISOString().slice(0, 10), custName: '', supplyAmt: '', vatAmt: '', taxType: '세금계산서', memo: '' });
            setShowNew(true);
          }}>＋ 신규등록</button>
        </div>
      </div>

      {/* 메시지 배너 */}
      {err        && <div className="banner-err" style={{ marginBottom: 10 }}>⚠️ {err}</div>}
      {successMsg && <div className="banner-ok"  style={{ marginBottom: 10 }}>✔ {successMsg}</div>}

      {/* 진행단계 요약 카드 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 16 }}>
        {stepSummary.map(({ step, count, total }) => {
          const c = STEP_COLORS[step];
          return (
            <div key={step} className="card" style={{ padding: '10px 14px', cursor: 'pointer', borderTop: `3px solid ${c.color}` }}
              onClick={() => setStepFilter(stepFilter === step ? '전체' : step)}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: c.color, marginBottom: 4 }}>{step}</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--text1)' }}>{count}<span style={{ fontSize: 12, fontWeight: 400, marginLeft: 2 }}>건</span></div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{fmt(total)}원</div>
            </div>
          );
        })}
      </div>

      {/* 테이블 */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">세금계산서 목록</span>
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>총 {invoices.length}건</span>
        </div>
        {loading ? (
          <div className="skeleton" style={{ height: 300, borderRadius: 0 }}></div>
        ) : invoices.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text3)', fontSize: 14 }}>
            조회된 데이터가 없습니다.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>일자</th>
                  <th>번호</th>
                  <th>거래처명</th>
                  <th style={{ textAlign: 'right' }}>공급가액</th>
                  <th style={{ textAlign: 'right' }}>부가세</th>
                  <th style={{ textAlign: 'right' }}>합계금액</th>
                  <th>종류</th>
                  <th>진행단계</th>
                  <th>전자발송번호</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => (
                  <tr key={inv.taxInvKey}>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{inv.invDtm?.slice(0, 10)}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>{inv.taxInvKey}</td>
                    <td style={{ fontWeight: 500 }}>{inv.custName}</td>
                    <td className="num">{fmt(inv.supplyAmt)}</td>
                    <td className="num" style={{ color: 'var(--text3)' }}>{fmt(inv.vatAmt)}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{fmt(inv.totalAmt)}</td>
                    <td>
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: '#f3f4f6', color: '#374151' }}>
                        {inv.taxType}
                      </span>
                    </td>
                    <td><StepBadge step={inv.progressStep} /></td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>
                      {inv.elecTaxNo || '—'}
                    </td>
                    <td style={{ whiteSpace: 'nowrap', display: 'flex', gap: 4 }}>
                      {nextStep(inv.progressStep) && (
                        <button className="btn btn-sm btn-primary"
                          onClick={() => openStepModal(inv)}
                          title="단계 변경"
                        >
                          단계변경
                        </button>
                      )}
                      <button
                        className="btn btn-sm"
                        style={{ background: '#1a5276', color: '#fff', borderColor: '#154360', fontSize: 11 }}
                        onClick={() => handleAccounting(inv)}
                        title="이카운트 자동분개 전송"
                      >
                        자동분개
                      </button>
                      <button className="btn btn-sm"
                        style={{ color: 'var(--red)', borderColor: 'var(--red)' }}
                        onClick={() => handleDelete(inv)}
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 신규등록 모달 */}
      {showNew && (
        <div className="modal-overlay" onClick={() => setShowNew(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ minWidth: 440 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16 }}>세금계산서 신규등록</div>

            <div style={{ display: 'grid', gap: 12 }}>
              <label style={labelSt}>
                <span>일자 *</span>
                <input type="date" value={newForm.invDtm}
                  onChange={e => setNewForm(f => ({ ...f, invDtm: e.target.value }))}
                  style={inputSt} />
              </label>
              <label style={labelSt}>
                <span>거래처명 *</span>
                <input type="text" value={newForm.custName} placeholder="거래처명 입력"
                  onChange={e => setNewForm(f => ({ ...f, custName: e.target.value }))}
                  style={inputSt} />
              </label>
              <label style={labelSt}>
                <span>공급가액</span>
                <input type="number" value={newForm.supplyAmt} placeholder="0"
                  onChange={e => handleSupplyChange(e.target.value)}
                  style={{ ...inputSt, textAlign: 'right' }} />
              </label>
              <label style={labelSt}>
                <span>부가세 (자동)</span>
                <input type="number" value={newForm.vatAmt} placeholder="0"
                  onChange={e => setNewForm(f => ({ ...f, vatAmt: e.target.value }))}
                  style={{ ...inputSt, textAlign: 'right' }} />
              </label>
              <div style={{ ...labelSt, background: '#f9fafb', borderRadius: 6, padding: '6px 10px' }}>
                <span style={{ fontSize: 12, color: 'var(--text3)' }}>합계금액</span>
                <span style={{ fontWeight: 700, fontSize: 15 }}>
                  {fmt((parseFloat(newForm.supplyAmt) || 0) + (parseFloat(newForm.vatAmt) || 0))}원
                </span>
              </div>
              <label style={labelSt}>
                <span>종류</span>
                <select value={newForm.taxType}
                  onChange={e => setNewForm(f => ({ ...f, taxType: e.target.value }))}
                  style={inputSt}>
                  {TAX_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </label>
              <label style={labelSt}>
                <span>메모</span>
                <input type="text" value={newForm.memo} placeholder="메모"
                  onChange={e => setNewForm(f => ({ ...f, memo: e.target.value }))}
                  style={inputSt} />
              </label>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <button className="btn" onClick={() => setShowNew(false)}>취소</button>
              <button className="btn btn-primary" onClick={handleCreate} disabled={saving}>
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 단계변경 모달 */}
      {stepTarget && (
        <div className="modal-overlay" onClick={() => setStepTarget(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ minWidth: 380 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16 }}>진행단계 변경</div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 4 }}>거래처</div>
              <div style={{ fontWeight: 600 }}>{stepTarget.custName}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <StepBadge step={stepTarget.progressStep} />
              <span style={{ fontSize: 16, color: 'var(--text3)' }}>→</span>
              {nextStep(stepTarget.progressStep)
                ? <StepBadge step={nextStep(stepTarget.progressStep)} />
                : <span style={{ color: 'var(--text3)', fontSize: 13 }}>최종 단계입니다</span>
              }
            </div>

            {/* 전자발송 단계로 이동할 때 전자발송번호 입력 */}
            {nextStep(stepTarget.progressStep) === '전자발송' && (
              <label style={{ ...labelSt, marginBottom: 16 }}>
                <span>전자발송번호 *</span>
                <input type="text" value={elecTaxNo} placeholder="전자세금계산서 발행번호"
                  onChange={e => setElecTaxNo(e.target.value)}
                  style={inputSt} autoFocus />
              </label>
            )}

            {/* 전자발송번호 수정 (이미 전자발송번호가 있거나 발행완료 이후) */}
            {nextStep(stepTarget.progressStep) !== '전자발송' && stepTarget.elecTaxNo && (
              <label style={{ ...labelSt, marginBottom: 16 }}>
                <span>전자발송번호</span>
                <input type="text" value={elecTaxNo}
                  onChange={e => setElecTaxNo(e.target.value)}
                  style={inputSt} />
              </label>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setStepTarget(null)}>취소</button>
              {nextStep(stepTarget.progressStep) && (
                <button className="btn btn-primary" onClick={handleStepChange} disabled={stepping}>
                  {stepping ? '변경 중...' : `→ ${nextStep(stepTarget.progressStep)}으로 변경`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// 인라인 스타일 상수
const labelSt = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 13 };
const inputSt = { padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, flex: 1 };
