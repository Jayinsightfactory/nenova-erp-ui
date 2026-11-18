import {useEffect,useRef,useState} from 'react';
import {FARM_COUNTRIES} from '../../lib/packingManifestReconciliation.js';
export default function FarmMasterRegistration({country='',initialName='',onCreated,disabled=false,countries:provided}){
 const [open,setOpen]=useState(false),[name,setName]=useState(initialName),[countries,setCountries]=useState(provided||[]),[key,setKey]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[matches,setMatches]=useState([]);
 const alive=useRef(true),trigger=useRef(null);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{if(!open)setName(initialName);},[initialName,open]);
 useEffect(()=>{if(!open||provided)return;let current=true;fetch('/api/master?entity=codes').then(r=>r.json()).then(d=>{if(!d.success)throw Error(d.error||'국가 조회 실패');if(current)setCountries(d.countries||[]);}).catch(e=>{if(current)setError(e.message);});return()=>{current=false;};},[open,provided]);
 const available=countries.filter(c=>!country||c.CounName===(FARM_COUNTRIES[country]||country));
 const countryKey=key||String(available.length===1?available[0].CounKey:'');
 const close=()=>{if(!busy){setOpen(false);trigger.current?.focus();}};
 const save=async event=>{event.preventDefault();if(busy||disabled)return;setBusy(true);setError('');setMatches([]);try{
  const response=await fetch('/api/master/farms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({farmName:name,counKey:Number(countryKey),confirmed:true})});const data=await response.json();if(!response.ok||!data.success){if(alive.current&&response.status===409)setMatches(data.candidates||[]);throw Error(data.error||'농장 등록 실패');}
  if(!alive.current)return;onCreated?.(data.farm);setOpen(false);setError(data.created?'농장 마스터 등록 완료':'기존 농장을 불러왔습니다.');trigger.current?.focus();
 }catch(e){if(alive.current)setError(e.message);}finally{if(alive.current)setBusy(false);}};
 return <div><button ref={trigger} type="button" className="btn btn-secondary btn-sm" disabled={disabled||busy} onClick={()=>{setOpen(!open);setError('');setMatches([]);}}>DB에 없는 농장 · 마스터 등록</button>
 {open&&<form onSubmit={save} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();close();}}} style={{padding:12,border:'1px solid var(--border)',borderRadius:8,marginTop:8}} aria-label="신규 농장 마스터 등록">
  <p>기존 농장이 없는 경우에만 등록하세요. 이 버튼은 농장 마스터만 추가하며 입고·재고는 등록하지 않습니다.</p>
  <label>등록할 농장명 <input autoFocus className="form-control" value={name} onChange={e=>{setName(e.target.value);setMatches([]);}} maxLength={100} required disabled={busy}/></label>
  <label>국가 <select className="form-control" value={countryKey} onChange={e=>{setKey(e.target.value);setMatches([]);}} required disabled={busy}><option value="">국가 선택</option>{available.map(c=><option key={c.CounKey} value={c.CounKey}>{c.CounName}</option>)}</select></label>
  <button className="btn btn-primary btn-sm" type="submit" disabled={busy||!name.trim()||!countryKey}>{busy?'등록 중…':'확인한 농장을 DB 마스터에 등록'}</button>{' '}<button className="btn btn-secondary btn-sm" type="button" onClick={close} disabled={busy}>취소</button>
  {matches.length>0&&<div role="group" aria-label="이미 등록된 농장 선택" onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;const buttons=[...event.currentTarget.querySelectorAll('button')],index=buttons.indexOf(event.target);if(index<0)return;event.preventDefault();buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:Math.max(0,Math.min(buttons.length-1,index+(event.key==='ArrowRight'?1:-1)))]?.focus();}}>{matches.map(farm=><button type="button" className="btn btn-secondary btn-sm" key={farm.FarmKey} disabled={busy} onClick={()=>{onCreated?.(farm);setOpen(false);setError('기존 농장을 선택했습니다. 새 마스터는 만들지 않았습니다.');trigger.current?.focus();}}>{farm.FarmName} · 기존 농장 선택</button>)}</div>}
 </form>}{error&&<p role="status">{error}</p>}</div>;
}
