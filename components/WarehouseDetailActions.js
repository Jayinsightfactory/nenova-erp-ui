import { useState } from 'react';
import { Button, Input, Modal, Space } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import { receiptRoundLabel } from '../lib/incomingRoundLabel.js';
import styles from './WarehouseDetailActions.module.css';

const editableFields={BoxQuantity:'박스',BunchQuantity:'단',SteamQuantity:'송이'};
const compareFields={...editableFields,OutQuantity:'출고수량',EstQuantity:'견적수량',TPrice:'입고 합계'};
const display=value=>value==null||value===''?'—':typeof value==='number'?value.toLocaleString('ko-KR',{maximumFractionDigits:8}):value;
const scope=row=>({warehouseKey:row.WarehouseKey,orderYear:row.OrderYear,orderWeek:row.OrderWeek});
async function post(url,payload){
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const result=await response.json();
  if(!response.ok||!result.success)throw new Error(result.error||'입고 변경을 확인하지 못했습니다. 목록을 다시 조회하세요.');
  return result;
}

export function WarehouseRoundCell({row,editable,onSaved}) {
  const [editing,setEditing]=useState(false),[suffix,setSuffix]=useState(''),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const label=receiptRoundLabel(row);
  const previous=row.RoundSuffix??'';
  const close=()=>{if(!saving){setEditing(false);setError('');}};
  if(!editable&&!editing)return <strong title={row.OrderWeek}>{label}</strong>;
  if(!editing)return <button type="button" className={styles.round} aria-label={`차수 표시 수정 · 입고 ${row.WarehouseKey}`}
    title={row.OrderWeek} onClick={event=>{event.stopPropagation();setSuffix(previous);setEditing(true);}}>
    <strong>{label}</strong><EditOutlined />
  </button>;
  async function save(event) {
    event.preventDefault();
    if(saving || suffix===previous)return;
    setSaving(true);setError('');
    try{
      const result=await post('/api/warehouse/detail-actions',{...scope(row),suffix,expectedSuffix:previous});
      onSaved(result);
      setEditing(false);
    }catch(err){setError(err.message);}finally{setSaving(false);}
  }
  return <form className={styles.roundEditor} onClick={event=>event.stopPropagation()} onSubmit={save} onKeyDown={event=>{
    event.stopPropagation();if(event.key==='Escape')close();
  }}>
    <label>차수 표시
      <select autoFocus value={suffix} disabled={saving} onChange={event=>{setSuffix(event.target.value);setError('');}}>
        <option value="">없음</option><option value="A">A</option><option value="B">B</option>
      </select>
    </label>
    <span className={styles.scope}>업무 차수 {row.OrderWeek}</span>
    <Space size={4} wrap><Button size="small" htmlType="submit" loading={saving} disabled={suffix===previous}>저장</Button><Button size="small" onClick={close} disabled={saving}>취소</Button></Space>
    {error&&<p role="alert">{error}</p>}
  </form>;
}

function QuantityChanges({before,after}) {
  return <ul className={styles.changes}>{Object.entries(compareFields).filter(([key])=>before[key]!==after[key]).map(([key,label])=>(
    <li key={key}>{label} {display(before[key])} → <strong>{display(after[key])}</strong></li>
  ))}</ul>;
}

export function WarehouseQuantityDialog({receipt,row,onClose,onSaved}) {
  const [draft,setDraft]=useState(()=>Object.fromEntries(Object.keys(editableFields).map(field=>[field,row[field]??''])));
  const [reason,setReason]=useState(''),[preview,setPreview]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [operationId,setOperationId]=useState(null);
  const changed=Object.keys(editableFields).some(key=>String(draft[key])!==String(row[key]??''));
  const payload=()=>({...scope(receipt),mode:'NATIVE_QUANTITY',detail:{detailKey:row.WdetailKey,
    expected:Object.fromEntries(Object.keys(editableFields).map(key=>[key,row[key]??null])),
    ...Object.fromEntries(Object.keys(editableFields).map(key=>[key,draft[key]===''?null:Number(draft[key])]))}});
  async function check(){
    setBusy(true);setError('');setPreview(null);
    try{
      setPreview(await post('/api/warehouse/correction',{...payload(),action:'preview'}));
      setOperationId(crypto.randomUUID());
    }catch(err){setError(err.message);}finally{setBusy(false);}
  }
  async function save(){
    if(!preview?.canCommit||!reason.trim())return;
    setBusy(true);setError('');
    try{
      await post('/api/warehouse/correction',{...payload(),action:'commit',baselineDigest:preview.baselineDigest,
        operationId,reason,confirmed:true});
      onSaved();
    }catch(err){setError(err.message);}finally{setBusy(false);}
  }
  return <Modal open title="입고 상세 수량 수정" onCancel={busy?undefined:onClose} closable={!busy} maskClosable={!busy} keyboard={!busy}
    footer={<Space wrap>
      <Button onClick={onClose} disabled={busy}>닫기</Button>
      <Button onClick={check} loading={busy} disabled={!changed}>변경 확인</Button>
      <Button type="primary" onClick={save} loading={busy} disabled={!preview?.canCommit||!reason.trim()}>수량 저장</Button>
    </Space>}>
    <p>{row.DisplayName||row.ProdName} · 입고 #{receipt.WarehouseKey}</p>
    <div className={styles.fields}>{Object.entries(editableFields).map(([key,label])=><label key={key}>{label} 수량
      <Input type="number" min={0} max={1e10} step="any" value={draft[key]} disabled={busy} onChange={event=>{
        setDraft({...draft,[key]:event.target.value});setPreview(null);setError('');
      }}/>
    </label>)}</div>
    <label className={styles.reason}>수정 사유<Input value={reason} maxLength={500} disabled={busy} onChange={event=>setReason(event.target.value)}/></label>
    {error&&<p role="alert">{error}</p>}
    {!!preview?.issues?.length&&<div role="alert"><ul className={styles.changes}>{preview.issues.map(issue=><li key={issue.code}>{issue.message}</li>)}</ul></div>}
    {preview?.nativeQuantity&&<div role="status"><strong>저장 전후 비교</strong><QuantityChanges {...preview.nativeQuantity}/></div>}
  </Modal>;
}

const historyDate=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'short'});
export function WarehouseDetailHistory({state}) {
  return <details className={styles.history}>
    <summary>차수·수량 변경 이력{state.rows?.length? ` · ${state.rows.length}건`:''}</summary>
    {state.loading&&<p role="status">이력을 불러오는 중입니다.</p>}
    {state.error&&<p role="alert">{state.error}</p>}
    {!state.loading&&!state.error&&!state.rows?.length&&<p>저장된 변경 이력이 없습니다.</p>}
    {state.rows?.map(entry=><article key={entry.id}>
      <strong>{entry.kind==='WAREHOUSE_ROUND_LABEL'?'차수 표시':entry.product}</strong>
      <div>{entry.actor} · <time dateTime={entry.at}>{historyDate.format(new Date(entry.at))}</time></div>
      {entry.kind==='WAREHOUSE_ROUND_LABEL'?<p>{display(entry.before)} → <strong>{display(entry.after)}</strong></p>:<>
        {entry.reason&&<p>{entry.reason}</p>}
        <QuantityChanges before={entry.before} after={entry.after}/>
      </>}
    </article>)}
  </details>;
}
