// pages/warehouse.js
// 발주 관리 — 피벗 테이블
// 수정이력: 2026-03-30 — 사진과 동일한 구조로 완전 재구현
//   기본 컬럼: 국가, 꽃, 품목명(색상), 거래처명, CN, 입력일자(열), 변경수량(=주문수량), 주문차수, 단위

import { useState, useEffect } from 'react';
import { apiGet } from '../lib/useApi';
import { useWeekInput, getCurrentWeek, WeekInput } from '../lib/useWeekInput';
import { t } from '../lib/i18n';
import { useLang } from '../lib/i18n';

const fN = n => (!n||n===0) ? '' : Number(n).toFixed(2);

export default function Warehouse() {
  const { t } = useLang();
  const weekInput = useWeekInput('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [prodFilter, setProdFilter] = useState('');
  const [collapsed, setCollapsed] = useState(new Set());

  // 표시 컬럼 토글
  const [cols, setCols] = useState({
    week:   true,  // 주문차수
    unit:   true,  // 단위
    qty:    true,  // 변경수량
  });
  const toggleCol = k => setCols(c => ({...c,[k]:!c[k]}));

  const load = () => {
    if (!weekInput.value) { setErr('차수를 입력하세요.'); return; }
    setLoading(true); setErr('');
    apiGet('/api/warehouse/pivot', { week: weekInput.value })
      .then(d => { setData(d); setCollapsed(new Set()); })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const toggleCollapse = key => setCollapsed(s => { const n=new Set(s); n.has(key)?n.delete(key):n.add(key); return n; });

  const handleExcel = () => {
    if (!data) return;
    const dates = data.dates || [];
    const hdrs = ['국가','꽃','품목명(색상)','거래처명','C.N.'];
    if (cols.week) hdrs.push('주문차수');
    if (cols.unit) hdrs.push('단위');
    if (cols.qty)  hdrs.push('변경수량');
    dates.forEach(d=>hdrs.push(d));
    const rows = [hdrs];
    (filtered||[]).forEach(item=>{
      const row=[item.country||'',item.flower||'',item.prodName||'',item.custName||'',item.cn||''];
      if (cols.week) row.push(weekInput.value);
      if (cols.unit) row.push(item.unit||'');
      if (cols.qty)  row.push(dates.reduce((a,d)=>a+(item.dates[d]||0),0)||'');
      dates.forEach(d=>row.push(item.dates[d]||''));
      rows.push(row);
    });
    const csv=rows.map(r=>r.map(v=>`"${v}"`).join(',')).join('\n');
    const blob=new Blob(['\uFEFF'+csv],{type:'text/csv'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);
    a.download=`발주현황_${weekInput.value}.csv`;a.click();
  };

  const dates = data?.dates || [];

  // 필터
  const filtered = (data?.items||[]).filter(item =>
    !prodFilter || item.prodName?.toLowerCase().includes(prodFilter.toLowerCase()) ||
    item.custName?.toLowerCase().includes(prodFilter.toLowerCase())
  );

  // 그룹핑: 국가 > 꽃 > 품목명 > 거래처
  const grouped = {};
  filtered.forEach(item => {
    const ck = item.country||'기타';
    if (!grouped[ck]) grouped[ck] = { country:item.country||'기타', flowers:{} };
    const fk = item.flower||'기타';
    if (!grouped[ck].flowers[fk]) grouped[ck].flowers[fk] = { flower:item.flower||'기타', items:[] };
    grouped[ck].flowers[fk].items.push(item);
  });

  // 고정 컬럼 수
  const fixedCols = 5 + (cols.week?1:0) + (cols.unit?1:0);

  return (
    <div style={{display:'flex',flexDirection:'column',height:'calc(100vh - 72px)'}}>
      {/* 툴바 */}
      <div className="filter-bar">
        <WeekInput weekInput={weekInput} label="차수" />
        <span className="filter-label">품목</span>
        <input className="filter-input" placeholder="품목명/거래처" value={prodFilter}
          onChange={e=>setProdFilter(e.target.value)} style={{minWidth:140}}/>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={load}>{t('새로고침')}</button>
          <button className="btn" onClick={handleExcel}>{t('엑셀')}</button>
          <button className="btn" onClick={()=>setCollapsed(new Set())}>▼ 펼침</button>
          <button className="btn" onClick={()=>{
            const keys=new Set();
            Object.values(grouped).forEach(gc=>{
              keys.add(gc.country);
              Object.values(gc.flowers).forEach(gf=>keys.add(gc.country+'|'+gf.flower));
            });
            setCollapsed(keys);
          }}>▶ 닫기</button>
        </div>
      </div>

      {err && <div className="banner-err">{err}</div>}

      {/* 표시 컬럼 토글 */}
      <div style={{padding:'3px 8px',background:'var(--header-bg)',border:'1px solid var(--border)',borderTop:'none',
        display:'flex',gap:4,flexWrap:'wrap',flexShrink:0,fontSize:11}}>
        <span style={{color:'var(--text3)'}}>표시 컬럼:</span>
        {[
          {k:'week', l:'주문차수'},
          {k:'unit', l:'단위'},
          {k:'qty',  l:'변경수량'},
        ].map(c=>(
          <button key={c.k}
            className={`btn btn-sm ${cols[c.k]?'btn-primary':''}`}
            style={{height:20,fontSize:10}}
            onClick={()=>toggleCol(c.k)}
          >{c.l}</button>
        ))}
      </div>

      {/* 헤더 */}
      <div style={{padding:'2px 8px',background:'var(--header-bg)',border:'1px solid var(--border)',
        borderTop:'none',fontSize:12,fontWeight:'bold',flexShrink:0}}>
        ■ 발주 목록
      </div>

      {/* 피벗 테이블 */}
      <div style={{flex:1,overflow:'auto',border:'1px solid var(--border2)',borderTop:'none'}}>
        {loading ? <div className="skeleton" style={{height:300,margin:16}}></div>
        : !data ? (
          <div className="empty-state">
            <div className="empty-icon">📦</div>
            <div className="empty-text">차수 입력 후 새로고침 / Actualizar</div>
          </div>
        ) : (
          <table className="tbl" style={{fontSize:11, minWidth: fixedCols*70 + dates.length*90}}>
            <thead>
              {/* 날짜 헤더 행 */}
              <tr style={{background:'#C8D4E4'}}>
                <th colSpan={fixedCols} style={{borderRight:'2px solid var(--border2)',textAlign:'left',padding:'2px 8px',fontSize:11}}>
                  입력일자
                </th>
                {cols.qty && (
                  <th style={{textAlign:'center',fontSize:11,minWidth:70,background:'#B8C8E0',borderRight:'1px solid var(--border)'}}>
                    변경수량
                  </th>
                )}
                {dates.map((d,i) => (
                  <th key={d} style={{textAlign:'center',fontSize:10,minWidth:85,
                    background:i===dates.length-1?'#D8E8F4':'#C8D4E4'}}>
                    {d}
                  </th>
                ))}
              </tr>
              {/* 컬럼명 행 */}
              <tr style={{background:'var(--header-bg)'}}>
                <th style={{minWidth:60}}>국가</th>
                <th style={{minWidth:70}}>꽃</th>
                <th style={{minWidth:180}}>품목명(색상)</th>
                <th style={{minWidth:140}}>거래처명</th>
                <th style={{minWidth:60, borderRight:'2px solid var(--border2)'}}>C.N.</th>
                {cols.week && <th style={{minWidth:70}}>주문차수</th>}
                {cols.unit && <th style={{minWidth:40}}>단위</th>}
                {cols.qty  && <th style={{textAlign:'right',minWidth:70,background:'#D0DCEC',borderRight:'1px solid var(--border)'}}>변경수량</th>}
                {dates.map(d=>(
                  <th key={d} style={{textAlign:'right',minWidth:85,fontSize:10}}>{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.values(grouped).length===0 ? (
                <tr><td colSpan={fixedCols+(cols.qty?1:0)+1+dates.length}
                  style={{textAlign:'center',padding:32,color:'var(--text3)'}}>
                  데이터 없음
                </td></tr>
              ) : Object.values(grouped).map(gCountry => {
                const ck = gCountry.country;
                const isCC = collapsed.has(ck);

                // 국가 합계
                const cDateTotals = {};
                let cTotal = 0;
                Object.values(gCountry.flowers).forEach(gf=>gf.items.forEach(item=>{
                  dates.forEach(d=>{ cDateTotals[d]=(cDateTotals[d]||0)+(item.dates[d]||0); cTotal+=(item.dates[d]||0); });
                }));

                return [
                  // 국가 행
                  <tr key={`c-${ck}`} style={{background:'#D0DDE8',cursor:'pointer'}} onClick={()=>toggleCollapse(ck)}>
                    <td colSpan={fixedCols} style={{padding:'2px 8px',fontWeight:'bold',fontSize:12,borderRight:'2px solid var(--border2)'}}>
                      {isCC?'▶':'∨'} {gCountry.country}
                    </td>
                    {cols.qty && <td className="num" style={{fontWeight:'bold',background:'#C0CCE0'}}>{fN(cTotal)}</td>}
                    {dates.map(d=><td key={d} className="num" style={{fontWeight:'bold',background:'#C8D4E4'}}>{fN(cDateTotals[d])}</td>)}
                  </tr>,

                  ...(!isCC ? Object.values(gCountry.flowers).map(gFlower => {
                    const fk = ck+'|'+gFlower.flower;
                    const isFC = collapsed.has(fk);
                    const fDateTotals = {};
                    let fTotal = 0;
                    gFlower.items.forEach(item=>{
                      dates.forEach(d=>{ fDateTotals[d]=(fDateTotals[d]||0)+(item.dates[d]||0); fTotal+=(item.dates[d]||0); });
                    });

                    return [
                      // 꽃 행
                      <tr key={`f-${fk}`} style={{background:'#D8E4F0',cursor:'pointer'}} onClick={()=>toggleCollapse(fk)}>
                        <td style={{width:8}}></td>
                        <td colSpan={fixedCols-1} style={{padding:'2px 8px',fontWeight:'bold',fontSize:11,borderRight:'2px solid var(--border2)'}}>
                          {isFC?'▶':'∨'} {gFlower.flower} <span style={{fontSize:10,color:'var(--text3)'}}>({gFlower.items.length})</span>
                        </td>
                        {cols.qty && <td className="num" style={{fontWeight:'bold',background:'#C8D8E8'}}>{fN(fTotal)}</td>}
                        {dates.map(d=><td key={d} className="num" style={{background:'#D4E0F0'}}>{fN(fDateTotals[d])}</td>)}
                      </tr>,

                      // 품목 행들
                      ...(!isFC ? gFlower.items.map((item,idx)=>{
                        const rowTotal = dates.reduce((a,d)=>a+(item.dates[d]||0),0);
                        return (
                          <tr key={`i-${item.prodName}-${item.custName}-${idx}`}
                            style={{background:idx%2===0?'#fff':'var(--row-alt)'}}>
                            <td></td><td></td>
                            <td style={{fontSize:11,fontWeight:500}}>{item.prodName}</td>
                            <td style={{fontSize:11,color:'var(--text2)'}}>{item.custName}</td>
                            <td style={{fontFamily:'var(--mono)',fontSize:10,borderRight:'2px solid var(--border2)'}}>{item.cn}</td>
                            {cols.week && <td style={{fontFamily:'var(--mono)',fontSize:11}}>{weekInput.value}</td>}
                            {cols.unit && <td style={{fontSize:11,color:'var(--text3)'}}>{item.unit||'박스'}</td>}
                            {cols.qty  && (
                              <td className="num" style={{fontWeight:'bold',color:'var(--blue)',background:'#F0F4FF',borderRight:'1px solid var(--border)'}}>
                                {fN(rowTotal)}
                              </td>
                            )}
                            {dates.map(d=>(
                              <td key={d} className="num"
                                style={{color:(item.dates[d]||0)>0?'var(--blue)':'var(--text3)'}}>
                                {fN(item.dates[d])}
                              </td>
                            ))}
                          </tr>
                        );
                      }) : []),

                      // 꽃 Total
                      <tr key={`ft-${fk}`} style={{background:'#D8E4EE',borderTop:'1px solid var(--border)'}}>
                        <td colSpan={fixedCols} style={{padding:'2px 16px',fontSize:11,color:'var(--text3)',borderRight:'2px solid var(--border2)'}}>
                          {gFlower.flower} Total
                        </td>
                        {cols.qty && <td className="num" style={{fontWeight:'bold',background:'#C4D4E4'}}>{fN(fTotal)}</td>}
                        {dates.map(d=><td key={d} className="num" style={{fontWeight:'bold'}}>{fN(fDateTotals[d])}</td>)}
                      </tr>,
                    ];
                  }) : []),

                  // 국가 Total
                  <tr key={`ct-${ck}`} style={{background:'#C8D4E4',borderTop:'2px solid var(--border2)'}}>
                    <td colSpan={fixedCols} style={{padding:'2px 8px',fontWeight:'bold',fontSize:11,borderRight:'2px solid var(--border2)'}}>
                      {gCountry.country} Total
                    </td>
                    {cols.qty && <td className="num" style={{fontWeight:'bold'}}>{fN(cTotal)}</td>}
                    {dates.map(d=><td key={d} className="num" style={{fontWeight:'bold'}}>{fN(cDateTotals[d])}</td>)}
                  </tr>,
                ];
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
