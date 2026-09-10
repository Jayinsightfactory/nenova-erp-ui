import { useEffect, useMemo, useRef, useState } from 'react';

const EMPTY_BINDINGS=()=>({sheetScopes:Object.create(null),keymapBatch:Object.create(null),rowOverrides:Object.create(null),columnOverrides:Object.create(null),dateGroups:[],columnDateOverrides:Object.create(null),unitAttestation:{originalExportUnitsPreserved:false},rowUnitOverrides:Object.create(null)});
const isId=value=>typeof value==='string'&&/^[a-f0-9]{64}$/i.test(value);
const text=value=>value===null||value===undefined||value===''?'—':String(value);
const numeric=value=>typeof value==='number'&&Number.isFinite(value)?String(value):'—';
const delta=value=>value===null||value===undefined?'확인 필요':numeric(value);
const mapValue=(map,key)=>Object.prototype.hasOwnProperty.call(map||{},key)?map[key]:null;
function setMapValue(map,key,value) { const next=Object.create(null);Object.keys(map||{}).forEach(current=>{if(current!==key)next[current]=map[current];});if(value!==null)Object.defineProperty(next,key,{value,enumerable:true,writable:true,configurable:true});return next; }
const originLabel=origin=>origin==='ERP_ONLY'?'전산에만 있는 항목':origin==='ERP_CANDIDATE'?'범위 확인 전 전산 후보':'원본 항목';
const stateLabel=state=>state==='COMPARABLE'?'비교 가능':state==='ERP_ONLY'?'전산 추가 항목':'확인 필요';
function observedAtKst(value) {
  const date=new Date(value);
  return Number.isNaN(date.getTime())?'응답에 없음':new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(date)+' KST';
}

function readError(data,fallback) {
  return typeof data?.error==='string'?data.error:typeof data?.error?.message==='string'?data.error.message:fallback;
}

function validResult(data) {
  return data?.success===true&&data?.advisoryOnly===true&&data.baseline&&Array.isArray(data.sheets)&&Array.isArray(data.sheetCandidates)&&Array.isArray(data.unclassifiedCurrent)&&Array.isArray(data.issues);
}

