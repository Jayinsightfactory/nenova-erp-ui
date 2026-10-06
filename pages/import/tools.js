import {useState,useMemo,useEffect} from 'react';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import {verifyReqUser} from '../../lib/auth';
import {createImportTeamStorage} from '../../lib/importTeamClient';
const loading=()=> <p role="status">업무도구를 불러오는 중입니다…</p>;
const PackingListTool=dynamic(()=>import('../../components/import-tools/PackingListTool'),{ssr:false,loading});
const PedidosTool=dynamic(()=>import('../../components/import-tools/PedidosTool'),{ssr:false,loading});
const ChecklistTool=dynamic(()=>import('../../components/import-tools/ChecklistTool'),{ssr:false,loading});
const tabs=[['packing','패킹리스트 / Packing List'],['orders','국가별 발주서 / Pedidos'],['checklist','업무 체크리스트 / Checklist'],['history','공동 수정 이력 / Historial']];
function History(){
 const [rows,setRows]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function load(){setBusy(true);setError('');try{const r=await fetch('/api/import/tools/state',{cache:'no-store'}),d=await r.json();if(!r.ok||!d.success)throw Error(d.error||'이력 조회 실패');setRows(d.history);}catch(e){setError(e.message);}finally{setBusy(false);}}
 useEffect(()=>{load();},[]);
 return <section><h2>공동 자료 변경 이력</h2><p>최근 500건 · 수정 시각은 한국 시간입니다.</p><button onClick={load} disabled={busy}>{busy?'조회 중…':'새로고침'}</button>{error&&<p role="alert">{error}</p>}<div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',marginTop:12}}><thead><tr>{['수정 시각','수정자','항목','작업','버전','항목 수 변경'].map(x=><th key={x} style={cell}>{x}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={r.key+'-'+r.revision+'-'+i}><td style={cell}>{new Date(r.at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}</td><td style={cell}>{r.userName} ({r.userId})</td><td style={cell}>{r.key}</td><td style={cell}>{r.action}</td><td style={cell}>{r.revision}</td><td style={cell}>{r.beforeCount} → {r.afterCount}</td></tr>)}</tbody></table>{!busy&&!rows.length&&<p>아직 공동 자료 변경 이력이 없습니다.</p>}</div></section>;
}
const cell={padding:'9px 12px',borderBottom:'1px solid #dbe3ee',textAlign:'left',fontSize:13};
export default function ImportTools(){
 const [tab,setTab]=useState('packing'),[saveError,setSaveError]=useState('');
 const storage=useMemo(()=>createImportTeamStorage(setSaveError),[]);
 return <><Head><title>수입부 업무도구 | Nenova</title></Head><main style={{padding:16,minWidth:0,color:'#172b4d'}}>
  <header style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}><div><h1 style={{fontSize:23,margin:'0 0 6px'}}>수입부 업무도구</h1><p style={{margin:0,fontSize:13,color:'#52647b'}}>Import Team · 파일 변환과 팀 공동 업무 관리 · 주문·분배·재고 자동 등록 없음</p></div><span style={{padding:'6px 10px',background:'#e7f4ec',color:'#176039',borderRadius:6,fontSize:13}}>팀 공동 저장 · 수정자 이력</span></header>
  <nav aria-label="수입부 업무도구" style={{display:'flex',gap:8,flexWrap:'wrap',padding:'16px 0',position:'sticky',top:0,background:'#f7f9fc',zIndex:3}}>{tabs.map(([id,label])=><button key={id} onClick={()=>setTab(id)} aria-pressed={tab===id} style={{padding:'10px 14px',borderRadius:7,border:'1px solid #bdcde2',background:tab===id?'#194da3':'white',color:tab===id?'white':'#17365f',fontWeight:600,fontSize:14}}>{label}</button>)}</nav>
  {saveError&&<div role="alert" style={{padding:12,background:'#fff2db',border:'1px solid #d6a34d',marginBottom:12}}>공동 저장 실패: {saveError} <button onClick={()=>window.location.reload()}>공동 자료 다시 조회</button></div>}
  <div style={{background:'white',border:'1px solid #dbe3ee',borderRadius:10,padding:14,minWidth:0,overflowX:'auto'}}>
   <div hidden={tab!=='packing'}><PackingListTool storage={storage}/></div>
   <div hidden={tab!=='orders'}><PedidosTool/></div>
   <div hidden={tab!=='checklist'}><ChecklistTool/></div>
   {tab==='history'&&<History/>}
  </div>
 </main></>;
}
export function getServerSideProps({req}){const user=verifyReqUser(req);if(!user)return {redirect:{destination:'/login',permanent:false}};return {props:{}};}
