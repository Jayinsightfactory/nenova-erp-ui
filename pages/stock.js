import { useState, useEffect } from 'react';
import { useWeekInput, getCurrentWeek, WeekInput } from '../lib/useWeekInput';
import { apiGet, apiPost } from '../lib/useApi';
import { useLang } from '../lib/i18n';

const fmt = n => Number(n || 0).toLocaleString();
const ADJUST_TYPES = ['불량차감','검역차감','검수차감','기타차감','재고조정'];

export default function Stock() {
  const { t } = useLang();
  const [stock, setStock] = useState([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const weekInput = useWeekInput('');
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ week: '', adjustType: '', prodKey: '', qty: 0, descr: '' });
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const load = () => {
    setLoading(true);
    apiGet('/api/stock', { week: weekInput.value, prodName: search })
      .then(d => { setStock(d.stock || []); setErr(''); })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (weekInput.value) load(); }, [weekInput.value]);

  const selected = stock[selectedIdx];

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
      setSuccessMsg('✅ 재고 조정 등록 완료 (테스트 테이블)');
      setTimeout(() => setSuccessMsg(''), 3000);
      load();
    } catch (e) { alert(e.message); } finally { setSaving(false); }
  };

  const handleExcel = () => {
    const rows = [['국가','꽃','품목명','입고','출고','재고','단위']];
    stock.forEach(s => rows.push([s.CounName,s.FlowerName,s.ProdName,s.inQty,s.outQty,s.Stock,s.OutUnit]));
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
          <button className="btn btn-secondary" onClick={handleExcel}>📊 엑셀 / Excel</button>
          <button className="btn btn-secondary" onClick={() => window.opener ? window.close() : history.back()}>✖️ 닫기 / Cerrar</button>
        </div>
      </div>

      {err && <div style={{padding:'8px 14px',background:'var(--red-bg)',color:'var(--red)',borderRadius:8,marginBottom:10,fontSize:13}}>⚠️ {err}</div>}
      {successMsg && <div style={{padding:'8px 14px',background:'var(--green-bg)',color:'var(--green)',borderRadius:8,marginBottom:10,fontSize:13}}>{successMsg}</div>}

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
                    <th>국가</th><th>꽃</th><th>품목명</th>
                    <th style={{textAlign:'right',color:'var(--blue)'}}>입고</th>
                    <th style={{textAlign:'right'}}>출고</th>
                    <th style={{textAlign:'right',color:'var(--green)'}}>재고</th>
                  </tr>
                </thead>
                <tbody>
                  {stock.length === 0
                    ? <tr><td colSpan={6} style={{textAlign:'center',padding:40,color:'var(--text3)'}}>데이터 없음 — 조회 버튼을 클릭하세요</td></tr>
                    : stock.map((s,i) => (
                      <tr key={s.ProdKey} className={selectedIdx===i?'selected':''} onClick={()=>setSelectedIdx(i)} style={{cursor:'pointer'}}>
                        <td style={{fontSize:11}}>{s.CounName}</td>
                        <td style={{fontSize:11}}>{s.FlowerName}</td>
                        <td style={{fontSize:12}}>{s.ProdName}</td>
                        <td className="num" style={{color:'var(--blue)'}}>{fmt(s.inQty)}</td>
                        <td className="num">{fmt(s.outQty)}</td>
                        <td className="num" style={{fontWeight:700,color:s.Stock===0?'var(--red)':s.Stock<10?'var(--amber)':'var(--green)'}}>{fmt(s.Stock)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* 오른쪽: 선택 품목 요약 */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">선택 품목 요약</span>
            {selected && <span style={{fontSize:12,color:'var(--blue)'}}>{selected.ProdName}</span>}
          </div>
          {selected ? (
            <div>
              <div style={{display:'flex',borderBottom:'1px solid var(--border)'}}>
                {[['입고',selected.inQty,'var(--blue)'],['출고',selected.outQty,'var(--text2)'],['현재 재고',selected.Stock,selected.Stock===0?'var(--red)':selected.Stock<10?'var(--amber)':'var(--green)']].map(([label,val,color])=>(
                  <div key={label} style={{flex:1,padding:'16px',textAlign:'center',borderRight:'1px solid var(--border)'}}>
                    <div style={{fontSize:11,color:'var(--text3)',marginBottom:6}}>{label}</div>
                    <div style={{fontSize:22,fontWeight:900,fontFamily:'var(--mono)',color}}>{fmt(val)}</div>
                  </div>
                ))}
              </div>
              <div style={{padding:'16px 18px'}}>
                <table style={{width:'100%',fontSize:13}}>
                  {[['국가',selected.CounName],['꽃 종류',selected.FlowerName],['출고단위',selected.OutUnit]].map(([k,v])=>(
                    <tr key={k}><td style={{color:'var(--text3)',padding:'4px 0',width:80}}>{k}</td><td style={{fontWeight:500}}>{v}</td></tr>
                  ))}
                </table>
                <div style={{marginTop:16}}>
                  <button className="btn btn-secondary" style={{width:'100%'}} onClick={()=>openAdjust(selected)}>
                    📝 이 품목 조정 등록
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="empty-state"><div className="empty-icon">📦</div><div className="empty-text">품목을 선택하세요</div></div>
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
              <div style={{fontSize:11,color:'var(--amber)',marginTop:8}}>⚠️ _new_StockHistory (테스트 테이블)에 저장됩니다.</div>
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
