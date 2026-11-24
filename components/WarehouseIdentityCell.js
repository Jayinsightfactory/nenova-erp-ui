import { useEffect, useRef, useState } from 'react';
import { EditOutlined } from '@ant-design/icons';
import { Button, Input } from 'antd';
import { invoiceReceiptCostHref } from '../lib/invoiceReceiptCostRoute.js';
import styles from './WarehouseIdentityCell.module.css';

export default function WarehouseIdentityCell({ row, field, editing, disabled, onOpen, onClose, onSaved }) {
  const label=field==='invoiceNo'?'인보이스':'AWB';
  const shown=field==='invoiceNo'?row.InvoiceNo:row.AWB;
  const key=row.WarehouseKey;
  const year=row.OrderYear;
  const week=row.OrderWeek;
  const [draft,setDraft]=useState('');
  const [before,setBefore]=useState(null);
  const [issues,setIssues]=useState(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);
  const [saving,setSaving]=useState(false);
  const busy=useRef(false);
  const trigger=useRef(null);
  const notices=useRef(null);

  useEffect(()=>{
    if(!editing)return;
    const controller=new AbortController();
    setLoading(true);setIssues(null);setBefore(null);setError('');
    const scope=new URLSearchParams({warehouseKey:key,orderYear:year,orderWeek:week,field});
    fetch('/api/warehouse/identity?'+scope,{signal:controller.signal})
      .then(async response=>{
        const data=await response.json();
        if(!response.ok||!data.success)throw new Error(data.error||'입고 번호 조회에 실패했습니다.');
        if(controller.signal.aborted)return;
        setBefore(data.header);
        setDraft((field==='invoiceNo'?data.header.InvoiceNo:data.header.OrderNo)??'');
        setIssues(data.issues??[]);
      })
      .catch(reason=>{if(!controller.signal.aborted)setError(reason.message);})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[editing,key,year,week,field]);

  useEffect(()=>{if(editing&&!loading&&(error||issues?.length))notices.current?.focus();},[editing,loading,error,issues]);

  function close(){
    if(busy.current)return;
    onClose();
    requestAnimationFrame(()=>trigger.current?.focus());
  }

  async function save(event){
    event.preventDefault();
    if(busy.current||!before||issues?.length||!draft.trim())return;
    busy.current=true;setSaving(true);setError('');
    try {
      const response=await fetch('/api/warehouse/identity',{
        method:'PATCH',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({warehouseKey:key,orderYear:year,orderWeek:week,field,value:draft,
          expectedInvoiceNo:before.InvoiceNo,expectedAwb:before.OrderNo}),
      });
      const data=await response.json();
      if(!response.ok||!data.success){
        if(data.issues?.length)setIssues(data.issues);
        else setError(data.error||'입고 번호 저장에 실패했습니다.');
        return;
      }
      onSaved(data.header,label);
      onClose();
      requestAnimationFrame(()=>trigger.current?.focus());
    }catch{
      setError('저장 결과를 확인하지 못했습니다. 원장을 다시 조회하세요.');
    }finally{busy.current=false;setSaving(false);}
  }

  if(!editing)return <button type="button" ref={trigger} className={styles.trigger} title={shown??''} disabled={disabled}
    aria-label={`${label} 수정 · 입고 ${key}`} onClick={event=>{event.stopPropagation();onOpen();}}><span>{shown||'—'}</span><EditOutlined /></button>;

  const linkedDocument=issues?.some(issue=>issue.code==='DOCUMENT');
  const costHref=invoiceReceiptCostHref({warehouseKey:key,orderYear:year,orderWeek:week});
  return <div className={styles.editor} onClick={event=>event.stopPropagation()} onKeyDown={event=>{
    event.stopPropagation();
    if(event.key==='Escape'){event.preventDefault();close();}
  }}>
    {loading && <span role="status">연결 확인 중…</span>}
    {error && <p className={styles.issue} role="alert" tabIndex={-1} ref={notices}>{error}</p>}
    {!!issues?.length && <div className={styles.issue} tabIndex={-1} ref={notices}>
      <p role="alert">{issues.map(issue=>issue.message).join(' ')}</p>
      {linkedDocument ? <a href="/import/tools?tab=packing">입고 작업에서 저장 문서 확인</a>
        : costHref && issues.some(issue=>['COST','DECLARATION','PROFIT','FORWARDER','SHARED_AWB'].includes(issue.code))
          ? <a href={costHref}>연결 원가 확인</a> : null}
    </div>}
    {!loading && before && !issues?.length ? <form onSubmit={save}>
      <Input size="small" aria-label={label+' 새 번호'} maxLength={50} value={draft} autoFocus disabled={saving}
        onChange={event=>setDraft(event.target.value)}/>
      <div className={styles.actions}>
        <Button size="small" htmlType="submit" type="primary" loading={saving} disabled={!draft.trim()}>저장</Button>
        <Button size="small" onClick={close} disabled={saving}>취소</Button>
      </div>
    </form> : <Button size="small" onClick={close} disabled={saving}>닫기</Button>}
  </div>;
}
