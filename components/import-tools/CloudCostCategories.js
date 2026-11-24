import {useEffect,useRef,useState} from 'react';
import {CLOUD_CATEGORIES,cloudLineCategory} from '../../lib/chinaCloudCost.js';
import styles from '../../styles/CloudCostCategories.module.css';

export default function CloudCostCategories({lines,inputs,onChange,disabled,scope,preserveEdits=[]}){
 const [record,setRecord]=useState(null),[notice,setNotice]=useState(''),[saving,setSaving]=useState(false),[edited,setEdited]=useState({}),[reload,setReload]=useState(0);
 const live=useRef({lines,inputs,onChange});live.current={lines,inputs,onChange};
 const dirty=useRef(new Set()),generation=useRef(0),priorScope=useRef('');
 const scopeKey=scope?JSON.stringify([scope.orderYear,scope.orderWeek,[...scope.warehouseKeys].sort((a,b)=>a-b)]):'';
 useEffect(()=>{
  const token=++generation.current,abort=new AbortController();
  if(priorScope.current!==scopeKey){dirty.current=new Set(preserveEdits);setEdited(Object.fromEntries(preserveEdits.map(k=>[k,true])));priorScope.current=scopeKey;}
  setRecord(null);
  if(!scopeKey)return()=>abort.abort();
  const [orderYear,orderWeek,warehouseKeys]=JSON.parse(scopeKey);
  fetch('/api/import/receipts/cloud-mappings?'+new URLSearchParams({orderYear,orderWeek,warehouseKeys:warehouseKeys.join(',')}),{signal:abort.signal,cache:'no-store'})
   .then(async r=>{const d=await r.json();if(!r.ok||!d.success)throw Error(d.error);return d;})
   .then(d=>{if(abort.signal.aborted||generation.current!==token)return;setRecord(d);setNotice('공유 매칭 조회 완료 · 편집 중인 행은 유지했습니다.');
    for(const line of live.current.lines){const entry=d.entries.find(e=>e.prodKey===line.prodKey);if(entry&&!dirty.current.has(line.lineId)){
     const current=live.current.inputs.find(i=>i.lineId===line.lineId)??{};
     if(JSON.stringify([current.categoryCode??null,current.categoryOverride??null])!==JSON.stringify([entry.categoryCode,entry.categoryOverride??null])){
      live.current.onChange(line.lineId,'categoryCode',entry.categoryCode);live.current.onChange(line.lineId,'categoryOverride',entry.categoryOverride??null);
     }
    }}
   }).catch(e=>{if(!abort.signal.aborted)setNotice((e.message||'공유 매칭 조회 실패')+' · 현재 입력 유지');});
  return()=>abort.abort();
 },[scopeKey,reload]);
 const change=(line,key,value)=>{dirty.current.add(line.lineId);setEdited(current=>({...current,[line.lineId]:true}));onChange(line.lineId,key,value);};
 async function save(){
  if(!record||saving)return;const token=generation.current;setSaving(true);setNotice('공유 저장 중…');
  try{
   const entries=[];
   for(const line of lines.filter(l=>dirty.current.has(l.lineId))){const i=inputs.find(i=>i.lineId===line.lineId)??{},entry={country:'CN',farm:'CLOUDLAND',prodKey:line.prodKey,categoryCode:i.categoryCode===''?null:i.categoryCode??null,categoryOverride:i.categoryOverride??null};
    if((entry.categoryCode!==null||entry.categoryOverride)&&!cloudLineCategory(entry))throw Error('직접 입력한 이름·규격·관세율을 모두 확인하세요.');
    const prior=entries.find(e=>e.prodKey===entry.prodKey);if(prior&&JSON.stringify(prior)!==JSON.stringify(entry))throw Error('같은 전산 품목의 매칭이 서로 다릅니다. 저장 전에 일치시켜 주세요.');if(!prior)entries.push(entry);
   }
   const [orderYear,orderWeek,warehouseKeys]=JSON.parse(scopeKey);
   const response=await fetch('/api/import/receipts/cloud-mappings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderYear,orderWeek,warehouseKeys,entries,expectedRevision:record.revision})});const data=await response.json();
   if(token!==generation.current)return;if(!response.ok||!data.success)throw Error(data.error);
   setRecord(data);dirty.current.clear();setEdited({});setNotice('공유 저장 완료 · 다른 직원도 같은 중국 CLOUD 전산 품목에 적용됩니다.');
  }catch(e){if(token===generation.current)setNotice((e.message||'공유 저장 실패')+' · 현재 입력 유지. 충돌이면 공유 매칭을 다시 불러와 비교하세요.');}
  finally{if(token===generation.current)setSaving(false);}
 }
 const pending=lines.filter(l=>Number(l.outQuantity)>0&&!cloudLineCategory(inputs.find(i=>i.lineId===l.lineId)));
 return <section className={styles.root} aria-label="CLOUD 품종 카테고리">
  <h4>CLOUD 품종 카테고리 · 확인 필요 {pending.length}개</h4>
  <p>원문과 전산 품목을 같은 행에서 확인합니다. 선택·입력한 행은 사라지지 않습니다. 공유 저장은 중국 CLOUD의 같은 전산 품목에만 적용하며 ERP 품목·입고는 변경하지 않습니다.</p>
  <button type="button" disabled={disabled||saving||!record||!Object.keys(edited).length} onClick={save}>{saving?'공유 저장 중…':`변경 ${Object.keys(edited).length}행 공유 저장`}</button>
  {scopeKey&&<button type="button" disabled={saving} onClick={()=>setReload(v=>v+1)}>공유 매칭 다시 불러오기 · 현재 입력 유지</button>}
  <p role="status">{notice||(!scopeKey?'입고 연결 후 공유 매칭을 저장할 수 있습니다.':'공유 매칭 조회 중…')}</p>
  <table><thead><tr><th>원문 품목</th><th>ERP 매칭 품목</th><th>CLOUD 카테고리 · 직접 입력</th><th>확인·저장 상태</th></tr></thead>
  <tbody>{lines.map(line=>{const value=inputs.find(i=>i.lineId===line.lineId)??{},category=cloudLineCategory(value),custom=value.categoryOverride;const state=edited[line.lineId]?'변경 · 공유 저장 전':category?record?.entries.some(e=>e.prodKey===line.prodKey)?'공유 저장됨':'자동 연결':'확인 필요';
   const override=(key,next)=>change(line,'categoryOverride',{...custom,[key]:next}),rowId=line.receiptKey?`입고 ${line.receiptKey} ${line.lineNo??line.lineId}`:line.lineNo??line.lineId;
   const original=Object.hasOwn(line,'sourceOriginalName')?(line.sourceOriginalName||'원문 연결 없음 · ERP명은 오른쪽 참고'):line.originalName;
   return <tr key={line.lineId} data-state={edited[line.lineId]?'changed':category?'matched':'pending'}><td>{original}{line.receiptKey&&<><br/><small>입고 #{line.receiptKey} · {line.invoiceNo}</small></>}</td><td><strong>{line.erpProductName||line.prodName||line.productName||line.originalName}</strong><br/>품목 #{line.prodKey}</td><td>
    <select aria-label={`${rowId}행 CLOUD 카테고리`} disabled={disabled||saving} value={custom?'DIRECT':value.categoryCode??''} onChange={e=>{
     if(e.target.value==='DIRECT'){const c=category;change(line,'categoryOverride',{label:c?.label??'',bunchesPerBox:c?.bunchesPerBox??'',length:c?.length??'',width:c?.width??'',height:c?.height??'',tariffRate:c?.tariffRate??'',weightMode:c&&[4,21].includes(c.code)?'FIXED_15KG':'VOLUME'});}
     else{change(line,'categoryCode',e.target.value===''?null:Number(e.target.value));change(line,'categoryOverride',null);}
    }}><option value="">선택 필요 · 매칭 해제</option>{CLOUD_CATEGORIES.map(c=><option key={c.code} value={c.code}>{c.label}</option>)}<option value="DIRECT">직접 입력 · 이름·규격·관세</option></select>
    {custom&&<div className={styles.fields}>
     <label>카테고리명<input aria-label={`${rowId}행 직접 카테고리명`} value={custom.label??''} onChange={e=>override('label',e.target.value)} disabled={disabled||saving}/></label>
     <label>박스 중량 기준<select value={custom.weightMode} onChange={e=>override('weightMode',e.target.value)} disabled={disabled||saving}><option value="VOLUME">길이×폭×높이÷6000</option><option value="FIXED_15KG">원가표 고정15kg/박스</option></select></label>
     {['bunchesPerBox',...(custom.weightMode==='VOLUME'?['length','width','height']:[]),'tariffRate'].map(key=><label key={key}>{({bunchesPerBox:'박스당 단수',length:'길이 cm',width:'폭 cm',height:'높이 cm',tariffRate:'관세율 · 0.214=21.4%'})[key]}<input type="text" inputMode="decimal" aria-label={`${rowId}행 ${key}`} value={custom[key]??''} onChange={e=>override(key,e.target.value)} disabled={disabled||saving}/></label>)}
    </div>}
    {category&&<p>{category.bunchesPerBox}단/박스 · {category.volumeKgPerBox.toLocaleString('ko-KR',{maximumFractionDigits:4})}kg/박스 · 관세 {(category.tariffRate*100).toLocaleString('ko-KR')}%</p>}
   </td><td><strong>{state}</strong>{!category&&<p>카테고리와 규격 확인 후 계산할 수 있습니다.</p>}</td></tr>;
  })}</tbody></table>
 </section>;
}
