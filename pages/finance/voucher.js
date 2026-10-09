// pages/finance/voucher.js — 지출결의서 (목록 + 입력 모달)
// 명세 §7-1 지출결의서 / §7-2 지급결의서(외화송금) / §7-3 해외직원 급여 / §11 입력화면
// 헤더: 일자-No.(자동채번) 회계년도(자동) 거래처 기간 담당자 통화/환율 첨부URL  라인: 계정과목 금액 외화금액 적요 부서 차수(다행, 합계 자동)
// 상태: 작성→결재완료(전표 자동생성)→송금완료→전표반영. Layout 은 _app.js 가 제공(직접 import 금지).
import { useState, useEffect, useCallback, useMemo } from 'react';
import { apiGet, apiPost, apiFetch } from '../../lib/useApi';

const fmt = (n) => Number(n || 0).toLocaleString();
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => today().slice(0, 7) + '-01';
const TYPES = ['지출', '지급', '급여'];
const STATUSES = ['작성', '결재완료', '송금완료', '전표반영', '취소'];
const TYPE_LABEL = { 지출: '지출결의서', 지급: '지급결의서(외화송금)', 급여: '급여 결의서' };
const DEFAULT_ACCOUNT = { 지출: '', 지급: '251', 급여: '802' };
const STATUS_COLOR = { 작성: '#6b7280', 결재완료: '#1d4ed8', 송금완료: '#b45309', 전표반영: '#065f46', 취소: '#dc2626' };
const CURRENCIES = ['KRW', 'USD', 'EUR', 'AUD', 'COP', 'CNY', 'JPY'];

const emptyLine = (type) => ({ accountCode: DEFAULT_ACCOUNT[type] || '', amount: '', foreignAmount: '', descr: '', dept: '', orderYearWeek: '' });
const emptyForm = (type = '지출') => ({
  voucherType: type, voucherDate: today(), custKey: '', custName: '', period: '', manager: '', employeeName: '', fundCode: '',
  currency: type === '지급' ? 'USD' : 'KRW', fxRate: type === '지급' ? '' : '1', attachUrl: '', memo: '',
  lines: [emptyLine(type), emptyLine(type), emptyLine(type)],
});

