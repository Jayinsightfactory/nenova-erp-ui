import {useEffect,useRef,useState} from 'react';
import {installWeekdayDialogKeyboard} from '../lib/weekdayDialogKeyboard.js';

export default function WeekdayPrintPreview({bundle,onClose,returnFocus}) {
  const frame=useRef(null),dialog=useRef(null),entries=useRef(new Map(bundle.noteEntries.map(entry=>[entry.id,{...entry,saved:entry.text}])));
  const queue=useRef(Promise.resolve()),listeners=useRef(()=>{}),mounted=useRef(true);
  const [message,setMessage]=useState('차수 표시·적요를 수정하면 칸을 벗어날 때 저장됩니다. 주광 출력용이며 ERP 원장 차수·적요는 변경하지 않습니다.');
  const [saving,setSaving]=useState(false),[dirty,setDirty]=useState(false),[printing,setPrinting]=useState(false);
  const hasDirty=()=>[...entries.current.values()].some(entry=>entry.text!==entry.saved);
  function close() {
    if(saving)return;
    if(hasDirty()&&!window.confirm('저장하지 못한 적요가 있습니다. 입력을 버리고 닫을까요?'))return;
    onClose();
  }
  const closeRef=useRef(close);closeRef.current=close;
  useEffect(()=>{
    mounted.current=true;
    const uninstall=installWeekdayDialogKeyboard(dialog.current,{onClose:()=>closeRef.current(),returnFocus,initialSelector:'button[data-print-close]',frame:frame.current});
    return ()=>{mounted.current=false;listeners.current();uninstall?.();};
  },[]);
  function saveEntries(ids) {
    const run=async()=>{
      if(mounted.current)setSaving(true);
      try {
        for(const id of ids) {
          const entry=entries.current.get(id);
          while(entry.text!==entry.saved) {
            const text=entry.text;
            const response=await fetch('/api/estimate/weekday-print-note',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
              body:JSON.stringify({scope:entry.scope,rowKey:entry.rowKey,note:text,expectedRevision:entry.revision})});
            const result=await response.json();
            if(!response.ok||!result.success||result.rowKey!==entry.rowKey||result.note?.note!==text||result.note?.revision!==entry.revision+1)throw new Error(result.error||'적요 저장 결과를 확인하지 못했습니다.');
            entry.saved=text;entry.revision=result.note.revision;
          }
        }
        if(mounted.current)setMessage('적요 저장 완료');
        return true;
      }catch(error){if(mounted.current)setMessage(error.message);return false;}
      finally {if(mounted.current){setSaving(false);setDirty(hasDirty());}}
    };
    const next=queue.current.then(run,run);queue.current=next;return next;
  }
  function loaded() {
    listeners.current();
    const doc=frame.current?.contentDocument;if(!doc)return;
    const inputs=[...doc.querySelectorAll('[data-print-note-id]')];
    const resize=el=>{if(el.tagName==='TEXTAREA'){el.style.height='auto';el.style.height=`${el.scrollHeight+2}px`;}};
    const input=e=>{
      const el=e.target,entry=entries.current.get(el.dataset.printNoteId);if(!entry)return;
      entry.text=el.value;const span=el.nextElementSibling;if(span)span.textContent=el.value;
      resize(el);
      setDirty(hasDirty());setMessage('적요 입력 중 · 칸을 벗어나면 저장');
    };
    const blur=e=>{if(entries.current.has(e.target.dataset.printNoteId))void saveEntries([e.target.dataset.printNoteId]);};
    inputs.forEach(el=>{resize(el);el.addEventListener('input',input);el.addEventListener('blur',blur);});
    void doc.fonts?.ready.then(()=>{if(frame.current?.contentDocument===doc)inputs.forEach(resize);});
    listeners.current=()=>inputs.forEach(el=>{el.removeEventListener('input',input);el.removeEventListener('blur',blur);});
  }
  async function print() {
    if(printing)return;setPrinting(true);
    try{if(await saveEntries([...entries.current.keys()])){
      const doc=frame.current?.contentDocument;
      await doc?.fonts?.ready;
      await Promise.all([...doc?.images||[]].filter(img=>img.getAttribute('src')).map(img=>img.decode()));
      frame.current?.contentWindow?.print();
    }}catch{if(mounted.current)setMessage('인쇄 이미지를 불러오지 못했습니다. 미리보기를 다시 열어주세요.');}
    finally{if(mounted.current)setPrinting(false);}
  }
  return <div className="weekday-print-overlay"><section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="요일 견적서 인쇄 미리보기" className="weekday-print-dialog">
    <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}><b style={{flex:1}}>{bundle.label} · {bundle.documentCount}문서 / {bundle.count}행</b>
      <button disabled={printing} onClick={()=>saveEntries([...entries.current.keys()])}>적요 저장</button>
      <button className="primary" disabled={printing} onClick={print}>견적서 출력</button><button data-print-close disabled={saving||printing} onClick={close}>닫기</button></div>
    <div role="status">{saving?'적요 저장 중…':message}</div>
    <div className="muted">{bundle.note} · 미적용 초안 제외 · A4 / 배율 100%</div>
    <iframe ref={frame} title="저장 분배 기준 견적서" srcDoc={bundle.html} onLoad={loaded}/>
  </section></div>;
}
