import {useState,useMemo,useEffect} from 'react';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import {verifyReqUser} from '../../lib/auth';
import {createImportTeamStorage} from '../../lib/importTeamClient';
import styles from '../../styles/ImportTools.module.css';
const loading=()=> <p className={styles.loading} role="status">업무도구를 불러오는 중입니다…</p>;
const PackingListTool=dynamic(()=>import('../../components/import-tools/PackingListTool'),{ssr:false,loading});
const PedidosTool=dynamic(()=>import('../../components/import-tools/PedidosTool'),{ssr:false,loading});
const ChecklistTool=dynamic(()=>import('../../components/import-tools/ChecklistTool'),{ssr:false,loading});
const tabs=[['packing','패킹리스트','송장 · 항공운송장 변환'],['orders','국가별 발주서','엑셀 변환 · 다운로드'],['checklist','업무 체크리스트','팀 업무 · 일정 관리'],['history','변경 이력','공동 자료 수정 기록']];
const recordLabels={'packing.catalog':'품목 카탈로그','packing.aliases':'품목 매칭표','checklist.pending':'미결 업무','checklist.flights':'항공 일정','checklist.planting':'재배 계획'};
function recordLabel(key){
 if(recordLabels[key])return recordLabels[key];
 for(const [prefix,label] of [['checklist.day.','일일 업무'],['checklist.month.','월별 결제'],['checklist.vacations.','휴가 관리']])if(key.startsWith(prefix))return `${label} · ${key.slice(prefix.length)}`;
 return key;
}
function History(){
 const [rows,setRows]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function load(){setBusy(true);setError('');try{const r=await fetch('/api/import/tools/state',{cache:'no-store'}),d=await r.json();if(!r.ok||!d.success)throw Error(d.error||'이력 조회 실패');setRows(d.history);}catch(e){setError(e.message);}finally{setBusy(false);}}
 useEffect(()=>{load();},[]);
 return <section aria-label="공동 자료 변경 이력">
  <div className={styles.sectionHeading}><div><h2>공동 자료 변경 이력</h2><p>누가 어떤 자료를 수정했는지 확인하세요. 최근 500건 · 한국 시간 기준</p></div><button onClick={load} disabled={busy}>{busy?'조회 중…':'이력 새로고침'}</button></div>
  {error&&<p className={styles.error} role="alert">{error}</p>}
  <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="변경 이력 표"><table className={styles.historyTable}>
   <colgroup>{[190,180,260,100,90,140].map((width,i)=><col key={i} style={{width}}/>)}</colgroup>
   <thead><tr>{['수정 시각','수정자','변경 항목','작업','저장 버전','항목 수 변경'].map(x=><th key={x} scope="col">{x}</th>)}</tr></thead>
   <tbody>{rows.map((r,i)=><tr key={r.key+'-'+r.revision+'-'+i}><td>{new Date(r.at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}</td><td title={`${r.userName} (${r.userId})`}>{r.userName} <span className={styles.muted}>({r.userId})</span></td><td title={r.key}>{recordLabel(r.key)}</td><td><span className={r.action==='delete'?styles.deleteBadge:styles.saveBadge}>{({delete:'삭제',set:'저장',save:'저장',update:'수정',create:'등록'})[r.action]||r.action}</span></td><td>{r.revision}</td><td>{r.beforeCount} → {r.afterCount}</td></tr>)}</tbody>
  </table>{!busy&&!rows.length&&<div className={styles.empty}>아직 공동 자료 변경 이력이 없습니다.<small>카탈로그나 체크리스트를 저장하면 이곳에 기록됩니다.</small></div>}{busy&&<p role="status" className={styles.loading}>변경 이력을 불러오는 중입니다…</p>}</div>
 </section>;
}
export default function ImportTools(){
 const [tab,setTab]=useState('packing'),[saveError,setSaveError]=useState('');
 const storage=useMemo(()=>createImportTeamStorage(setSaveError),[]);
 return <><Head><title>수입부 업무도구 | Nenova</title></Head><main className={styles.workspace}>
  <header className={styles.header}><div><span className={styles.eyebrow}>수입 업무</span><h1>수입부 업무도구</h1><p>파일 변환부터 일정 확인까지, 한곳에서 처리하세요.</p></div><div className={styles.headerMeta}><span className={styles.saveBadge}>팀 공동 저장 · 수정자 이력</span><small>주문·분배·재고 자동 등록 없음</small></div></header>
  <nav aria-label="수입부 업무도구" className={styles.tabs}>{tabs.map(([id,label,description],index)=><button type="button" key={id} onClick={()=>setTab(id)} aria-pressed={tab===id} aria-controls={`import-panel-${id}`} className={tab===id?styles.activeTab:''}><span className={styles.tabNumber}>{String(index+1).padStart(2,'0')}</span><span><strong>{label}</strong><small>{description}</small></span></button>)}</nav>
  {saveError&&<div role="alert" className={styles.error}>공동 저장 실패: {saveError} <button onClick={()=>window.location.reload()}>공동 자료 다시 조회</button></div>}
  <div className={styles.content}>
   <div id="import-panel-packing" hidden={tab!=='packing'}><PackingListTool storage={storage}/></div>
   <div id="import-panel-orders" hidden={tab!=='orders'}><PedidosTool/></div>
   <div id="import-panel-checklist" hidden={tab!=='checklist'}><ChecklistTool/></div>
   <div id="import-panel-history" hidden={tab!=='history'}>{tab==='history'&&<History/>}</div>
  </div>
 </main></>;
}
export function getServerSideProps({req}){const user=verifyReqUser(req);if(!user)return {redirect:{destination:'/login',permanent:false}};return {props:{}};}