export default function VoucherPage() {
  // 필터(명세: 기간·거래처·유형·상태·금액·적요)
  const [flt, setFlt] = useState({ dateFrom: monthStart(), dateTo: today(), voucherType: '', status: '', custName: '', amountMin: '', amountMax: '', descr: '', voucherNo: '' });
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [modal, setModal] = useState(null); // {mode:'new'|'edit'|'view', form, voucher}
  const [saving, setSaving] = useState(false);
  const [custSuggest, setCustSuggest] = useState([]);

  const load = useCallback(() => {
    setLoading(true); setErr('');
    apiGet('/api/finance/voucher', flt)
      .then((d) => { setRows(d.rows || []); setTotal(d.total || 0); })
      .catch((e) => setErr(e.message)).finally(() => setLoading(false));
  }, [flt]);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { apiGet('/api/finance/voucher/accounts').then((d) => setAccounts(d.accounts || [])).catch(() => setAccounts([])); }, []);

  const toast = (t) => { setMsg(t); setTimeout(() => setMsg(''), 3000); };
  const accountName = (code) => accounts.find((a) => a.accountCode === code)?.accountName || '';

  const openNew = (type = '지출') => setModal({ mode: 'new', form: emptyForm(type) });
  const openDetail = async (v) => {
    try {
      const d = await apiGet(`/api/finance/voucher/${v.voucherKey}`);
      const vv = d.voucher;
      const form = {
        voucherType: vv.voucherType, voucherDate: vv.voucherDate, custKey: vv.custKey || '', custName: vv.custName, period: vv.period, manager: vv.manager,
        employeeName: vv.employeeName, fundCode: vv.fundCode, currency: vv.currency, fxRate: String(vv.fxRate), attachUrl: vv.attachUrl, memo: vv.memo,
        lines: vv.lines.map((l) => ({ accountCode: l.accountCode, amount: String(l.amount), foreignAmount: l.foreignAmount ? String(l.foreignAmount) : '', descr: l.descr, dept: l.dept, orderYearWeek: l.orderYearWeek })),
      };
      setModal({ mode: vv.status === '작성' ? 'edit' : 'view', form, voucher: vv });
    } catch (e) { alert(e.message); }
  };

  const save = async () => {
    const f = modal.form;
    setSaving(true);
    try {
      const body = { ...f, custKey: f.custKey || null, fxRate: Number(f.fxRate || 0), lines: f.lines.filter((l) => l.accountCode || l.amount || l.foreignAmount) };
      if (modal.mode === 'new') { const r = await apiPost('/api/finance/voucher', body); toast(`저장: ${r.voucherNo}`); }
      else { await apiFetch(`/api/finance/voucher/${modal.voucher.voucherKey}`, { method: 'PUT', body }); toast('수정 저장'); }
      setModal(null); load();
    } catch (e) { alert(e.message); } finally { setSaving(false); }
  };
  const act = async (v, action, label) => {
    if (!confirm(`[${v.voucherNo} ${fmt(v.totalAmount)}원] ${label} 처리할까요?`)) return;
    try { const r = await apiPost('/api/finance/voucher/post-journal', { voucherKey: v.voucherKey, action }); toast(`${label} 완료${r.journal ? ` · 전표 ${r.journal.journalNo}` : ''}`); setModal(null); load(); }
    catch (e) { alert(e.message); }
  };
  const remove = async (v) => {
    if (!confirm(`[${v.voucherNo}] 삭제할까요? (작성 상태만)`)) return;
    try { await apiFetch(`/api/finance/voucher/${v.voucherKey}`, { method: 'DELETE' }); toast('삭제'); setModal(null); load(); } catch (e) { alert(e.message); }
  };

  const F = (k) => (e) => setFlt((p) => ({ ...p, [k]: e.target.value }));
  const byStatus = useMemo(() => STATUSES.map((s) => ({ s, n: rows.filter((r) => r.status === s).length, amt: rows.filter((r) => r.status === s).reduce((a, r) => a + r.totalAmount, 0) })), [rows]);

  return (
    <>
      <div className="filter-bar" style={{ flexWrap: 'wrap', gap: 6 }}>
        <input type="date" className="filter-input" value={flt.dateFrom} onChange={F('dateFrom')} />
        <span>~</span>
        <input type="date" className="filter-input" value={flt.dateTo} onChange={F('dateTo')} />
        <select className="filter-input" value={flt.voucherType} onChange={F('voucherType')}><option value="">유형 전체</option>{TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</select>
        <select className="filter-input" value={flt.status} onChange={F('status')}><option value="">상태 전체</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
        <input className="filter-input" placeholder="거래처명" value={flt.custName} onChange={F('custName')} style={{ width: 130 }} />
        <input className="filter-input" placeholder="일자-No." value={flt.voucherNo} onChange={F('voucherNo')} style={{ width: 100 }} />
        <input className="filter-input" placeholder="금액≥" value={flt.amountMin} onChange={F('amountMin')} style={{ width: 100 }} />
        <input className="filter-input" placeholder="금액≤" value={flt.amountMax} onChange={F('amountMax')} style={{ width: 100 }} />
        <input className="filter-input" placeholder="적요" value={flt.descr} onChange={F('descr')} style={{ width: 150 }} onKeyDown={(e) => e.key === 'Enter' && load()} />
        <div className="page-actions">
          <button className="btn btn-primary" onClick={load}>조회</button>
          <button className="btn btn-success" onClick={() => openNew('지출')}>＋ 지출결의서</button>
          <button className="btn btn-success" onClick={() => openNew('지급')}>＋ 지급결의서(외화)</button>
          <button className="btn btn-success" onClick={() => openNew('급여')}>＋ 급여 결의서</button>
        </div>
      </div>
      {err && <div className="banner-err" style={{ marginBottom: 10 }}>⚠️ {err}</div>}
      {msg && <div className="banner-ok" style={{ marginBottom: 10 }}>✔ {msg}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
        <div className="card" style={{ padding: '10px 14px', borderTop: '3px solid #111827' }}><div style={{ fontSize: 12, color: 'var(--text3)' }}>조회 합계</div><div style={{ fontSize: 20, fontWeight: 700 }}>{fmt(total)}</div><div style={{ fontSize: 12 }}>{rows.length}건</div></div>
        {byStatus.map((b) => (
          <div key={b.s} className="card" style={{ padding: '10px 14px', borderTop: `3px solid ${STATUS_COLOR[b.s]}` }}><div style={{ fontSize: 12, color: 'var(--text3)' }}>{b.s}</div><div style={{ fontSize: 18, fontWeight: 700 }}>{fmt(b.amt)}</div><div style={{ fontSize: 12 }}>{b.n}건</div></div>
        ))}
      </div>

      <div className="card">
        <div className="card-header"><span className="card-title">지출결의서 목록</span><span style={{ fontSize: 12, color: 'var(--text3)' }}>행 클릭 → 상세/수정 · 전표는 결재완료 시 자동 생성</span></div>
        {loading ? <div className="skeleton" style={{ height: 240 }} /> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead><tr><th>일자-No.</th><th>유형</th><th>회계년도</th><th>거래처</th><th>기간</th><th>담당자</th><th>통화</th><th className="num">외화</th><th className="num">합계(원)</th><th>상태</th><th>전표No</th><th>첨부</th><th>작성</th></tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={13} style={{ textAlign: 'center', color: 'var(--text3)', padding: 30 }}>조회 결과 없음</td></tr>}
                {rows.map((v) => (
                  <tr key={v.voucherKey} style={{ cursor: 'pointer' }} onClick={() => openDetail(v)}>
                    <td style={{ fontFamily: 'monospace' }}>{v.voucherNo}</td><td>{TYPE_LABEL[v.voucherType]}</td><td>{v.fiscalYear}</td><td>{v.custName || (v.employeeName ? `직원 ${v.employeeName}` : '')}</td>
                    <td>{v.period}</td><td>{v.manager}</td><td>{v.currency}{v.currency !== 'KRW' ? ` @${v.fxRate}` : ''}</td>
                    <td className="num">{v.totalForeign ? fmt(v.totalForeign) : ''}</td><td className="num" style={{ fontWeight: 600 }}>{fmt(v.totalAmount)}</td>
                    <td><span style={{ color: STATUS_COLOR[v.status], fontWeight: 600 }}>{v.status}</span></td><td style={{ fontFamily: 'monospace' }}>{v.journalNo || ''}</td>
                    <td>{v.attachUrl ? <a href={v.attachUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>📎</a> : ''}</td>
                    <td style={{ fontSize: 11, color: 'var(--text3)' }}>{v.createId}</td>
                  </tr>
                ))}
              </tbody>
              {rows.length > 0 && <tfoot><tr style={{ fontWeight: 700, background: '#f3f4f6' }}><td colSpan={8}>합계 {rows.length}건</td><td className="num">{fmt(total)}</td><td colSpan={4} /></tr></tfoot>}
            </table>
          </div>
        )}
      </div>

      {modal && (
        <VoucherModal modal={modal} setModal={setModal} accounts={accounts} accountName={accountName} saving={saving}
          onSave={save} onAct={act} onRemove={remove} custSuggest={custSuggest} setCustSuggest={setCustSuggest} />
      )}
    </>
  );
}

