import { useState } from 'react';
import { Button, Input, Modal, Space } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import { receiptRoundLabel } from '../lib/incomingRoundLabel.js';
import { defaultPriceBasis } from '../lib/warehouseCorrectionPolicy.js';
import styles from './WarehouseDetailActions.module.css';

const editableFields={BoxQuantity:'박스',BunchQuantity:'단',SteamQuantity:'송이'};
const compareFields={...editableFields,OutQuantity:'출고수량',EstQuantity:'견적수량',UPrice:'단가',TPrice:'입고 합계',GW:'실중량(GW)',CW:'과금중량(CW)'};
const unitField={박스:'BoxQuantity',단:'BunchQuantity',송이:'SteamQuantity'};
const basisLabel={SteamQuantity:'송이',BunchQuantity:'단',BoxQuantity:'박스'};
const rowPrice=row=>row.UPrice??row['단가']??null;
const rowTotal=row=>row.TPrice??row['총액']??null;
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
  return <ul className={styles.changes}>{Object.entries(compareFields).filter(([key])=>before[key]!==undefined&&before[key]!==after[key]).map(([key,label])=>(
    <li key={key}>{label} {display(before[key])} → <strong>{display(after[key])}</strong></li>
  ))}</ul>;
}

export { defaultPriceBasis };

export function WarehouseQuantityDialog({receipt,row,onClose,onSaved}) {
  const freight=Number(row.ProdKey)===2182;
  const outField=unitField[String(row.OutUnit??row['단위']??'').trim()]||'SteamQuantity';
  const basisOptions=freight?['SteamQuantity']:[...new Set(['SteamQuantity',outField])];
  const [draft,setDraft]=useState(()=>({...Object.fromEntries(Object.keys(editableFields).map(field=>[field,row[field]??''])),UPrice:rowPrice(row)??''}));
  const [priceBasis,setPriceBasis]=useState(()=>defaultPriceBasis(row));
  const [reason,setReason]=useState(''),[preview,setPreview]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [operationId,setOperationId]=useState(null);
  const priceChanged=String(draft.UPrice)!==String(rowPrice(row)??'');
  const changed=Object.keys(editableFields).some(key=>String(draft[key])!==String(row[key]??''))||priceChanged;
  const basisRequired=priceChanged&&!freight&&!priceBasis;
  const payload=()=>({...scope(receipt),mode:'NATIVE_QUANTITY',detail:{detailKey:row.WdetailKey,
    expected:{...Object.fromEntries(Object.keys(editableFields).map(key=>[key,row[key]??null])),...(priceChanged?{UPrice:rowPrice(row)}:{})},
    ...Object.fromEntries(Object.keys(editableFields).map(key=>[key,draft[key]===''?null:Number(draft[key])])),
    ...(priceChanged?{UPrice:draft.UPrice===''?null:Number(draft.UPrice),...(freight?{}:{priceBasis})}:{})}});
  const update=(key,value)=>{setDraft({...draft,[key]:value});setPreview(null);setError('');};
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
  const estimate=priceChanged&&priceBasis&&draft.UPrice!==''&&draft[priceBasis]!==''
    ? Math.round(Number(draft[priceBasis])*Number(draft.UPrice)*1e4)/1e4 : null;
  return <Modal open title={freight?'입고 운송료 단가 수정':'입고 상세 수량·단가 수정'} onCancel={busy?undefined:onClose} closable={!busy} maskClosable={!busy} keyboard={!busy}
    footer={<Space wrap>
      <Button onClick={onClose} disabled={busy}>닫기</Button>
      <Button onClick={check} loading={busy} disabled={!changed||basisRequired}>변경 확인</Button>
      <Button type="primary" onClick={save} loading={busy} disabled={!preview?.canCommit||!reason.trim()}>{freight?'단가 저장':'수량 저장'}</Button>
    </Space>}>
    <p>{row.DisplayName||row.ProdName} · 입고 #{receipt.WarehouseKey}</p>
    <div className={styles.fields}>{Object.entries(editableFields).map(([key,label])=><label key={key}>{label} 수량
      <Input type="number" min={0} max={1e10} step="any" value={draft[key]} disabled={busy||freight} onChange={event=>update(key,event.target.value)}/>
    </label>)}
      <label>{freight?'운송료 단가':'단가'}
        <Input type="number" min={0} max={1e10} step="any" value={draft.UPrice} disabled={busy} onChange={event=>update('UPrice',event.target.value)}/>
      </label>
    </div>
    {priceChanged&&!freight&&<label className={styles.reason}>단가 기준 단위
      <select value={priceBasis} disabled={busy} onChange={event=>{setPriceBasis(event.target.value);setPreview(null);setError('');}}>
        <option value="">기준 선택</option>
        {basisOptions.map(key=><option key={key} value={key}>{basisLabel[key]} 기준{key==='SteamQuantity'?' (nenova.exe 입고 상세 수정과 같음)':''}</option>)}
      </select>
    </label>}
    {priceChanged&&<p role="status" style={{fontVariantNumeric:'tabular-nums'}}>입고 합계 = {freight?'송이':basisLabel[priceBasis]||'기준 미선택'} 수량 × 단가{estimate!=null?` = ${display(estimate)}`:''} · 저장 시 서버에서 다시 계산합니다.</p>}
    <label className={styles.reason}>수정 사유<Input value={reason} maxLength={500} disabled={busy} onChange={event=>setReason(event.target.value)}/></label>
    {error&&<p role="alert">{error}</p>}
    {!!preview?.issues?.length&&<div role="alert"><ul className={styles.changes}>{preview.issues.map(issue=><li key={issue.code}>{issue.message}</li>)}</ul></div>}
    {preview?.nativeQuantity&&<div role="status"><strong>저장 전후 비교</strong><QuantityChanges {...preview.nativeQuantity}/></div>}
  </Modal>;
}

