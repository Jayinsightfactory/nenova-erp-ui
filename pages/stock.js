import { useState, useEffect } from 'react';
import { useWeekInput, getCurrentWeek, WeekInput } from '../lib/useWeekInput';
import { apiPost } from '../lib/useApi';
import { apiGetExe } from '../lib/exeParity/client.js';
import { useLang } from '../lib/i18n';
import { runEditWithFixCycle } from '../lib/fixCycleClient';

const fmt  = n => Number(n || 0).toLocaleString();
const fmtF = n => Number(n || 0) === 0 ? '—' : Number(n).toFixed(2);
const ADJUST_TYPES = ['불량차감','검역차감','검수차감','기타차감','재고조정'];

async function postAdjustBatch(payload) {
  const res = await fetch('/api/stock/adjust-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

export default function Stock() {
  const { t } = useLang();
  const [stock, setStock] = useState([]);
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [loading, setLoading] = useState(true);
  const weekInput = useWeekInput('');
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ week: '', adjustType: '', prodKey: '', qty: 0, descr: '' });
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [history, setHistory] = useState([]);
  const [histLoading, setHistLoading] = useState(false);

  // ── 재고 일괄수정 (인라인 편집 → 전체적용)
  const [edits, setEdits] = useState({});          // { ProdKey: 목표재고(number|'') }
  const [applying, setApplying] = useState(false);
  const [applyMsg, setApplyMsg] = useState('');
  const [applyResults, setApplyResults] = useState(null);

  const load = () => {
    setLoading(true);
    apiGetExe('/api/stock', { week: weekInput.value, prodName: search })
      .then(d => { setStock(d.stock || []); setSelectedIdx(null); setHistory([]); setErr(''); })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (weekInput.value) load(); }, [weekInput.value]);

  const selectRow = (i) => {
    setSelectedIdx(i);
    const s = stock[i];
    if (!s) return;
    setHistLoading(true);
    apiGetExe('/api/stock', { type: 'history', week: weekInput.value, prodKey: s.ProdKey })
      .then(d => setHistory(d.history || []))
      .catch(() => setHistory([]))
      .finally(() => setHistLoading(false));
  };

  const selected = selectedIdx !== null ? stock[selectedIdx] : null;

  // exe stock calculation: previous/current ProductStock + in - out + StockHistory delta
  const calcStock = (s) => (s.prevStock || 0) + (s.inQty || 0) - (s.outQty || 0) + (s.adjustQty || 0);
  const calcPrevStock = (s) => s.prevStock || 0;

  const isRowDirty = (s) => {
    if (!(s.ProdKey in edits)) return false;
    const v = edits[s.ProdKey];
    if (v === '' || v === null || v === undefined || Number.isNaN(Number(v))) return false;
    return Math.abs(Number(v) - calcStock(s)) > 0.0001;
  };
  const pendingCount = stock.filter(isRowDirty).length;

  const applyAllEdits = async () => {
    const week = weekInput.value;
    if (!week) { alert('차수를 입력하세요.'); return; }
    const list = stock.filter(isRowDirty).map(s => ({
      prodKey: s.ProdKey,
      prodName: s.ProdName,
      before: calcStock(s),
      afterStock: Number(edits[s.ProdKey]),
    }));
    if (list.length === 0) { alert('변경된 값이 없습니다.'); return; }
    if (!confirm(
      `[${week}] ${list.length}건을 적용하시겠습니까?\n\n` +
      list.map(x => `${x.prodName}: ${fmtF(x.before)} → ${fmtF(x.afterStock)}`).join('\n')
    )) return;

    const editsPayload = list.map(({ prodKey, afterStock, prodName }) => ({
      prodKey, afterStock, descr: `재고관리 일괄수정 (${prodName})`,
    }));

    setApplying(true); setApplyMsg('적용 중'); setApplyResults(null);
    try {
      let outcome = await postAdjustBatch({ week, edits: editsPayload });
      if (!outcome.data.success && outcome.data.code === 'WEEK_FIXED') {
        const cycleResult = await runEditWithFixCycle({
          weeks: [week],
          progress: setApplyMsg,
          apply: async () => {
            const r = await postAdjustBatch({ week, force: true, edits: editsPayload });
            return r.data;
          },
        });
        outcome = { data: cycleResult };
      }
      setApplyResults(outcome.data);
      if (outcome.data?.success) {
        setEdits({});
        setSuccessMsg(`✅ 재고 일괄수정 완료 (${list.length}건)`);
        setTimeout(() => setSuccessMsg(''), 4000);
      } else {
        alert('일부 실패: ' + (outcome.data?.error || outcome.data?.message || '알 수 없는 오류'));
      }
      load();
    } catch (e) {
      alert('일괄수정 오류: ' + e.message);
    } finally {
      setApplying(false); setApplyMsg('');
    }
  };

  // 조정 등록 모달 열기 - 사진과 동일한 폼
  const openAdjust = (prod) => {
    setForm({
      week: weekInput.value || '',
      adjustType: '',
      prodKey: prod ? prod.ProdKey : '',
      prodName: prod ? prod.ProdName : '',
      qty: 0,
      descr: ''
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.week) { alert('차수를 입력하세요.'); return; }
    if (!form.adjustType) { alert('구분을 선택하세요.'); return; }
    if (!form.prodKey) { alert('품목명을 선택하세요.'); return; }
    if (!form.qty || form.qty <= 0) { alert('수량을 입력하세요.'); return; }
    setSaving(true);
    try {
      await apiPost('/api/stock', {
        week: form.week,
        prodKey: form.prodKey,
        qty: form.qty,
        adjustType: form.adjustType,
        descr: form.descr,
      });
      setShowModal(false);
      setSuccessMsg('✅ 재고 조정 등록 완료');
      setTimeout(() => setSuccessMsg(''), 3000);
      load();
    } catch (e) { alert(e.message); } finally { setSaving(false); }
  };

  const handleExcel = () => {
    const rows = [['국가','꽃','품목명','단위','전차수재고','현차수입고','현차수출고','현차수조정','재고수량']];
    stock.forEach(s => rows.push([
      s.CounName, s.FlowerName, s.ProdName, s.OutUnit,
      calcPrevStock(s), s.inQty, s.outQty, s.adjustQty, calcStock(s)
    ]));
    const csv = rows.map(r=>r.map(v=>`"${v||''}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF'+csv],{type:'text/csv'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`재고현황.csv`; a.click();
  };

  return (
    <div>
      <div className="filter-bar">
        <WeekInput weekInput={weekInput} label="차수" />
        <span className="filter-label">품목 검색</span>
        <input className="filter-input" placeholder="품목명 / 꽃" value={search} onChange={e=>setSearch(e.target.value)} style={{minWidth:160}}
          onKeyDown={e=>e.key==='Enter'&&load()} />
        <div className="page-actions">
          <button className="btn btn-primary" onClick={load}>🔄 조회 / Buscar</button>
          <button className="btn btn-secondary" onClick={()=>openAdjust(null)}>📝 조정등록</button>
          <button className="btn btn-primary" onClick={applyAllEdits} disabled={pendingCount===0 || applying}
            style={{background: pendingCount>0 ? undefined : 'var(--border)', opacity: pendingCount>0?1:0.6}}>
            {applying ? `⏳ ${applyMsg||'적용 중'}` : `✅ 전체적용 (${pendingCount})`}
          </button>
          {pendingCount>0 && !applying && (
            <button className="btn btn-secondary" onClick={()=>setEdits({})}>↩️ 편집 취소</button>
          )}
          <button className="btn btn-secondary" onClick={handleExcel}>📊 엑셀 / Excel</button>
          <button className="btn btn-secondary" onClick={() => window.opener ? window.close() : window.history.back()}>✖️ 닫기 / Cerrar</button>
        </div>
      </div>

      {err && <div style={{padding:'8px 14px',background:'var(--red-bg)',color:'var(--red)',borderRadius:8,marginBottom:10,fontSize:13}}>⚠️ {err}</div>}
      {successMsg && <div style={{padding:'8px 14px',background:'var(--green-bg)',color:'var(--green)',borderRadius:8,marginBottom:10,fontSize:13}}>{successMsg}</div>}
      {pendingCount>0 && !applying && (
        <div style={{padding:'8px 14px',background:'#fff9c4',color:'#8d6e00',borderRadius:8,marginBottom:10,fontSize:13}}>
          ✏️ {pendingCount}건 재고 수정 대기 중 — 값을 다 고친 뒤 [전체적용]을 누르세요. 차수가 확정 상태면 자동으로 확정해제→적용→재확정합니다.
        </div>
      )}
      {applyResults && !applying && (
        <div style={{padding:'8px 14px',background: applyResults.success ? 'var(--green-bg)' : 'var(--red-bg)',
          color: applyResults.success ? 'var(--green)' : 'var(--red)', borderRadius:8, marginBottom:10, fontSize:13,
          display:'flex', justifyContent:'space-between', alignItems:'center'}}>
          <span>{applyResults.message || (applyResults.success ? '적용 완료' : '일부 실패')}</span>
          <button className="btn btn-secondary btn-sm" onClick={()=>setApplyResults(null)}>✕</button>
        </div>
      )}

      <div className="split-panel">
        {/* 왼쪽: 재고 목록 */}
        <div className="card" style={{overflow:'hidden',display:'flex',flexDirection:'column'}}>
          <div className="card-header">
            <span className="card-title">재고 목록</span>
            <span style={{fontSize:12,color:'var(--text3)'}}>{stock.length}개</span>
          </div>
          <div style={{overflowY:'auto',flex:1}}>
            {loading ? <div className="skeleton" style={{margin:16,height:300,borderRadius:8}}></div> : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>국가</th><th>꽃</th><th>품목명(색상)</th><th>단위</th>
                    <th style={{textAlign:'right',color:'var(--text3)'}}>전 차수 재고</th>
                    <th style={{textAlign:'right',color:'var(--blue)'}}>현 차수 입고</th>
                    <th style={{textAlign:'right'}}>현 차수 출고</th>
                    <th style={{textAlign:'right',color:'var(--amber)'}}>현 차수 조정</th>
                    <th style={{textAlign:'right',color:'var(--green)'}}>재고수량</th>
                  </tr>
                </thead>
                <tbody>
                  {stock.length === 0
                    ? <tr><td colSpan={9} style={{textAlign:'center',padding:40,color:'var(--text3)'}}>데이터 없음 — 조회 버튼을 클릭하세요</td></tr>
                    : stock.map((s,i) => {
                      const stockQty = calcStock(s);
                      const prevStockQty = calcPrevStock(s);
                      const dirty = isRowDirty(s);
                      const cellVal = s.ProdKey in edits ? edits[s.ProdKey] : stockQty;
                      return (
                        <tr key={s.ProdKey} className={selectedIdx===i?'selected':''} onClick={()=>selectRow(i)} style={{cursor:'pointer'}}>
                          <td style={{fontSize:11}}>{s.CounName}</td>
                          <td style={{fontSize:11}}>{s.FlowerName}</td>
                          <td style={{fontSize:12}}>{s.ProdName}</td>
                          <td style={{fontSize:11,color:'var(--text3)'}}>{s.OutUnit}</td>
                          <td className="num" style={{color:'var(--text3)'}}>{prevStockQty!==0?fmtF(prevStockQty):'—'}</td>
                          <td className="num" style={{color:'var(--blue)'}}>{s.inQty?fmtF(s.inQty):'—'}</td>
                          <td className="num">{s.outQty?fmtF(s.outQty):'—'}</td>
                          <td className="num" style={{color:'var(--amber)'}}>{s.adjustQty?fmtF(s.adjustQty):'—'}</td>
                          <td className="num" style={{padding:'2px 4px'}} onClick={e=>e.stopPropagation()}>
                            <input
                              type="number"
                              value={cellVal}
                              onChange={e => {
                                const v = e.target.value;
                                setEdits(prev => ({ ...prev, [s.ProdKey]: v === '' ? '' : parseFloat(v) }));
                              }}
                              disabled={applying}
                              style={{
                                width: 78, textAlign:'right', fontSize:12, fontWeight:700, padding:'3px 5px',
                                border: `1px solid ${dirty ? '#f9a825' : 'var(--border)'}`, borderRadius:4,
                                background: dirty ? '#fffde7' : 'transparent',
                                color: stockQty<=0?'var(--red)':stockQty<10?'var(--amber)':'var(--green)',
                              }}
                            />
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* 오른쪽: 재고 입/출고 내역 */}
        <div className="card" style={{overflow:'hidden',display:'flex',flexDirection:'column'}}>
          <div className="card-header">
            <span className="card-title">재고 입/출고 내역</span>
            {selected && (
              <span style={{display:'flex',gap:6,alignItems:'center'}}>
                <span style={{fontSize:12,color:'var(--blue)',fontWeight:600}}>{selected.ProdName}</span>
                <button className="btn btn-secondary btn-sm" onClick={()=>openAdjust(selected)}>📝 조정등록</button>
              </span>
            )}
          </div>
          {selected ? (
            <div style={{overflowY:'auto',flex:1}}>
              {/* 요약 수치 */}
              <div style={{display:'flex',borderBottom:'1px solid var(--border)'}}>
                {[
                  ['전 차수 재고', calcPrevStock(selected), 'var(--text3)'],
                  ['현 차수 입고', selected.inQty, 'var(--blue)'],
                  ['현 차수 출고', selected.outQty, 'var(--text2)'],
                  ['현 차수 조정', selected.adjustQty, 'var(--amber)'],
                  ['재고수량', calcStock(selected), calcStock(selected)<=0?'var(--red)':calcStock(selected)<10?'var(--amber)':'var(--green)'],
                ].map(([label,val,color])=>(
                  <div key={label} style={{flex:1,padding:'10px 6px',textAlign:'center',borderRight:'1px solid var(--border)'}}>
                    <div style={{fontSize:10,color:'var(--text3)',marginBottom:4}}>{label}</div>
                    <div style={{fontSize:16,fontWeight:900,fontFamily:'var(--mono)',color}}>{fmtF(val)}</div>
                  </div>
                ))}
              </div>
              {/* 내역 테이블 */}
              {histLoading
                ? <div className="skeleton" style={{margin:16,height:200,borderRadius:8}}></div>
                : <table className="tbl">
                    <thead>
                      <tr>
                        <th>일자</th>
                        <th>구분</th>
                        <th style={{textAlign:'right'}}>변경수량</th>
                        <th>비고</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.length === 0
                        ? <tr><td colSpan={4} style={{textAlign:'center',padding:30,color:'var(--text3)'}}>내역 없음</td></tr>
                        : history.map((h,i)=>(
                          <tr key={i}>
                            <td style={{fontSize:11,fontFamily:'var(--mono)'}}>{h.일자}</td>
                            <td style={{fontSize:11,color:h.구분==='입고'?'var(--blue)':h.구분==='출고'?'var(--text2)':'var(--amber)'}}>{h.구분}</td>
                            <td className="num" style={{color:h.변경수량>0?'var(--blue)':'var(--red)',fontWeight:600}}>
                              {h.변경수량>0?'+':''}{fmtF(h.변경수량)}
                            </td>
                            <td style={{fontSize:11,color:'var(--text3)'}}>{h.비고}</td>
                          </tr>
                        ))
                      }
                    </tbody>
                  </table>
              }
            </div>
          ) : (
            <div className="empty-state"><div className="empty-icon">📦</div><div className="empty-text">왼쪽에서 품목을 선택하세요</div></div>
          )}
        </div>
      </div>

      {/* 재고 조정 등록 모달 — 사진과 동일 */}
      {showModal && (
        <div className="modal-overlay" onClick={()=>setShowModal(false)}>
          <div className="modal" style={{maxWidth:420}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">재고 조정 등록</span>
              <button className="btn btn-secondary btn-sm" onClick={()=>setShowModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{fontWeight:700,fontSize:13,marginBottom:14,color:'var(--text2)',borderBottom:'1px solid var(--border)',paddingBottom:8}}>
                ■ 재고 조정 정보
              </div>
              {/* 차수 + 구분 (가로 배치) */}
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">차수</label>
                  <select className="form-control" value={form.week} onChange={e=>setForm(f=>({...f,week:e.target.value}))}>
                    <option value="">선택</option>
                    {['14-01','13-01','13-02','12-01','12-02','11-01'].map(w=><option key={w}>{w}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">구분</label>
                  <select className="form-control" value={form.adjustType} onChange={e=>setForm(f=>({...f,adjustType:e.target.value}))}>
                    <option value=""></option>
                    {ADJUST_TYPES.map(t=><option key={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              {/* 품목명 (풀너비 드롭다운) */}
              <div className="form-row form-row-1">
                <div className="form-group">
                  <label className="form-label">품목명</label>
                  <select className="form-control" value={form.prodKey} onChange={e=>{
                    const opt = e.target.options[e.target.selectedIndex];
                    setForm(f=>({...f,prodKey:e.target.value,prodName:opt.text}));
                  }}>
                    <option value="">품목 선택</option>
                    {stock.map(s=><option key={s.ProdKey} value={s.ProdKey}>{s.ProdName}</option>)}
                  </select>
                </div>
              </div>
              {/* 수량 */}
              <div className="form-row form-row-1">
                <div className="form-group">
                  <label className="form-label">수량</label>
                  <input type="number" min={0} className="form-control" value={form.qty}
                    onChange={e=>setForm(f=>({...f,qty:parseFloat(e.target.value)||0}))} />
                </div>
              </div>
              {/* 비고 */}
              <div className="form-row form-row-1">
                <div className="form-group">
                  <label className="form-label">비고</label>
                  <textarea className="form-control" rows={3} value={form.descr}
                    onChange={e=>setForm(f=>({...f,descr:e.target.value}))}
                    style={{resize:'vertical'}} />
                </div>
              </div>
              <div style={{fontSize:11,color:'var(--amber)',marginTop:8}}>⚠️ StockHistory 저장 후 전산 재고계산을 실행합니다.</div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                💾 {saving?'저장 중... / Guardando':'저장'}
              </button>
              <button className="btn btn-secondary" onClick={()=>setShowModal(false)}>{t('닫기')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