function VoucherModal({ modal, setModal, accounts, accountName, saving, onSave, onAct, onRemove, custSuggest, setCustSuggest }) {
  const { mode, form, voucher } = modal;
  const ro = mode === 'view';
  const setForm = (patch) => setModal((m) => ({ ...m, form: { ...m.form, ...patch } }));
  const f = (k) => (e) => setForm({ [k]: e.target.value });
  const setLine = (i, k, val) => setForm({ lines: form.lines.map((l, idx) => (idx === i ? { ...l, [k]: val } : l)) });
  const addLine = () => setForm({ lines: [...form.lines, emptyLine(form.voucherType)] });
  const delLine = (i) => setForm({ lines: form.lines.filter((_, idx) => idx !== i) });
  const fx = Number(form.fxRate || 0);
  const isFx = form.currency !== 'KRW';
  const sumAmt = form.lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const sumFx = form.lines.reduce((s, l) => s + (Number(l.foreignAmount) || 0), 0);
  const fxKrw = isFx ? Math.round(sumFx * fx) : 0;

  const searchCust = async (q) => {
    setForm({ custName: q, custKey: '' });
    if (q.length < 1) return setCustSuggest([]);
    try { const d = await apiGet('/api/customers/search', { q }); setCustSuggest((d.customers || d.rows || d.data || []).slice(0, 8)); } catch { setCustSuggest([]); }
  };
  const pickCust = (c) => { setForm({ custKey: c.CustKey ?? c.custKey, custName: c.CustName ?? c.custName }); setCustSuggest([]); };

  const inp = (k, extra = {}) => <input className="filter-input" value={form[k] || ''} onChange={f(k)} disabled={ro} style={{ width: '100%' }} {...extra} />;
  const fieldStyle = { display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 };

  return (
    <div className="modal-overlay" onClick={() => setModal(null)}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ minWidth: 980, maxWidth: '96vw', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>{TYPE_LABEL[form.voucherType]} {voucher ? `· ${voucher.voucherNo}` : '(신규 — 저장 시 일자-No. 자동채번)'}</h3>
          {voucher && <span style={{ color: STATUS_COLOR[voucher.status], fontWeight: 700 }}>{voucher.status}</span>}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8, marginBottom: 10 }}>
          <label style={fieldStyle}>유형<select className="filter-input" value={form.voucherType} disabled={ro || mode === 'edit'} onChange={(e) => setForm({ ...emptyForm(e.target.value), voucherDate: form.voucherDate })}>{TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</select></label>
          <label style={fieldStyle}>일자(일자-No.){inp('voucherDate', { type: 'date' })}</label>
          <label style={fieldStyle}>회계년도(자동)<input className="filter-input" value={(form.voucherDate || '').slice(0, 4)} disabled style={{ width: '100%' }} /></label>
          <label style={{ ...fieldStyle, position: 'relative' }}>거래처{voucher?.voucherType === '급여' || form.voucherType === '급여' ? '(선택)' : ''}
            <input className="filter-input" value={form.custName || ''} disabled={ro} onChange={(e) => searchCust(e.target.value)} placeholder="거래처명 검색" style={{ width: '100%' }} />
            {custSuggest.length > 0 && !ro && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #ddd', zIndex: 10, maxHeight: 180, overflowY: 'auto' }}>
                {custSuggest.map((c) => <div key={c.CustKey ?? c.custKey} onClick={() => pickCust(c)} style={{ padding: '4px 8px', cursor: 'pointer' }}>{c.CustName ?? c.custName} <span style={{ color: '#999', fontSize: 11 }}>{c.CustArea}</span></div>)}
              </div>
            )}
            {form.custKey && <span style={{ fontSize: 10, color: '#059669' }}>마스터 연결 CustKey {form.custKey}</span>}
          </label>
          <label style={fieldStyle}>기간{inp('period', { placeholder: form.voucherType === '급여' ? '2026/09/01~09/12' : '2026/08' })}</label>
          <label style={fieldStyle}>담당자{inp('manager', { placeholder: '미입력 시 작성자' })}</label>
          {form.voucherType === '급여' && <label style={fieldStyle}>직원명 *{inp('employeeName')}</label>}
          {form.voucherType === '지급' && <label style={fieldStyle}>자금결의서코드{inp('fundCode', { placeholder: '숫자 7자리' })}</label>}
          <label style={fieldStyle}>통화<select className="filter-input" value={form.currency} disabled={ro} onChange={(e) => setForm({ currency: e.target.value, fxRate: e.target.value === 'KRW' ? '1' : form.fxRate === '1' ? '' : form.fxRate })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label style={fieldStyle}>환율{inp('fxRate', { placeholder: '송금 환율', disabled: ro || !isFx })}</label>
          <label style={{ ...fieldStyle, gridColumn: 'span 2' }}>첨부 URL(청구서 PDF){inp('attachUrl', { placeholder: 'https://...' })}</label>
          <label style={{ ...fieldStyle, gridColumn: 'span 6' }}>비고{inp('memo')}</label>
        </div>

        <table className="tbl" style={{ marginBottom: 8 }}>
          <thead><tr><th style={{ width: 30 }}>#</th><th style={{ width: 260 }}>계정과목</th><th style={{ width: 130 }}>금액(원)</th>{isFx && <th style={{ width: 120 }}>외화금액</th>}<th>적요</th><th style={{ width: 100 }}>부서</th><th style={{ width: 90 }}>차수</th>{!ro && <th style={{ width: 36 }} />}</tr></thead>
          <tbody>
            {form.lines.map((l, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td><select className="filter-input" value={l.accountCode} disabled={ro} onChange={(e) => setLine(i, 'accountCode', e.target.value)} style={{ width: '100%' }}>
                  <option value="">계정 선택</option>{accounts.map((a) => <option key={a.accountCode} value={a.accountCode}>{a.accountCode} {a.accountName} ({a.accountClass})</option>)}</select></td>
                <td><input className="filter-input" value={l.amount} disabled={ro} onChange={(e) => setLine(i, 'amount', e.target.value.replace(/[^\d.-]/g, ''))} style={{ width: '100%', textAlign: 'right' }} placeholder={isFx && l.foreignAmount ? fmt(Math.round(Number(l.foreignAmount) * fx)) : '0'} /></td>
                {isFx && <td><input className="filter-input" value={l.foreignAmount} disabled={ro} onChange={(e) => setLine(i, 'foreignAmount', e.target.value.replace(/[^\d.]/g, ''))} style={{ width: '100%', textAlign: 'right' }} /></td>}
                <td><input className="filter-input" value={l.descr} disabled={ro} onChange={(e) => setLine(i, 'descr', e.target.value)} style={{ width: '100%' }} placeholder={form.voucherType === '급여' ? '기본급/은행비/기타' : '적요'} /></td>
                <td><input className="filter-input" value={l.dept} disabled={ro} onChange={(e) => setLine(i, 'dept', e.target.value)} style={{ width: '100%' }} /></td>
                <td><input className="filter-input" value={l.orderYearWeek} disabled={ro} onChange={(e) => setLine(i, 'orderYearWeek', e.target.value)} style={{ width: '100%' }} placeholder="38-2" /></td>
                {!ro && <td><button className="btn btn-sm" onClick={() => delLine(i)}>✕</button></td>}
              </tr>
            ))}
          </tbody>
          <tfoot><tr style={{ fontWeight: 700, background: '#f3f4f6' }}>
            <td colSpan={2}>합계(자동) {form.lines.filter((l) => l.accountCode).length}행</td>
            <td style={{ textAlign: 'right' }}>{fmt(sumAmt)}</td>
            {isFx && <td style={{ textAlign: 'right' }}>{fmt(sumFx)} {form.currency}{fx ? <div style={{ fontSize: 10, fontWeight: 400 }}>×{fx} = {fmt(fxKrw)}원{sumAmt && fxKrw !== sumAmt ? ` (환차 ${fmt(fxKrw - sumAmt)})` : ''}</div> : null}</td>}
            <td colSpan={ro ? 3 : 4}>{!ro && <button className="btn btn-sm" onClick={addLine}>＋ 행 추가</button>}</td>
          </tr></tfoot>
        </table>

        {voucher?.journal && (
          <div className="card" style={{ padding: 10, marginBottom: 8, background: '#f9fafb' }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>연결 전표 {voucher.journal.journalNo} · {voucher.journal.journalType} · {voucher.journal.status}{voucher.journal.reversedByKey ? ' · 역분개됨' : ''}</div>
            <table className="tbl"><thead><tr><th>#</th><th>차/대</th><th>계정</th><th className="num">금액</th><th>적요</th></tr></thead>
              <tbody>{voucher.journal.lines.map((l) => <tr key={l.lineKey}><td>{l.lineNo}</td><td>{l.side === 'DR' ? '차변' : '대변'}</td><td>{l.accountCode} {l.accountName}</td><td className="num">{fmt(l.amount)}</td><td>{l.descr}</td></tr>)}</tbody>
              <tfoot><tr style={{ fontWeight: 700 }}><td colSpan={3}>차변 {fmt(voucher.journal.totalDebit)} / 대변 {fmt(voucher.journal.totalCredit)}</td><td colSpan={2}>{voucher.journal.totalDebit === voucher.journal.totalCredit ? '✔ 일치' : '✖ 불일치'}</td></tr></tfoot>
            </table>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {voucher?.status === '작성' && <button className="btn" style={{ color: '#dc2626' }} onClick={() => onRemove(voucher)}>삭제</button>}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn" onClick={() => setModal(null)}>닫기</button>
            {!ro && <button className="btn btn-primary" onClick={onSave} disabled={saving}>{saving ? '저장 중…' : '저장'}</button>}
            {voucher?.status === '작성' && <button className="btn btn-success" onClick={() => onAct(voucher, 'approve', '결재완료(전표 생성)')}>결재완료 → 전표 생성</button>}
            {voucher?.status === '결재완료' && <button className="btn btn-success" onClick={() => onAct(voucher, 'remit', '송금완료')}>송금완료 처리</button>}
            {voucher?.status === '송금완료' && <button className="btn btn-success" onClick={() => onAct(voucher, 'post', '전표반영(확정)')}>전표반영(확정)</button>}
            {voucher && ['결재완료', '송금완료', '전표반영'].includes(voucher.status) && <button className="btn" style={{ color: '#dc2626' }} onClick={() => onAct(voucher, 'cancel', voucher.status === '전표반영' ? '취소(역분개 전표 생성)' : '취소')}>취소</button>}
          </div>
        </div>
        {mode === 'edit' && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>작성 상태에서만 수정 가능. 일자를 바꾸면 일자-No.가 재채번됩니다.</div>}
      </div>
    </div>
  );
}
