import React,{useEffect,useRef,useState} from 'react';
import {apiGet} from '../lib/useApi';
const num=v=>v==null?'미기록':Number(v).toLocaleString('ko-KR',{maximumFractionDigits:4});
import {calendarEvents,calendarWeeks,ledgerActions as actions,recordedDate} from '../lib/estimateLedgerCalendar';
function Snapshot({value}) {
 if(!value)return <p>저장된 당시 값이 없습니다.</p>;
 return <div><p>{value.orderYear ?? '미확인'}년 {value.orderWeek ?? '미확인'}차 · {value.customerName} · {value.productName} {value.colorName}</p>
 <p>수량 {num(value.quantity)} {value.sourceUnit} · 단가 {num(value.estimateCost)}원 · 연결 견적 {value.estimateKey || '없음'} · 적용 {value.appliedOrderYear ?? '미기록'} / {value.appliedOrderWeek ?? '미기록'}</p>
 <p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>비고: {value.note || '미기록'}</p><p style={{overflowWrap:'anywhere'}}>출처: {value.sourceFileName || '미기록'}</p></div>;
}
function Calendar({data,scope}) {
 const events=calendarEvents(data),months=[...new Set(events.filter(e=>e.date).map(e=>e.date.month))].sort();
 const [chosen,setChosen]=useState('');const month=months.includes(chosen)?chosen:months[months.length-1];const index=months.indexOf(month);
 const unknown=events.filter(e=>!e.date);
 return <section aria-label="해당 차수 기록 달력"><h4>해당 차수 기록 달력 · {scope.year}년 {scope.week}차</h4>
 <p>선택 차수에 연결된 신고의 전체 등록·변경 이력과 해당 차수 전체 판매 스냅샷을 기록된 날짜에 표시합니다. 원차수·적용차수는 아래 값으로 확인하며 달력 날짜로 환산하지 않습니다. 차수 이후의 기록도 실제 날짜에 표시합니다. 시각은 DB 저장 시각입니다.</p>
 <p>판매등록확정: {data.sales?.status!=='checked'?'이력 조회 불가':data.sales.rows.some(x=>x.SnapshotType==='REG_CONFIRM')?'아래 확정 기록 참고':'해당 차수 미기록'} · 이카운트 실제 판매 입력일 / 견적 엑셀 다운로드일: 미기록. 판매등록확정·마감 스냅샷은 엑셀 다운로드나 이카운트 입력의 증거가 아닙니다.</p>
 {months.length>0?<><div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',marginBottom:12}}><button type="button" className="btn btn-sm" disabled={index<=0} onClick={()=>setChosen(months[index-1])}>이전 기록 월</button><label>기록 월 <select value={month} onChange={e=>setChosen(e.target.value)}>{months.map(m=><option key={m} value={m}>{m.replace('-','년 ')}월</option>)}</select></label><button type="button" className="btn btn-sm" disabled={index>=months.length-1} onClick={()=>setChosen(months[index+1])}>다음 기록 월</button><span role="status">{month} · {events.filter(e=>e.date?.month===month).length}개 기록</span></div>
 <div style={{overflowX:'auto'}}><table aria-label={`${month} 기록 달력`} style={{width:'100%',minWidth:700,tableLayout:'fixed',borderCollapse:'collapse'}}><caption style={{textAlign:'left',paddingBottom:8}}>신고 이력은 개별 신고 기준 · 판매 스냅샷은 차수 전체 기준</caption><thead><tr>{['일','월','화','수','목','금','토'].map(d=><th key={d} scope="col" style={{padding:8,background:'#edf2f7'}}>{d}</th>)}</tr></thead><tbody>{calendarWeeks(month).map((week,i)=><tr key={i}>{week.map((day,j)=><td key={j} style={{verticalAlign:'top',border:'1px solid #cbd5e1',padding:8,height:80,background:day?'white':'#f8fafc'}}>{day&&<><time dateTime={day} style={{fontWeight:700}}>{Number(day.slice(-2))}</time>{events.filter(e=>e.date?.day===day).map(e=><div key={e.key} style={{marginTop:8,padding:6,borderLeft:`3px solid ${e.kind==='해당 차수 전체'?'#7c3aed':'#0284c7'}`,background:'#f1f5f9',overflowWrap:'anywhere'}}><strong>{e.title}</strong><div>{e.date.time} · {e.kind}</div><div>{e.ref}</div>{e.snapshot&&<div>원 {e.snapshot.orderYear??'미기록'}년 {e.snapshot.orderWeek??'미기록'}차<br/>적용 {e.snapshot.appliedOrderYear??'미기록'}년 {e.snapshot.appliedOrderWeek??'미기록'}차</div>}</div>)}</>}</td>)}</tr>)}</tbody></table></div></>:<p>날짜가 기록된 이력이 없습니다.</p>}
 {unknown.length>0&&<p>날짜 미기록: {unknown.map(e=>`${e.title} (${e.ref})`).join(' · ')}</p>}
 </section>;
}
function Estimates({rows,candidates=false}) {
 if(!rows.length)return <p>{candidates?'조회 범위에서 다른 번호의 음수 견적을 찾지 못했습니다.':'현재 차수에 같은 업체·품목의 별도 견적·차감 행이 없습니다.'}</p>;
 return <div style={{overflowX:'auto'}}><table className="data-table" style={{width:'100%',minWidth:850}}><thead><tr>{['견적 번호','연도·차수','수량·단위','단가','공급가액','부가세','연결 신고 / 원차수','대조할 내용'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{rows.map((x,i)=><tr key={`${x.EstimateKey}:${x.OwnerKey}:${i}`}><td>{x.EstimateKey}</td><td>{x.OrderYear} / {x.OrderWeek}</td><td>{num(x.Quantity)} {x.Unit}</td><td>{num(x.Cost)}</td><td>{num(x.Amount)}</td><td>{num(x.Vat)}</td><td>{x.OwnerKey?`#${x.OwnerKey} / ${x.SourceYear}년 ${x.SourceWeek}차 · ${num(x.SourceQuantity)} ${x.SourceUnit}${x.SourceDeleted?' (삭제 신고)':''}`:'연결 기록 없음'}</td><td>{x.comparison || (x.MasterDeleted?'삭제된 출고 헤더':'현재 저장 견적')}</td></tr>)}</tbody></table></div>;
}
export default function EstimateLedgerReview({scope,deductionKey,onClose}) {
 const [attempt,setAttempt]=useState(0),[state,setState]=useState({loading:true});const heading=useRef(null);
 useEffect(()=>{heading.current?.focus();},[]);
 useEffect(()=>{let active=true;setState({loading:true});apiGet('/api/estimate/ledger-alerts',{year:scope.year,week:scope.week,deductionKey}).then(data=>{if(!data?.success)throw Error(data?.error || '대조 조회 실패');if(active)setState({data});}).catch(error=>{if(active)setState({error:error.message});});return()=>{active=false;};},[scope.year,scope.week,deductionKey,attempt]);
 const d=state.data,s=d?.source;
 return <section aria-label="신고와 견적 대조" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();onClose();}}} style={{marginTop:12,padding:12,background:'white',border:'1px solid #c8d2df',borderRadius:5}}>
 <div style={{display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}}><h3 ref={heading} tabIndex={-1}>신고 #{deductionKey} · 신고와 견적 대조</h3><button type="button" className="btn btn-sm" onClick={onClose}>대조 닫기 (Esc)</button><button type="button" className="btn btn-sm" disabled={state.loading} onClick={()=>setAttempt(x=>x+1)}>대조 다시 조회</button></div>
 {state.loading&&<p role="status">신고·이력·견적을 조회하고 있습니다…</p>}
 {state.error&&<p role="alert">{state.error} — 조회 실패이며 차감이 없다는 뜻이 아닙니다.</p>}
 {d&&<><p><strong>{s.CustName} · {s.ProdName}</strong> · 연결 견적 #{s.EstimateKey} · 현재 조회 {scope.year}년 {scope.week}차</p>
 <p>조회 전용입니다. 다른 번호가 보여도 같은 신고의 차감이라고 확정하지 마세요. 삭제 여부·차감 필요 여부는 아래 근거로 대조합니다.</p>
 <Calendar data={d} scope={scope}/><h4>1. 최초 저장 신고와 현재 신고</h4><p>최초 등록 이력의 신고 값입니다. 카톡·엑셀 원문 자체와는 다릅니다. 원문이 필요하면 아래 출처 파일과 대조하세요.</p>
 <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))',gap:16}}><div><strong>최초 저장 신고</strong><p>등록일: {recordedDate(d.history.find(h=>h.ActionType==='CREATE')?.ChangedAt)?.day??'미기록'}</p>{d.original?<Snapshot value={d.original}/>:<p>최초 등록 이력이 없어 원래 값을 확인할 수 없습니다.</p>}</div><div><strong>현재 저장 신고{s.IsDeleted?' (삭제 상태)':''}</strong><p>신고 생성: {s.CreatedAt||'미기록'} · 최종 수정: {s.UpdatedAt||'미기록'}</p><Snapshot value={{orderYear:s.OrderYear,orderWeek:s.OrderWeek,customerName:s.CustName,productName:s.ProdName,colorName:s.ColorName,quantity:s.Quantity,sourceUnit:s.SourceUnit,note:s.Note,sourceFileName:s.SourceFileName,estimateKey:s.EstimateKey,estimateCost:s.EstimateCost,appliedOrderYear:s.AppliedOrderYear,appliedOrderWeek:s.AppliedOrderWeek}}/></div></div>
 <h4>2. 등록·변경 이력</h4>{!d.history.length?<p>저장된 이력이 없습니다.</p>:d.history.map(h=><details key={h.HistoryKey}><summary>{String(h.ChangedAt ?? '').replace('T',' ').replace(/\.\d+Z$/,'')} · {actions[h.ActionType] || h.ActionType} · 이력 #{h.HistoryKey}</summary><strong>변경 전</strong><Snapshot value={h.before}/><strong>변경 후</strong><Snapshot value={h.after}/></details>)}
 <h4>3. 현재 차수의 견적·차감 원장</h4><p>같은 업체·품목의 Estimate 저장행입니다. 일반 출고 매출 전체가 아니며, 삭제된 헤더도 상태를 표시합니다.</p><Estimates rows={d.current}/>
 <h4>4. 다른 번호로 차감된 내역</h4><p>같은 업체·품목의 음수 견적 · {Array.from(new Set([s.OrderYear,Number(scope.year)])).join(', ')}년 전체 차수. 수량·단위가 같아도 원차수가 다르거나 다른 신고에 연결됐다면 별건일 수 있습니다. 단가·금액은 저장값 그대로입니다.</p><Estimates rows={d.candidates} candidates/>
 <p>조회 시각: {d.checkedAt} · 기록이 없는 과거 삭제·연결 해제는 확인할 수 없습니다.</p></>}
 </section>;
}