export function WarehouseCostWeightDialog({receipt,costs,onClose,onSaved}) {
  const [gw,setGw]=useState(()=>costs?.gw==null?'':String(costs.gw));
  const [cw,setCw]=useState(()=>costs?.cw==null?'':String(costs.cw));
  const [freight,setFreight]=useState(()=>costs?.freight==null?'':String(costs.freight));
  const [reason,setReason]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const changed=gw!==(costs?.gw==null?'':String(costs.gw))||cw!==(costs?.cw==null?'':String(costs.cw))||freight!==(costs?.freight==null?'':String(costs.freight))
    ||['reference','document','orphan'].includes(costs?.gwSource)||['reference','document','orphan'].includes(costs?.cwSource)
    ||['reference','document'].includes(costs?.freightSource)
    ||(costs?.gw!=null&&receipt?.DetailGrossWeight==null)||(costs?.cw!=null&&receipt?.DetailChargeableWeight==null)
    ||(costs?.freight!=null&&receipt?.DetailFreightAmount==null);
  async function save() {
    if(!reason.trim())return;
    setBusy(true);setError('');
    try{
      await post('/api/warehouse/detail-actions',{
        ...scope(receipt),action:'SAVE_RECEIPT_COSTS',
        gw:gw.trim()===''?null:Number(gw),
        cw:cw.trim()===''?null:Number(cw),
        freight:freight.trim()===''?null:Number(freight),
        reason:reason.trim(),
      });
      onSaved();
    }catch(err){setError(err.message);}finally{setBusy(false);}
  }
  return <Modal open title="입고 운송료·GW·CW 원장 저장/수정" onCancel={busy?undefined:onClose} closable={!busy} maskClosable={!busy} keyboard={!busy}
    footer={<Space wrap>
      <Button onClick={onClose} disabled={busy}>닫기</Button>
      <Button type="primary" onClick={save} loading={busy} disabled={!changed||!reason.trim()}>원장 저장</Button>
    </Space>}>
    <p>{receipt.FarmName||'농장 미기재'} · 인보이스 {receipt.InvoiceNo||'미기재'} · 입고 #{receipt.WarehouseKey}</p>
    <div className={styles.fields} style={{fontVariantNumeric:'tabular-nums'}}>
      <label>운송료 금액{costs?.freightCurrency?` (${costs.freightCurrency})`:''}
        <Input type="number" step="any" value={freight} disabled={busy} placeholder="예: 23168" onChange={e=>{setFreight(e.target.value);setError('');}}/>
      </label>
      <label>GW 실중량 (kg)
        <Input type="number" min={0} step="any" value={gw} disabled={busy} placeholder="예: 1823" onChange={e=>{setGw(e.target.value);setError('');}}/>
      </label>
      <label>CW 과금중량 (kg)
        <Input type="number" min={0} step="any" value={cw} disabled={busy} placeholder="예: 2452" onChange={e=>{setCw(e.target.value);setError('');}}/>
      </label>
    </div>
    <p style={{fontSize:12.5,color:'#475569',marginTop:8}}>저장하면 입고 헤더(GW·CW)와 상세 원장 행(운송료·Gross weight·Chargeable weight)에 함께 기록됩니다. 꽃 품목 재고는 변경하지 않습니다.</p>
    <label className={styles.reason}>저장·수정 사유<Input value={reason} maxLength={500} disabled={busy} placeholder="원본 송장 또는 원가자료 대조 확인" onChange={e=>{setReason(e.target.value);setError('');}}/></label>
    {error&&<p role="alert">{error}</p>}
  </Modal>;
}