export default function DistributionBaselineReconciliation({record,selectedWeek,onModeChange}) {
  const [bindings,setBindings]=useState(EMPTY_BINDINGS);
  const [result,setResult]=useState(null);
  const [activeSheet,setActiveSheet]=useState('');
  const [search,setSearch]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [editor,setEditor]=useState(null);
  const sequence=useRef(0);
  const scopeKey=`${record?.id||''}:${selectedWeek||''}`;
  const activeScope=useRef(scopeKey);activeScope.current=scopeKey;
  const weekMatch=/^(\d{4})-(\d{2}-\d{2})$/.exec(String(selectedWeek||''));

  useEffect(()=>{
    sequence.current++;setBindings(EMPTY_BINDINGS());setResult(null);setActiveSheet('');setSearch('');setBusy(false);setError('');setEditor(null);onModeChange?.(false);
  },[scopeKey,onModeChange]);

  const products=useMemo(()=>new Map((result?.catalog?.products||[]).map(item=>[Number(item.ProdKey),item])),[result]);
  const customers=useMemo(()=>new Map((result?.catalog?.customers||[]).map(item=>[Number(item.CustKey),item])),[result]);
  const sheets=result?.sheets||[];
  const sheet=sheets.find(item=>item.id===activeSheet)||sheets[0]||null;
  const sourceSheet=(record?.parsed?.sheets||[]).find(item=>item.id===sheet?.id)||null;
  const sourceRows=sourceSheet?.rows||[];
  const sourceColumns=sourceSheet?.clients||[];
  const candidateBySheet=useMemo(()=>new Map((result?.sheetCandidates||[]).map(item=>[item.sheetId,item])),[result]);
  const selectedScope=sourceSheet?mapValue(bindings.sheetScopes,sourceSheet.id):null;
  const selectedBatch=sourceSheet?mapValue(bindings.keymapBatch,sourceSheet.id):null;
  const cellByCoordinate=useMemo(()=>new Map((sheet?.cells||[]).map(cell=>[`${cell.rowId}\u001f${cell.columnId}`,cell])),[sheet]);

  function setBinding(name,value) { setBindings(previous=>({...previous,[name]:value})); }
  function setScope(candidate,confirmed) {
    if(!candidate)return;
    const groups=(candidate.groups||[]).map(group=>({country:group.country,flower:group.flower}));
    const sheetId=candidate.sheetId;
    setBindings(previous=>({...previous,sheetScopes:setMapValue(previous.sheetScopes,sheetId,{confirmed:Boolean(confirmed),groups})}));
  }
  function setBatch(sheetId,field,checked) {
    setBindings(previous=>{
      const current=mapValue(previous.keymapBatch,sheetId)||{confirmRows:false,confirmClients:false};
      return {...previous,keymapBatch:setMapValue(previous.keymapBatch,sheetId,{...current,[field]:Boolean(checked)})};
    });
  }
  function setOverride(kind,id,key,value) {
    setBindings(previous=>{
      const positive=Number(value)>0;
      return {...previous,[kind]:setMapValue(previous[kind],key,positive?{[id==='rowId'?'prodKey':'custKey']:Number(value),confirmed:true}:null)};
    });
  }
  function setDateGroup(columns,shipmentDate) {
    setBindings(previous=>({...previous,dateGroups:[...previous.dateGroups.filter(group=>!group.columnIds.some(id=>columns.includes(id))),...(shipmentDate?[{columnIds:columns,shipmentDate,confirmed:true}]:[])]}));
  }
  function setColumnDate(columnId,shipmentDate) {
    setBindings(previous=>({...previous,columnDateOverrides:setMapValue(previous.columnDateOverrides,columnId,shipmentDate?{shipmentDate,confirmed:true}:null)}));
  }
  function setUnit(rowId,unit) {
    setBindings(previous=>({...previous,rowUnitOverrides:setMapValue(previous.rowUnitOverrides,rowId,unit?{unit,confirmed:true}:null)}));
  }
  async function loadCurrent() {
    const requestScope=scopeKey;
    if(!weekMatch||!isId(record?.id)||String(record.year)!==weekMatch[1]||String(record.week)!==weekMatch[2]) {setError('선택 차수와 같은 서버 보관 기준표가 필요합니다. 원본 표는 유지됩니다.');return;}
    const requestId=++sequence.current;setBusy(true);setError('');
    try {
      const response=await fetch('/api/orders/distribution-baseline-reconciliation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({year:weekMatch[1],week:weekMatch[2],baselineId:record.id,bindings})});
      const data=await response.json().catch(()=>null);
      if(activeScope.current!==requestScope||requestId!==sequence.current)return;
      if(!response.ok||!validResult(data)) {setError(readError(data,'전산 현재값을 확인하지 못했습니다. 원본 표는 유지됩니다.'));return;}
      setResult(data);setActiveSheet(previous=>data.sheets.some(item=>item.id===previous)?previous:data.sheets[0]?.id||'');onModeChange?.(true);
    } catch {if(activeScope.current===requestScope&&requestId===sequence.current)setError('전산 현재값을 확인하지 못했습니다. 원본 표는 유지됩니다.');}
    finally {if(activeScope.current===requestScope&&requestId===sequence.current)setBusy(false);}
  }
  if(!record)return null;
  const dateGroups=sourceSheet?sourceColumns.reduce((groups,column)=>{
    const raw=column.day||'미정';const found=groups.find(group=>group.raw===raw);if(found)found.columns.push(column);else groups.push({raw,columns:[column]});return groups;
  },[]):[];
  const filteredRows=sheet?(sheet.rows||[]).filter(row=>`${row.label||''} ${row.prodKey||''}`.toLowerCase().includes(search.toLowerCase())):[];
  const editorOptions=editor?.kind==='row'?[...products.values()].filter(product=>`${product.DisplayName||product.ProdName||''} ${product.ProdKey}`.toLowerCase().includes((editor.query||'').toLowerCase())).slice(0,30):editor?.kind==='column'?[...customers.values()].filter(customer=>`${customer.CustName||''} ${customer.CustKey}`.toLowerCase().includes((editor.query||'').toLowerCase())).slice(0,30):[];
  function candidateText(kind,source) {
    const candidate=kind==='row'?products.get(Number(source.key)):customers.get(Number(source.key));
    const keyLabel=kind==='row'?'품목':'거래처';
    const rawKey=source?.key;
    if(rawKey===null||rawKey===undefined||rawKey==='')return `원본 ${keyLabel} 키 없음`;
    return candidate?`원본 ${keyLabel} 키 ${rawKey} · ${kind==='row'?(candidate.DisplayName||candidate.ProdName):candidate.CustName}`:`원본 ${keyLabel} 키 ${rawKey} · 전산 후보 없음`;
  }
  function mappingEditor(kind,source) {
    const bindingKey=kind==='row'?'rowOverrides':'columnOverrides';const idField=kind==='row'?'rowId':'columnId';
    const override=mapValue(bindings[bindingKey],source.id);const selected=override?.[kind==='row'?'prodKey':'custKey'];
    const editing=editor?.kind===kind&&editor.id===source.id;
    if(!editing)return <span>{selected?`직접 확인 (${selected})`:candidateText(kind,source)} {!selected&&!((kind==='row'?products:customers).get(Number(source.key)))&&<button type="button" onClick={()=>setEditor({kind,id:source.id,query:''})}>직접 선택</button>}</span>;
    return <span className="mapping-editor"><input autoFocus value={editor.query} onChange={event=>setEditor({...editor,query:event.target.value})} placeholder="이름 또는 번호 검색"/><select size="4" value="" onChange={event=>{if(event.target.value){setOverride(bindingKey,idField,source.id,event.target.value);setEditor(null);}}}><option value="">후보 {editorOptions.length}건</option>{editorOptions.map(item=><option key={kind==='row'?item.ProdKey:item.CustKey} value={kind==='row'?item.ProdKey:item.CustKey}>{kind==='row'?(item.DisplayName||item.ProdName):item.CustName} ({kind==='row'?item.ProdKey:item.CustKey})</option>)}</select><button type="button" onClick={()=>setEditor(null)}>닫기</button></span>;
  }

  return <section className="baseline-reconcile" aria-label="기준표 전산 현재값 비교">
    <div className="reconcile-bar"><strong>기준표 전산 현재값 비교</strong><span>읽기 전용 · 현재 화면에서만 확인값을 유지합니다.</span><button type="button" disabled={busy} onClick={loadCurrent}>{busy?'불러오는 중…':'전산 현재값 보기'}</button>{result&&<button type="button" onClick={()=>onModeChange?.(false)}>원본 표 보기</button>}</div>
    <p className="reconcile-note">원본 keymap·요일 표기를 먼저 확인하고, 확인값을 직접 선택한 뒤 다시 조회하세요. 미확정 수량은 0으로 처리하지 않습니다.</p>
    {error&&<p className="reconcile-error" role="alert">{error}</p>}
    {result&&<>
      <div className="reconcile-bar"><span title={result.baseline.id}>{record.fileName||'보관 기준표'} · {String(result.baseline.id).slice(0,8)}…</span><span>확인 시각 {observedAtKst(result.observedAt)}</span><span>{result.scope?.currentComplete===false?'현재 자료가 완전하지 않습니다.':'자문용 현재값입니다.'}</span></div>
      <div className="reconcile-tabs">{sheets.map(item=><button type="button" key={item.id} aria-pressed={item.id===sheet?.id} onClick={()=>{setActiveSheet(item.id);setSearch('');setEditor(null);}}>{item.name||item.id}</button>)}</div>
      {sheet&&<>
        <div className="reconcile-bar"><label>이 시트 품목 검색 <input value={search} onChange={event=>setSearch(event.target.value)} placeholder="품목 또는 키"/></label><span>{filteredRows.length}/{sheet.rows.length} 품목 · {sheet.columns.length} 열</span></div>
        <details className="reconcile-settings" open><summary>원본 keymap·범위·날짜·단위 확인</summary>
          <div className="settings-body"><div className="setting-grid">
            <section><strong>시트 범위</strong>{candidateBySheet.get(sheet.id)?.groups?.length?<><p>{candidateBySheet.get(sheet.id).groups.map(group=>`${group.country} · ${group.flower}`).join(' / ')}</p><label><input type="checkbox" checked={!!selectedScope?.confirmed} onChange={event=>setScope(candidateBySheet.get(sheet.id),event.target.checked)}/> 위 품목군 전체를 직접 확인</label></>:<p>원본 품목 키 후보가 모두 확인되기 전에는 범위를 정할 수 없습니다.</p>}</section>
            <section><strong>원본 keymap 일괄 확인</strong><label><input type="checkbox" checked={!!selectedBatch?.confirmRows} onChange={event=>setBatch(sheet.id,'confirmRows',event.target.checked)}/> 표시된 품목 키를 일괄 확인</label><label><input type="checkbox" checked={!!selectedBatch?.confirmClients} onChange={event=>setBatch(sheet.id,'confirmClients',event.target.checked)}/> 표시된 거래처 키를 일괄 확인</label><small>자동으로 체크하지 않습니다. 원본 키 후보가 없는 항목만 직접 선택하세요.</small></section>
            <section><strong>원본 단위</strong><label><input type="checkbox" checked={bindings.unitAttestation.originalExportUnitsPreserved===true} onChange={event=>setBinding('unitAttestation',{originalExportUnitsPreserved:event.target.checked})}/> 원본 내보내기 단위를 그대로 사용함</label><small>체크 전에는 기준 수량과 현재 수량의 차이를 계산하지 않습니다.</small></section>
          </div>
          <div className="keymap-table"><strong>원본 keymap 대응표</strong><table><thead><tr><th>원본 종류</th><th>원본 이름</th><th>전산 후보 / 직접 확인</th></tr></thead><tbody>{sourceRows.map(row=><tr key={`row:${row.id}`}><td>품목</td><td>{row.label||row.id}</td><td>{mappingEditor('row',row)}</td></tr>)}{sourceColumns.map(column=><tr key={`column:${column.id}`}><td>거래처 열</td><td>{column.label||column.id}</td><td>{mappingEditor('column',column)}</td></tr>)}</tbody></table></div>
          <div className="date-grid"><strong>원본 요일별 출고일 지정</strong>{dateGroups.map(group=>{const chosen=bindings.dateGroups.find(item=>item.columnIds.length===group.columns.length&&item.columnIds.every(id=>group.columns.some(column=>column.id===id)));return <label key={group.raw}>원본 표기 {group.raw}<input type="date" value={chosen?.shipmentDate||''} onChange={event=>setDateGroup(group.columns.map(column=>column.id),event.target.value)}/><small>빈 값·미정·요일은 날짜로 추정하지 않습니다.</small></label>;})}</div>
          <details className="exception-settings"><summary>열별 날짜·품목별 단위 예외 설정</summary><div className="date-grid">{sourceColumns.map(column=>{const chosen=mapValue(bindings.columnDateOverrides,column.id);return <label key={column.id}>{column.label||column.id} · 원본 {column.day||'미정'}<input type="date" value={chosen?.shipmentDate||''} onChange={event=>setColumnDate(column.id,event.target.value)}/></label>;})}</div><div className="date-grid">{sourceRows.map(row=>{const chosen=mapValue(bindings.rowUnitOverrides,row.id);return <label key={row.id}>{row.label||row.id}<select value={chosen?.unit||''} onChange={event=>setUnit(row.id,event.target.value)}><option value="">원본/전산 단위 유지</option><option value="박스">박스</option><option value="단">단</option><option value="송이">송이</option></select></label>;})}</div></details>
          </div>
        </details>
        <div className="reconcile-scroll" tabIndex={0} aria-label="전산 현재값 비교 표"><table><thead><tr><th className="sticky-product">품목</th>{(sheet.columns||[]).map(column=><th key={column.id} title={column.label}>{column.label||column.id}<small>{column.shipmentDate||column.sourceDay||'일자 미정'} · {originLabel(column.origin)}</small></th>)}</tr></thead><tbody>{filteredRows.map(row=><tr key={row.id}><td className="sticky-product" title={row.label}>{row.label||row.id}<small>{originLabel(row.origin)} · {row.prodKey||'품목 확인 필요'}</small></td>{(sheet.columns||[]).map(column=>{const cell=cellByCoordinate.get(`${row.id}\u001f${column.id}`);return <td key={column.id} className={cell?.delta===null||cell?.delta===undefined?'needs-review':''}><span>원본 {text(cell?.baselineRaw)}</span><span>현재 {numeric(cell?.erpCurrentQuantity)}</span><strong>차이 {delta(cell?.delta)}</strong>{cell?.unit&&<small>단위 {cell.unit}</small>}{cell?.state&&<small>{stateLabel(cell.state)}</small>}</td>;})}</tr>)}</tbody></table></div>
      </>}
      {!!result.unclassifiedCurrent.length&&<details><summary>시트 범위에 넣지 않은 전산 현재 행 {result.unclassifiedCurrent.length}건</summary><ul>{result.unclassifiedCurrent.slice(0,100).map((row,index)=><li key={`${row.prodKey||'p'}:${row.custKey||'c'}:${index}`}>품목 {row.prodKey||'확인 필요'} · 거래처 {row.custKey||'확인 필요'} · 출고일 {row.shipmentDate||'확인 필요'} · 수량 {numeric(row.qty)}</li>)}</ul>{result.unclassifiedCurrent.length>100&&<p className="reconcile-note">처음 100건만 표시했습니다. 이 항목들은 원본 누락으로 판단하지 않습니다.</p>}</details>}
      {!!result.issues.length&&<details><summary>확인사항 {result.issues.length}건</summary><ul>{result.issues.map((issue,index)=><li key={index}>{typeof issue==='string'?issue:issue.message||issue.code||'추가 확인이 필요합니다.'}</li>)}</ul></details>}
    </>}
    <style jsx>{`.baseline-reconcile{border-top:1px solid #b8c9dc;background:#fbfdff;font-size:12px;color:#26405a}.reconcile-bar,.reconcile-tabs{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:6px 7px}.reconcile-bar strong{color:#294f73}.reconcile-bar span,.reconcile-note,small{color:#60758b}.reconcile-note{margin:3px 7px}.reconcile-bar button,.reconcile-tabs button,.mapping-editor button{border:1px solid #9db2ca;background:white;color:#245b93;padding:4px 8px;min-height:27px;cursor:pointer;font:inherit}.reconcile-tabs{border-block:1px solid #d7e3ef}.reconcile-tabs button[aria-pressed=true]{background:#daeaff}.reconcile-bar input,.reconcile-settings input,.reconcile-settings select{font:inherit;border:1px solid #afc2d8;padding:3px;max-width:190px}.reconcile-error{color:#b32929;margin:5px 7px}.reconcile-settings{margin:5px 7px;padding:5px;border:1px solid #d2dfed;background:#f7faff}.reconcile-settings summary{cursor:pointer;color:#245b93}.settings-body{max-height:320px;overflow:auto;padding-right:3px}.setting-grid,.date-grid{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}.setting-grid section,.date-grid label{display:grid;gap:3px;border:1px solid #dbe6f0;padding:5px;background:white;min-width:210px}.setting-grid label{display:flex;gap:4px;align-items:center}.keymap-table{margin-top:7px;max-height:180px;overflow:auto}.keymap-table table{border-collapse:collapse;width:max-content}.keymap-table th,.keymap-table td{border:1px solid #d8e2ed;padding:3px;white-space:nowrap}.keymap-table th{background:#eef4fa}.mapping-editor{display:inline-flex;gap:4px;align-items:flex-start}.mapping-editor input{min-width:145px}.mapping-editor select{min-width:210px}.exception-settings{margin-top:7px;border-top:1px solid #dbe6f0}.exception-settings>summary{padding-top:5px}.reconcile-scroll{height:450px;max-height:55vh;overflow:auto;border-top:1px solid #b7c8db;background:white}.reconcile-scroll table{border-collapse:separate;border-spacing:0;width:max-content;table-layout:fixed;font-size:12px}.reconcile-scroll th,.reconcile-scroll td{min-width:154px;max-width:154px;width:154px;height:44px;padding:3px 5px;border-right:1px solid #d9e1ec;border-bottom:1px solid #d9e1ec;vertical-align:top;background:white}.reconcile-scroll th{position:sticky;top:0;z-index:2;background:#eaf0f8;text-align:center}.reconcile-scroll th small,.reconcile-scroll td small{display:block}.reconcile-scroll td span,.reconcile-scroll td strong{display:block;text-align:right}.reconcile-scroll td strong{color:#284f75}.reconcile-scroll .needs-review strong{color:#a65a20}.sticky-product{position:sticky!important;left:0;z-index:1;min-width:230px!important;max-width:230px!important;width:230px!important;text-align:left;background:#f2f6fb!important}.reconcile-scroll th.sticky-product{z-index:3}.baseline-reconcile details>summary{margin:5px 7px;cursor:pointer;color:#28587d}`}</style>
  </section>;
}
