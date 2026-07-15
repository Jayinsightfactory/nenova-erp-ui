import { useState, useEffect, Fragment } from 'react';
import { useWeekInput, getCurrentWeek, WeekInput } from '../lib/useWeekInput';
import { apiPost, apiGet } from '../lib/useApi';
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

  // ── 차수별 재고 피벗 + 품종 그룹 접기
  const [pivotOn, setPivotOn] = useState(false);
  const [pivotData, setPivotData] = useState(null);   // { weeks: ['26-01',...], stocks: { ProdKey: { '26-01': n } } }
  const [pivotLoading, setPivotLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(new Set()); // 접힌 품종그룹 키

  const load = () => {
    setLoading(true);
    apiGetExe('/api/stock', { week: weekInput.value, prodName: search })
      .then(d => { setStock(d.stock || []); setSelectedIdx(null); setHistory([]); setErr(''); })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  };

  const loadPivot = () => {
    if (!weekInput.value) return;
    setPivotLoading(true);
    apiGet('/api/stock', { type: 'weekPivot', week: weekInput.value })
      .then(d => setPivotData({ weeks: d.weeks || [], stocks: d.stocks || {} }))
      .catch(e => { setErr(e.message); setPivotData(null); })
      .finally(() => setPivotLoading(false));
  };

  useEffect(() => { if (weekInput.value) load(); }, [weekInput.value]);
  useEffect(() => { if (pivotOn) loadPivot(); }, [pivotOn, weekInput.value]);

  // 조회 차수(짧은 형식 '28-01') — 피벗의 마지막 열은 현재 라이브 계산이라 스냅샷 열에서 제외
  const curWeekShort = String(weekInput.value || '').replace(/^\d{4}-/, '');
  const pastWeeks = pivotOn && pivotData ? pivotData.weeks.filter(w => w !== curWeekShort) : [];
  const groupKeyOf = (s) => `${s.CounName || '기타'} · ${s.FlowerName || '기타'}`;
  const colCount = pivotOn ? 4 + pastWeeks.length + 1 : 9;

  const toggleGroup = (k) => setCollapsed(prev => {
    const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n;
  });
  const collapseAll = () => setCollapsed(new Set(stock.map(groupKeyOf)));
  const expandAll = () => setCollapsed(new Set());

  // ── 품종(국가·꽃) 칩 필터 — 선택 없음 = 전체 표시
  const [selCoun, setSelCoun] = useState(new Set());
  const [selFlower, setSelFlower] = useState(new Set());
  const counList = [...new Set(stock.map(s => s.CounName).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'));
  const flowerList = [...new Set(stock
    .filter(s => selCoun.size === 0 || selCoun.has(s.CounName))
    .map(s => s.FlowerName).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'));
  const toggleSet = (setter) => (v) => setter(prev => {
    const n = new Set(prev); n.has(v) ? n.delete(v) : n.add(v); return n;
  });
  const toggleCoun = toggleSet(setSelCoun);
  const toggleFlower = toggleSet(setSelFlower);
  const [onlyStocked, setOnlyStocked] = useState(true); // 재고수량 있는 품목만 (기본 ON)
  const searchLive = search.trim().toLowerCase();
  const chipStyle = (active) => ({
    padding:'2px 9px', borderRadius:12, border:'1px solid', fontSize:11, cursor:'pointer',
    fontWeight: active?700:400,
    borderColor: active?'var(--blue)':'var(--border)',
    background: active?'var(--blue)':'var(--surface)',
    color: active?'#fff':'var(--text2)',
  });

  const selectRow = (s) => {
    if (!s) return;
    setSelectedIdx(stock.findIndex(x => x.ProdKey === s.ProdKey));
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

  // 필터 적용 목록 — calcStock/isRowDirty 선언 뒤에 있어야 함 (TDZ)
  const visibleStock = stock.filter(s =>
    (selCoun.size === 0 || selCoun.has(s.CounName)) &&
    (selFlower.size === 0 || selFlower.has(s.FlowerName)) &&
    (!onlyStocked || Math.abs(calcStock(s)) > 0.0001 || isRowDirty(s)) &&
    (!searchLive ||
      String(s.ProdName || '').toLowerCase().includes(searchLive) ||
      String(s.FlowerName || '').toLowerCase().includes(searchLive) ||
      String(s.CounName || '').toLowerCase().includes(searchLive)));

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
        <input className="filter-input" placeholder="품목명 / 꽃 (입력 즉시 필터)" value={search} onChange={e=>setSearch(e.target.value)} style={{minWidth:180}} />
        <button className={onlyStocked?'btn btn-primary btn-sm':'btn btn-secondary btn-sm'}
          onClick={()=>setOnlyStocked(v=>!v)} title="재고수량이 0이 아닌 품목만 표시">
          {onlyStocked ? '☑' : '☐'} 재고 있는 품목만
        </button>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={load}>🔄 조회 / Buscar</button>
          <button className={pivotOn?'btn btn-primary':'btn btn-secondary'} onClick={()=>setPivotOn(v=>!v)}>
            {pivotLoading ? '⏳ 차수별 재고' : '📅 차수별 재고'}
          </button>
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

      {/* 품종 칩 필터 — 선택 없음 = 전체 */}
      {stock.length > 0 && (
        <div style={{background:'var(--bg)',border:'1px solid var(--border)',borderRadius:8,padding:'8px 10px',marginBottom:8}}>
          <div style={{display:'flex',alignItems:'center',gap:5,flexWrap:'wrap',marginBottom:5}}>
            <span style={{fontSize:11,fontWeight:700,color:'var(--text3)',whiteSpace:'nowrap'}}>국가</span>
            <button style={chipStyle(selCoun.size===0)} onClick={()=>{setSelCoun(new Set());setSelFlower(new Set());}}>전체</button>
            {counList.map(c => (
              <button key={c} style={chipStyle(selCoun.has(c))} onClick={()=>toggleCoun(c)}>{c}</button>
            ))}
          </div>
          <div style={{display:'flex',alignItems:'center',gap:5,flexWrap:'wrap'}}>
            <span style={{fontSize:11,fontWeight:700,color:'var(--text3)',whiteSpace:'nowrap'}}>품종</span>
            <button style={chipStyle(selFlower.size===0)} onClick={()=>setSelFlower(new Set())}>전체</button>
            {flowerList.map(f => (
              <button key={f} style={chipStyle(selFlower.has(f))} onClick={()=>toggleFlower(f)}>{f}</button>
            ))}
          </div>
        </div>
      )}

      <div className={selected ? 'split-panel' : ''}>
        {/* 왼쪽: 재고 목록 — 품목 미선택 시 전체 폭 */}
        <div className="card" style={{overflow:'hidden',display:'flex',flexDirection:'column'}}>
          <div className="card-header">
            <span className="card-title">재고 목록</span>
            <span style={{display:'flex',gap:6,alignItems:'center'}}>
              <button className="btn btn-secondary btn-sm" onClick={collapseAll}>▸ 전체 접기</button>
              <button className="btn btn-secondary btn-sm" onClick={expandAll}>▾ 전체 펼치기</button>
              <span style={{fontSize:12,color:'var(--text3)'}}>
                {visibleStock.length !== stock.length ? `${visibleStock.length} / ` : ''}{stock.length}개
              </span>
            </span>
          </div>
          <div style={{overflowY:'auto',overflowX:'auto',flex:1}}>
            {loading ? <div className="skeleton" style={{margin:16,height:300,borderRadius:8}}></div> : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>국가</th><th>꽃</th><th>품목명(색상)</th><th>단위</th>
                    {pivotOn ? (
                      <>
                        {pastWeeks.map(w => (
                          <th key={w} style={{textAlign:'right',color:'var(--text3)',whiteSpace:'nowrap'}}>{w} 재고</th>
                        ))}
                        <th style={{textAlign:'right',color:'var(--green)',whiteSpace:'nowrap'}}>{curWeekShort} 재고(수정)</th>
                      </>
                    ) : (
                      <>
                        <th style={{textAlign:'right',color:'var(--text3)'}}>전 차수 재고</th>
                        <th style={{textAlign:'right',color:'var(--blue)'}}>현 차수 입고</th>
                        <th style={{textAlign:'right'}}>현 차수 출고</th>
                        <th style={{textAlign:'right',color:'var(--amber)'}}>현 차수 조정</th>
                        <th style={{textAlign:'right',color:'var(--green)'}}>재고수량</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {visibleStock.length === 0
                    ? <tr><td colSpan={colCount} style={{textAlign:'center',padding:40,color:'var(--text3)'}}>
                        {stock.length === 0 ? '데이터 없음 — 조회 버튼을 클릭하세요' : '선택한 품종에 해당하는 품목 없음'}
                      </td></tr>
                    : visibleStock.map((s,i) => {
                      const gk = groupKeyOf(s);
                      const isFirstOfGroup = i === 0 || groupKeyOf(visibleStock[i-1]) !== gk;
                      const groupHeader = isFirstOfGroup ? (
                        <tr key={`g-${gk}`} onClick={()=>toggleGroup(gk)}
                          style={{cursor:'pointer',background:'var(--bg)',borderTop:'2px solid var(--border2)'}}>
                          <td colSpan={colCount} style={{fontSize:12,fontWeight:800,padding:'5px 8px',color:'var(--text2)'}}>
                            {collapsed.has(gk) ? '▸' : '▾'} {gk}
                            <span style={{fontWeight:400,color:'var(--text3)',marginLeft:6}}>
                              ({visibleStock.filter(x=>groupKeyOf(x)===gk).length}개)
                            </span>
                          </td>
                        </tr>
                      ) : null;
                      if (collapsed.has(gk)) return groupHeader ? <Fragment key={s.ProdKey}>{groupHeader}</Fragment> : null;

                      const stockQty = calcStock(s);
                      const prevStockQty = calcPrevStock(s);
                      const dirty = isRowDirty(s);
                      const cellVal = s.ProdKey in edits ? edits[s.ProdKey] : stockQty;
                      const pv = pivotOn && pivotData ? (pivotData.stocks[s.ProdKey] || {}) : {};
                      return (
                        <Fragment key={s.ProdKey}>
                          {groupHeader}
                          <tr className={selected?.ProdKey===s.ProdKey?'selected':''} onClick={()=>selectRow(s)} style={{cursor:'pointer'}}>
                            <td style={{fontSize:11}}>{s.CounName}</td>
                            <td style={{fontSize:11}}>{s.FlowerName}</td>
                            <td style={{fontSize:12}}>{s.ProdName}</td>
                            <td style={{fontSize:11,color:'var(--text3)'}}>{s.OutUnit}</td>
                            {pivotOn ? (
                              pastWeeks.map(w => (
                                <td key={w} className="num" style={{color:(pv[w]||0)<0?'var(--red)':'var(--text2)'}}>
                                  {pv[w] != null && pv[w] !== 0 ? fmtF(pv[w]) : '—'}
                                </td>
                              ))
                            ) : (
                              <>
                                <td className="num" style={{color:'var(--text3)'}}>{prevStockQty!==0?fmtF(prevStockQty):'—'}</td>
                                <td className="num" style={{color:'var(--blue)'}}>{s.inQty?fmtF(s.inQty):'—'}</td>
                                <td className="num">{s.outQty?fmtF(s.outQty):'—'}</td>
                                <td className="num" style={{color:'var(--amber)'}}>{s.adjustQty?fmtF(s.adjustQty):'—'}</td>
                              </>
                            )}
                            <td className="num" style={{padding:'2px 4px',whiteSpace:'nowrap'}} onClick={e=>e.stopPropagation()}>
                              <span style={{display:'inline-flex',alignItems:'center',gap:3}}>
                                <button disabled={applying}
                                  onClick={() => setEdits(prev => {
                                    const cur = s.ProdKey in prev && prev[s.ProdKey] !== '' ? Number(prev[s.ProdKey]) : stockQty;
                                    return { ...prev, [s.ProdKey]: Math.round((cur - 1) * 100) / 100 };
                                  })}
                                  style={{width:26,height:26,fontSize:15,fontWeight:700,lineHeight:'24px',padding:0,
                                    border:'1px solid var(--border2)',borderRadius:4,cursor:'pointer',
                                    background:'var(--surface)',color:'var(--red)'}}>−</button>
                                <input
                                  type="number"
                                  value={cellVal}
                                  onChange={e => {
                                    const v = e.target.value;
                                    setEdits(prev => ({ ...prev, [s.ProdKey]: v === '' ? '' : parseFloat(v) }));
                                  }}
                                  disabled={applying}
                                  style={{
                                    width: 66, textAlign:'right', fontSize:12, fontWeight:700, padding:'4px 5px',
                                    border: `1px solid ${dirty ? '#f9a825' : 'var(--border)'}`, borderRadius:4,
                                    background: dirty ? '#fffde7' : 'transparent',
                                    color: stockQty<=0?'var(--red)':stockQty<10?'var(--amber)':'var(--green)',
                                  }}
                                />
                                <button disabled={applying}
                                  onClick={() => setEdits(prev => {
                                    const cur = s.ProdKey in prev && prev[s.ProdKey] !== '' ? Number(prev[s.ProdKey]) : stockQty;
                                    return { ...prev, [s.ProdKey]: Math.round((cur + 1) * 100) / 100 };
                                  })}
                                  style={{width:26,height:26,fontSize:15,fontWeight:700,lineHeight:'24px',padding:0,
                                    border:'1px solid var(--border2)',borderRadius:4,cursor:'pointer',
                                    background:'var(--surface)',color:'var(--blue)'}}>＋</button>
                              </span>
                            </td>
                          </tr>
                        </Fragment>
                      );
                    })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* 오른쪽: 재고 입/출고 내역 — 품목 선택 시에만 표시 */}
        {selected && (
        <div className="card" style={{overflow:'hidden',display:'flex',flexDirection:'column'}}>
          <div className="card-header">
            <span className="card-title">재고 입/출고 내역</span>
            {selected && (
              <span style={{display:'flex',gap:6,alignItems:'center'}}>
                <span style={{fontSize:12,color:'var(--blue)',fontWeight:600}}>{selected.ProdName}</span>
                <button className="btn btn-secondary btn-sm" onClick={()=>openAdjust(selected)}>📝 조정등록</button>
                <button className="btn btn-secondary btn-sm" onClick={()=>setSelectedIdx(null)}>✕ 닫기</button>
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
          ) : null}
        </div>
        )}
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
