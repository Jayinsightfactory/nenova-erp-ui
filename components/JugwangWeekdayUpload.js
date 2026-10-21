import { useEffect, useRef, useState } from 'react';
import { withOrderImportDeadline } from '../lib/orderImportDeadline.js';
const norm=v=>String(v||'').replace(/\s/g,'').toLowerCase();
export default function JugwangWeekdayUpload({year,week,onBusy}) {
  const [file,setFile]=useState(null),[sheets,setSheets]=useState([]),[sheet,setSheet]=useState(''),[category,setCategory]=useState('');
  const [source,setSource]=useState(null),[selections,setSelections]=useState([]),[preview,setPreview]=useState(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{onBusy?.(busy);},[busy,onBusy]);
  const version=useRef(0);
  const reset=()=>{version.current++;setSource(null);setSelections([]);setPreview(null);setMessage('');};
  const request=async(url,options)=>withOrderImportDeadline(async()=>{const r=await fetch(url,{credentials:'same-origin',...options});const d=await r.json();if(!r.ok||!d.success)throw new Error(d.error||'요청 실패');return d;});
  async function analyze(selectedFile,selectedSheet) {
    const revision=++version.current;setBusy(true);setMessage('원본을 읽는 중입니다.');setPreview(null);
    try {
      const form=new FormData();form.append('file',selectedFile);form.append('year',year);form.append('week',week);form.append('category',category);if(selectedSheet)form.append('sheetName',selectedSheet);
      const d=await request('/api/orders/weekday-upload-parse',{method:'POST',body:form});if(revision!==version.current)return;
      if(d.sheets){setSheets(d.sheets);setSheet(d.sheets.length===1?d.sheets[0]:'');setMessage('시트와 품종을 선택한 뒤 원본 분석을 누르세요.');return;}
      setSource(d);setSelections(d.rows.map(row=>{const matches=d.orders.filter(o=>String(o.FlowerName||o.CountryFlower).includes(row.category)&&[o.ProdName,o.DisplayName].some(name=>norm(name)===norm(row.label)));return{id:row.id,prodKey:matches.length===1?matches[0].ProdKey:'',unit:row.sourceUnit||'',include:true};}));
      setMessage(d.rows.length?`${d.rows.length}개 원본 행. 품목과 원본 단위를 확인하세요.`:'선택 차수·품종에 양수 요일수량이 없습니다. 아무 수량도 변경하지 않습니다.');
    } catch(e){if(revision===version.current)setMessage(e.message);}finally{if(revision===version.current)setBusy(false);}
  }
  function edit(index,field,value){setSelections(prev=>prev.map((s,i)=>i===index?{...s,[field]:value}:s));setPreview(null);}
  async function submit(action) {
    if(action==='apply'&&!window.confirm('검증한 요일별 수량을 적용하시겠습니까? 기존 주문은 보존하고, 동일 분배는 추가하지 않습니다.'))return;
    setBusy(true);setMessage(action==='apply'?'저장 및 보존 검증 중…':'기존 주문·분배·달력 대조 중…');
    try {
      const d=await request('/api/orders/weekday-upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(action==='preview'?{action,sourceToken:source.sourceToken,selections:selections.filter(s=>s.include)}:{action,planToken:preview.planToken})});
      if(action==='preview'){setPreview(d);setMessage('검증 완료. 아래 날짜와 수량을 확인한 뒤 적용하세요.');}
      else {setPreview(null);setSource(null);setMessage(`완료: 신규 ${d.appliedCount}품목 · 동일 ${d.unchangedCount}품목 · 기존 주문수량 보존 확인`);}
    }catch(e){setPreview(null);setMessage(`${e.message} 자동 재전송하지 않습니다. 저장 응답이 끊겼다면 다시 분석·검증해 현재 분배를 확인하세요.`);}finally{setBusy(false);}
  }
  return <section><p>주광농원 · {year}/{week} · 기존 주문수량 보존 · 빈칸/0 무시 · 확정·기존 분배 변경 없음</p>
    <fieldset disabled={busy} style={{border:0,padding:0,display:'flex',gap:12,flexWrap:'wrap'}}>
      <label>원본 엑셀 <input type="file" accept=".xlsx,.xls" onChange={e=>{reset();const f=e.target.files?.[0];setFile(f);setSheets([]);setSheet('');if(f)analyze(f,'');}}/></label>
      <label>시트 <select value={sheet} onChange={e=>{reset();setSheet(e.target.value);}}><option value="">선택</option>{sheets.map(s=><option key={s}>{s}</option>)}</select></label>
      <label>품종 <select value={category} onChange={e=>{reset();setCategory(e.target.value);}}><option value="">선택</option>{['카네이션','장미','수국','알스트로'].map(s=><option key={s}>{s}</option>)}</select></label>
      <button onClick={()=>analyze(file,sheet)} disabled={!file||!sheet||!category}>원본 분석</button>
    </fieldset>
    <p role="status" style={{whiteSpace:'pre-wrap'}}>{message}</p>
    {source?.warnings.length>0&&<div role="alert">원본 확인 필요: {source.warnings.join(' / ')}</div>}
    {!!source?.rows.length&&<><div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr><th>포함</th><th>원본</th><th>요일수량</th><th>기존 주문 품목</th><th>원본 단위</th></tr></thead><tbody>{source.rows.map((row,i)=><tr key={row.id}>
      <td><input aria-label={`${row.label} 포함`} type="checkbox" disabled={busy} checked={selections[i]?.include||false} onChange={e=>edit(i,'include',e.target.checked)}/></td><td>{row.label}<br/>{row.sourceRow}행</td><td>{row.dates.map(d=><div key={d.date}>{d.date}: {d.quantity} ({d.cells.join(',')})</div>)}</td>
      <td><select aria-label={`${row.label} 주문 품목`} disabled={busy} value={selections[i]?.prodKey||''} onChange={e=>edit(i,'prodKey',Number(e.target.value))}><option value="">선택</option>{source.orders.filter(o=>String(o.FlowerName||o.CountryFlower).includes(row.category)).map(o=><option key={o.OrderDetailKey} value={o.ProdKey}>{o.DisplayName||o.ProdName} · 주문 {o.OutQuantity}{o.OutUnit}</option>)}</select></td>
      <td><select aria-label={`${row.label} 원본 단위`} disabled={busy} value={selections[i]?.unit||''} onChange={e=>edit(i,'unit',e.target.value)}><option value="">선택</option>{['박스','단','송이'].map(u=><option key={u}>{u}</option>)}</select></td>
    </tr>)}</tbody></table></div><button disabled={busy||!!source.warnings.length||!selections.some(s=>s.include)||selections.some(s=>s.include&&(!s.prodKey||!s.unit))} onClick={()=>submit('preview')}>주문 보존·중복분배 검증</button></>}
    {preview&&<><ul>{preview.statuses.map(s=><li key={s.prodKey}>{s.label}: {s.status==='NEW'?'신규':'동일·추가 없음'} · 주문 {s.orderQuantity}{s.unit} / 요일합 {s.total}{s.unit} — {s.dates.map(d=>`${d.date} ${d.quantity}`).join(', ')}</li>)}</ul><button disabled={busy} onClick={()=>submit('apply')}>검증한 요일수량 적용</button></>}
  </section>;
}
