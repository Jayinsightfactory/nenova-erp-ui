import desktopUi from '../../styles/DesktopOrderWorkspace.module.css';
import {useState,useMemo,useEffect} from 'react';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import {verifyReqUser} from '../../lib/auth';
import {createImportTeamStorage} from '../../lib/importTeamClient';
import styles from '../../styles/ImportTools.module.css';
import FeedbackFrame from '../../components/import-tools/FeedbackFrame';
const loading=()=> <p className={styles.loading} role="status">업무도구를 불러오는 중입니다…</p>;
const PackingListTool=dynamic(()=>import('../../components/import-tools/PackingListTool'),{ssr:false,loading});
const InvoiceReceiptWorkbench=dynamic(()=>import('../../components/import-tools/InvoiceReceiptWorkbench'),{ssr:false,loading});
const PedidosTool=dynamic(()=>import('../../components/import-tools/PedidosTool'),{ssr:false,loading});
const ChecklistTool=dynamic(()=>import('../../components/import-tools/ChecklistTool'),{ssr:false,loading});
const HandoffTool=dynamic(()=>import('../../components/import-tools/HandoffTool'),{ssr:false,loading});
const EMPTY_RECEIPT_SOURCE=Object.freeze({excels:Object.freeze([]),invoices:Object.freeze([]),country:'',file:null,products:Object.freeze([]),reviewConfirmed:false,truncated:false});
const tabs=[['packing','패킹리스트','송장 · 항공운송장 변환'],['orders','국가별 발주서','엑셀 변환 · 다운로드'],['checklist','일일 업무','요일 업무 · 미결 · 결제'],['flights','항공 일정','추가 · 수정 · 도착/반입'],['vacations','휴가 관리','잔여 일수 · 계정 이력'],['planting','재배 계획','배정 추가 · 수정 · 삭제'],['feedback','불량 피드백','기존 피드백 · 처리 이력'],['handoff','인수인계·특이사항','이슈 · 처리 · 주의 · 체크'],['history','변경 이력','공동 자료 수정 기록']];
const checklistTabs={checklist:'daily',flights:'flights',vacations:'vacations',planting:'planting'};
const recordLabels={'packing.catalog':'품목 카탈로그','packing.aliases':'품목 매칭표','checklist.pending':'미결 업무','checklist.flights':'항공 일정','checklist.planting':'재배 계획'};
function recordLabel(key){
 if(recordLabels[key])return recordLabels[key];
 if(key==='checklist.handoffs')return '인수인계·특이사항';
 if(key==='checklist.settings.planting')return '재배 품종·목표 설정';
 if(key.startsWith('checklist.settings.employees.'))return '휴가 직원·연간 한도 · '+key.slice('checklist.settings.employees.'.length);
 if(key.startsWith('checklist.templates.'))return '요일별 업무 설정 · '+({lunes:'월요일',martes:'화요일',miercoles:'수요일',jueves:'목요일',viernes:'금요일',sabado:'토요일',domingo:'일요일'})[key.slice('checklist.templates.'.length)];
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
 const [receiptSource,setReceiptSource]=useState(EMPTY_RECEIPT_SOURCE);
 const [feedbackVisited,setFeedbackVisited]=useState(false);
 const [flightCount,setFlightCount]=useState(null);
 function selectTab(id){setTab(id);if(id==='feedback')setFeedbackVisited(true);}
 const storage=useMemo(()=>createImportTeamStorage(setSaveError),[]);
 return <><Head><title>수입부 업무도구 | Nenova</title></Head><main className={`${styles.workspace} ${desktopUi.page}`}>
  <header className={styles.header}><div><span data-desktop-chrome className={styles.eyebrow}>수입 업무</span><h1 data-desktop-chrome>수입부 업무도구</h1><p>파일 변환부터 일정 확인까지, 한곳에서 처리하세요.</p></div><div className={styles.headerMeta}><span className={styles.saveBadge}>팀 공동 저장 · 수정자 이력</span><small>입고 등록은 초안·미리보기·명시 확인 후에만 실행</small></div></header>
  <nav aria-label="수입부 업무도구" className={styles.tabs}>{tabs.map(([id,label,description],index)=><button type="button" key={id} onClick={()=>selectTab(id)} aria-pressed={tab===id} aria-controls={`import-panel-${checklistTabs[id]?'checklist':id}`} className={tab===id?styles.activeTab:''}><span className={styles.tabNumber}>{String(index+1).padStart(2,'0')}</span><span><strong>{label}{id==='flights'&&flightCount>0&&<span className={styles.flightBadge}>반입 대기 {flightCount}</span>}</strong><small>{description}</small></span></button>)}</nav>
  {saveError&&<div role="alert" className={styles.error}>공동 저장 실패: {saveError} <button onClick={()=>window.location.reload()}>공동 자료 다시 조회</button></div>}
  <div className={styles.content}>
   <div id="import-panel-packing" hidden={tab!=='packing'}><PackingListTool storage={storage} onReceiptSourceChange={setReceiptSource}/><InvoiceReceiptWorkbench {...receiptSource}/></div>
   <div id="import-panel-orders" hidden={tab!=='orders'}><PedidosTool/></div>
   <div id="import-panel-checklist" hidden={!checklistTabs[tab]}><ChecklistTool activeTab={checklistTabs[tab]} hideNavigation onFlightCountChange={setFlightCount}/></div>
   <div id="import-panel-feedback" hidden={tab!=='feedback'}>
    <div className={styles.sectionHeading}><div><h2>불량 피드백 관리</h2><p>기존 농장 불량·피드백과 같은 자료입니다. 등록·수정·처리 및 삭제 권한은 기존 화면 기준을 유지합니다.</p></div><a href="/sales/farm-quality?popup=1" target="_blank" rel="noreferrer">큰 창에서 열기 ↗</a></div>
    {feedbackVisited&&<FeedbackFrame className={styles.feedbackFrame}/>}
   </div>
   <div id="import-panel-handoff" hidden={tab!=='handoff'}><HandoffTool/></div>
   <div id="import-panel-history" hidden={tab!=='history'}>{tab==='history'&&<History/>}</div>
  </div>
 </main></>;
}
export function getServerSideProps({req}){const user=verifyReqUser(req);if(!user)return {redirect:{destination:'/login',permanent:false}};return {props:{}};}