export function WarehouseBatchCostWeightDialog({targets=[],onClose,onSaved}) {
  const [reason,setReason]=useState('검증된 웹 송장·원가 원본 운송료·중량 일괄 반영'),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function save() {
    if(!reason.trim()||!targets.length)return;
    setBusy(true);setError('');
    try{
      const result=await post('/api/warehouse/detail-actions',{
        action:'BATCH_SAVE_RECEIPT_COSTS',
        reason:reason.trim(),
        items:targets.map(({row,costs})=>({
          ...scope(row),
          gw:costs.gw??null,
          cw:costs.cw??null,
          freight:costs.freight??null,
        })),
      });
      onSaved(result);
    }catch(err){setError(err.message);}finally{setBusy(false);}
  }
  return <Modal open title={`누락 운송료·GW·CW 원장 일괄 저장 (${targets.length}건)`} onCancel={busy?undefined:onClose} closable={!busy} maskClosable={!busy} keyboard={!busy}
    footer={<Space wrap>
      <Button onClick={onClose} disabled={busy}>닫기</Button>
      <Button type="primary" onClick={save} loading={busy} disabled={!targets.length||!reason.trim()}>원장 일괄 저장</Button>
    </Space>}>
    <p style={{fontSize:13,color:'#334155',marginBottom:8}}>웹 인보이스 원문·원가자료·기존 중량 행에서 확인된 값을 입고 헤더(GW·CW) 및 상세 원장(운송료·Gross weight·Chargeable weight)에 일괄 기록합니다. 꽃 품목 재고는 변경하지 않습니다.</p>
    <div style={{maxHeight:240,overflowY:'auto',border:'1px solid #e2e8f0',borderRadius:6,padding:'6px 8px',marginBottom:8,fontVariantNumeric:'tabular-nums',fontSize:12.5}}>
      {targets.map(({row,costs})=>(
        <div key={row.WarehouseKey} style={{padding:'3px 0',borderBottom:'1px solid #f1f5f9'}}>
          <strong>#{row.WarehouseKey}</strong> · {row.OrderWeek} · {row.FarmName||'미기재'} ({row.InvoiceNo||'미기재'}) — 운송료 {display(costs.freight)}{costs.freightCurrency?` ${costs.freightCurrency}`:''} · GW {display(costs.gw)} · CW {display(costs.cw)}
        </div>
      ))}
    </div>
    <label className={styles.reason}>일괄 저장 사유<Input value={reason} maxLength={500} disabled={busy} onChange={e=>{setReason(e.target.value);setError('');}}/></label>
    {error&&<p role="alert">{error}</p>}
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
