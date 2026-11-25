import React,{useEffect,useRef,useState} from 'react';
import {parseAwbFields} from '../../lib/importAwbFields.js';

// Reuse the official local PDF reader. Extracted numbers remain hints until reviewed.
export default function CostAwbEvidence({onApply,label='AWB 원문',initialAwb=''}){
 const [draft,setDraft]=useState({awb:initialAwb,sourceId:'',gw:'',cw:'',freightAmount:''}),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [fileUrl,setFileUrl]=useState('');useEffect(()=>()=>{if(fileUrl)URL.revokeObjectURL(fileUrl);},[fileUrl]);
 const generation=useRef(0);useEffect(()=>()=>{generation.current++;},[]);
 const edit=(key,value)=>{generation.current++;setBusy(false);setDraft(d=>({...d,[key]:value}));setConfirmed(false);};
 async function read(file){const token=++generation.current;setConfirmed(false);setError('');if(!file)return;setFileUrl('');setDraft({awb:initialAwb,sourceId:'',gw:'',cw:'',freightAmount:''});
  if(!/\.pdf$/i.test(file.name)||file.size<=0||file.size>20*1024*1024){setError('20MiB 이하 AWB PDF를 선택하세요. 직접 입력도 가능합니다.');return;}setBusy(true);
  try{const bytes=new Uint8Array(await file.arrayBuffer());if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw Error('올바른 PDF 파일이 아닙니다.');if(token!==generation.current)return;setFileUrl(URL.createObjectURL(file));const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));const {readAwbPdf}=await import('../../lib/importAwbPdf.js');const parsed=parseAwbFields(await readAwbPdf(btoa(text)));if(token!==generation.current)return;
   setDraft(d=>({...d,awb:parsed.awb??'',gw:parsed.gw??'',cw:parsed.cw??'',freightAmount:parsed.total??'',sourceId:`${file.name} · SHA256 ${hash}`}));if(parsed._error)setError('텍스트를 확인하지 못했습니다. 원문을 보고 직접 입력하세요.');
  }catch(e){if(token===generation.current)setError(e.message||'AWB 읽기 실패 · 직접 입력할 수 있습니다.');}finally{if(token===generation.current)setBusy(false);}}
 const ready=/^\d{11}$/.test(draft.awb.replace(/[\s-]/g,''))&&draft.sourceId.trim()&&confirmed&&!busy;
 return <fieldset aria-label={label}><legend>{label} · PDF 업로드 또는 직접 확인</legend><p>파일 없이도 아래 비용 초안을 먼저 입력할 수 있습니다. 원문 AWB 번호·중량·운임과 대상 입고를 대조한 뒤 적용하세요. PDF는 이 브라우저에서만 읽습니다.</p>
 <label>AWB PDF 선택<input aria-label={`${label} PDF 선택`} type="file" accept=".pdf,application/pdf" onChange={e=>{read(e.target.files?.[0]);e.target.value='';}}/></label>{fileUrl&&<a href={fileUrl} target="_blank" rel="noreferrer">원본 AWB 보기</a>}
 {[['awb','AWB 번호'],['sourceId','원문 근거'],['gw','GW kg'],['cw','CW kg'],['freightAmount','운임 합계 USD']].map(([k,t])=><label key={k}>{t}<input aria-label={`${label} ${t}`} value={draft[k]} onChange={e=>edit(k,e.target.value)} inputMode={['gw','cw','freightAmount'].includes(k)?'decimal':undefined}/></label>)}
 <label><input aria-label={`${label} 대조 확인`} type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>원문·선택 입고·AWB 전체 적용 범위를 대조했습니다.</label><button type="button" disabled={!ready} onClick={()=>onApply({...draft,awb:draft.awb.replace(/[\s-]/g,''),confirmed:true})}>확인한 AWB 적용</button>{busy&&<p role="status">AWB 원문 읽는 중…</p>}{error&&<p role="alert">{error}</p>}</fieldset>;
}
