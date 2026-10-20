import Head from 'next/head';
import { useEffect, useMemo, useRef, useState } from 'react';
import core from '../../lib/ecountWorkbench.cjs';
import styles from '../../styles/ecount-workbench.module.css';

const { MENUS,TABS,SCHEMAS,getFeature,savePlan,createState,applyDraft,rowsFor,sampleValues,toCsv }=core;
const fmt=v=>v==null?'산정 안 함':typeof v==='number'?v.toLocaleString('ko-KR',{maximumFractionDigits:3}):v;
const leafCount=MENUS.filter(m=>!m.hasChildren).length;
const externalCount=MENUS.filter(m=>!m.hasChildren&&getFeature(m.id).external).length;
const searchKey=value=>String(value).toLowerCase().replace(/[\s/()·_-]/g,'');
const emptyValues=f=>Object.fromEntries(f.schema.fields.map(x=>[x.key,x.type==='select'?x.options[0]:'']));

function download(name,content,type='application/json'){
  const url=URL.createObjectURL(new Blob([content],{type}));
  const a=document.createElement('a');a.href=url;a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function arrowFocus(event){
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
  const buttons=Array.from(event.currentTarget.querySelectorAll('button:not(:disabled)'));
  const index=buttons.indexOf(document.activeElement);if(index<0)return;
  const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(['ArrowLeft','ArrowUp'].includes(event.key)?-1:1)+buttons.length)%buttons.length;
  event.preventDefault();buttons[next]?.focus();
}

export default function EcountWorkbench(){
  const [tab,setTab]=useState('MENUTREE_000004');
  const [menuId,setMenuId]=useState(null);
  const [query,setQuery]=useState('');
  const [externalFilter,setExternalFilter]=useState('all');
  const [page,setPage]=useState(0);
  const [context,setContext]=useState({company:'DEMO-NENOVA',year:2026});
  const [state,setState]=useState(createState);
  const [view,setView]=useState('list');
  const [values,setValues]=useState({});
  const [editing,setEditing]=useState(null);
  const [dirty,setDirty]=useState(false);
  const [plan,setPlan]=useState(null);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [rowQuery,setRowQuery]=useState('');
  const [from,setFrom]=useState('');const [to,setTo]=useState('');
  const [sort,setSort]=useState('date-desc');
  const [cancelTarget,setCancelTarget]=useState(null);const [cancelReason,setCancelReason]=useState('');
  const titleRef=useRef(null);const startRef=useRef(null);
  const feature=useMemo(()=>getFeature(menuId),[menuId]);
  const menuList=useMemo(()=>MENUS.filter(m=>m.depth>1&&(query?searchKey(m.path.join(' ')).includes(searchKey(query)):m.tab===tab)).filter(m=>externalFilter==='all'||(externalFilter==='external'?!!getFeature(m.id).external:!getFeature(m.id).external)),[query,tab,externalFilter]);
  const visibleMenus=menuList.slice(page*30,(page+1)*30);
  const rows=feature?rowsFor(state,feature,context):[];
  const filteredRows=useMemo(()=>rows.filter(r=>(!from||r.values.date>=from)&&(!to||r.values.date<=to)&&Object.values(r.values).join(' ').toLowerCase().includes(rowQuery.toLowerCase())).sort((a,b)=>sort==='name'?String(a.values.name).localeCompare(String(b.values.name),'ko'):String(b.values.date||b.id).localeCompare(String(a.values.date||a.id))),[rows,from,to,rowQuery,sort]);
  const scopedHistory=feature?state.history.filter(h=>h.company===context.company&&h.year===context.year&&h.after.entity===feature.entity):[];
  const activeRows=filteredRows.filter(r=>r.status!=='취소(연습)');
  const resultTotals=feature?Object.fromEntries(feature.schema.results.filter(k=>!k.includes('%')&&!['단위원가','월상각액'].includes(k)).map(k=>[k,activeRows.reduce((sum,r)=>sum+(Number(r.results[k])||0),0)])):{};

  function mayLeave(){return !dirty||window.confirm('아직 적용하지 않은 입력이 있습니다. 입력을 버리고 이동할까요?');}
  function resetEditor(){setEditing(null);setPlan(null);setDirty(false);setCancelTarget(null);setError('');setMessage('');}
  function openMenu(id){if(!mayLeave())return;const m=getFeature(id);if(!m)return;setMenuId(id);setTab(m.tab);setView('list');resetEditor();setValues(emptyValues(m));setFrom('');setTo('');setRowQuery('');window.history.replaceState(null,'',`${window.location.pathname}${window.location.search}#menu=${encodeURIComponent(id)}`);setTimeout(()=>titleRef.current?.focus(),0);}
  function changeTab(id){if(!mayLeave())return;setTab(id);setMenuId(null);setQuery('');setPage(0);resetEditor();window.history.replaceState(null,'',`${window.location.pathname}${window.location.search}`);}
  function startDraft(record=null){if(!mayLeave())return;setEditing(record);setValues(record?{...record.values}:emptyValues(feature));setView('edit');setPlan(null);setDirty(false);setError('');setMessage('');setTimeout(()=>startRef.current?.focus(),0);}
  function perform(type,record,reason){try{setState(applyDraft(state,{type,featureId:feature.id,context,id:record?.id,revision:record?.revision,reason}));setMessage(type==='review'?'메모리에서 검토했습니다. 실제 반영은 없습니다.':'연습 초안을 취소했습니다. 이력은 유지됩니다.');setCancelTarget(null);setError('');}catch(e){setError(e.message);}}
  function prepare(event){event.preventDefault();const next=savePlan(feature,values,context);setPlan(next);setError(next.errors.join('\n'));}
  function commitPreview(){if(!plan||plan.errors.length)return;try{setState(applyDraft(state,{type:'save',featureId:feature.id,context,values:plan.payload,id:editing?.id,revision:editing?.revision}));setDirty(false);setPlan(null);setView('list');setMessage('연습 초안을 이 탭의 메모리에만 보관했습니다. DB에는 반영하지 않았습니다.');setError('');setTimeout(()=>titleRef.current?.focus(),0);}catch(e){setError(e.message);}}
  function exportCatalog(){download('ecount-menu-catalog.csv',toCsv(MENUS.map(m=>{const f=getFeature(m.id);return [m.id,TABS.find(t=>t.id===m.tab)?.label,m.path.join(' > '),m.program,m.hasChildren?'상위/연결 메뉴':'말단 메뉴',f.schema.label,f.external?.label||'내부 기능',f.schema.table,f.implementation];}),['메뉴 ID','탭','경로','프로그램','종류','화면 유형','외부 연동','제안 저장 테이블','상태']),'text/csv;charset=utf-8');}
  function changeContext(next){if(!mayLeave())return;setContext(next);resetEditor();setView('list');if(feature)setValues(emptyValues(feature));}
  useEffect(()=>{const id=new URLSearchParams(window.location.hash.slice(1)).get('menu');const f=getFeature(id);if(f){setMenuId(f.id);setTab(f.tab);setValues(emptyValues(f));}},[]);
  useEffect(()=>{const listener=e=>{if(dirty||state.records.length){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',listener);return()=>window.removeEventListener('beforeunload',listener);},[dirty,state.records.length]);
  useEffect(()=>{const back=e=>{if(!feature)return;e.preventDefault();if(mayLeave()){setMenuId(null);resetEditor();setView('list');}};window.addEventListener('nenova:menu-back-request',back);return()=>window.removeEventListener('nenova:menu-back-request',back);},[feature,dirty]);

  return <div className={styles.page}>
    <Head><title>ECOUNT 전체 메뉴 개발 작업실 | 네노바</title><meta name="robots" content="noindex,nofollow"/></Head>
    <div className={styles.heading}>
      <div><p className={styles.eyebrow}>ECOUNT → NENOVA / 개발 초안</p><h1 data-ui-page-title>전체 메뉴 작업실</h1><p>입력부터 저장 계획까지 검토하세요. 합성 자료만 사용하며 새로고침하면 초안이 사라집니다.</p></div>
      <div className={styles.actions}><button onClick={exportCatalog}>전체 메뉴 CSV</button><button onClick={()=>download('ecount-draft-backup.json',JSON.stringify({mode:'SYNTHETIC_PREVIEW_ONLY',state},null,2))}>연습 초안 다운로드</button></div>
    </div>
    <div className={styles.notice}><strong>실제 DB 입력·수정 없음</strong><span>모든 탭은 화면·저장 설계용입니다. 계좌번호·비밀번호·실제 개인정보를 입력하지 마세요. 외부 API 메뉴도 설계에 포함되어 있습니다.</span></div>
    <div className={styles.stats}><div><b>{TABS.length}</b><span>상위 탭</span></div><div><b>{MENUS.length}</b><span>메뉴 경로</span></div><div><b>{leafCount}</b><span>말단 메뉴</span></div><div><b>{externalCount}</b><span>외부 연동 설계 메뉴</span></div><div><b>{state.records.length}</b><span>메모리 초안</span></div></div>
    <div role="tablist" aria-label="ECOUNT 상위 탭" className={styles.tabs} onKeyDown={arrowFocus}>{TABS.map(t=><button role="tab" aria-selected={tab===t.id} className={tab===t.id?styles.selected:''} key={t.id} onClick={()=>changeTab(t.id)}>{t.label}<span>{MENUS.filter(m=>m.tab===t.id&&m.depth>1).length}</span></button>)}</div>
    <div className={styles.workspace}>
      <aside className={styles.catalog} aria-label="전체 메뉴 목록">
        <h2>탭별 메뉴 목록</h2>
        <label>전체 탭 검색<input value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}} placeholder="메뉴명, 상위 분류 검색"/></label>
        <label>연동 구분<select value={externalFilter} onChange={e=>{setExternalFilter(e.target.value);setPage(0);}}><option value="all">모든 기능</option><option value="internal">내부 기능</option><option value="external">외부 API 설계 포함</option></select></label>
        <p className={styles.muted}>{query?'전체 탭':TABS.find(t=>t.id===tab)?.label} · {menuList.length}개 경로</p>
        <nav className={styles.menuList} onKeyDown={arrowFocus}>{visibleMenus.map(m=>{const f=getFeature(m.id);return <button key={m.id} aria-current={menuId===m.id?'page':undefined} className={menuId===m.id?styles.current:''} onClick={()=>openMenu(m.id)}><span>{m.label}</span><small>{m.path.slice(1,-1).join(' / ')||TABS.find(t=>t.id===m.tab)?.label}</small>{f.external&&<em>외부 연동 설계</em>}{f.mode==='folder'&&<small>하위 메뉴 보기</small>}</button>;})}</nav>
        {!menuList.length&&<p>검색된 메뉴가 없습니다.</p>}
        <div className={styles.pagination}><button disabled={page===0} onClick={()=>setPage(p=>p-1)}>이전</button><span>{page+1} / {Math.max(1,Math.ceil(menuList.length/30))}</span><button disabled={(page+1)*30>=menuList.length} onClick={()=>setPage(p=>p+1)}>다음</button></div>
      </aside>
      <section className={styles.content}>
        {!feature?<><div className={styles.welcome}><span className={styles.tag}>DB 미연결 개발 모드</span><h2>{TABS.find(t=>t.id===tab)?.label}</h2><p>왼쪽에서 메뉴를 선택하면 입력·조회 초안과 저장 계획이 열립니다. 상위 분류도 선택할 수 있습니다.</p><p>모든 메뉴의 기본 화면이 연결되어 있으며, {Object.keys(SCHEMAS).length}개 기능군의 입력 검증과 계산을 공유합니다. 원본의 개별 버튼·상태·권한·보고서 산식은 상세 검증과 후속 구현이 필요합니다.</p></div><div className={styles.groupGrid}>{MENUS.filter(m=>m.tab===tab&&m.depth===2).map(m=><button key={m.id} onClick={()=>openMenu(m.id)}><strong>{m.label}</strong><span>{MENUS.filter(c=>c.parentId===m.id).length}개 하위 메뉴</span></button>)}</div></>:
        <>
          <button onClick={()=>{if(mayLeave()){setMenuId(null);resetEditor();}}}>← 탭 처음으로</button>
          <p className={styles.breadcrumb}>{feature.path.join(' / ')}</p>
          <h2 ref={titleRef} tabIndex={-1}>{feature.label}</h2>
          <div className={styles.badges}><span className={styles.tag}>{feature.schema.label}</span><span className={styles.tag}>{feature.external?'외부 API · 설계만':'내부 기능 · 연습 가능'}</span><span className={styles.muted}>{feature.implementation}</span></div>
          {feature.mode==='folder'?<div className={styles.groupGrid}>{MENUS.filter(m=>m.parentId===feature.id).map(m=><button key={m.id} onClick={()=>openMenu(m.id)}><strong>{m.label}</strong><span>{m.hasChildren?'하위 메뉴':'화면 · 저장 계획'}</span></button>)}</div>:<>
          <div className={styles.scope}><label>합성 회사<select value={context.company} onChange={e=>changeContext({...context,company:e.target.value})}><option>DEMO-NENOVA</option><option>DEMO-OTHER</option></select></label><label>업무 연도<select value={context.year} onChange={e=>changeContext({...context,year:Number(e.target.value)})}>{[2024,2025,2026,2027].map(y=><option key={y}>{y}</option>)}</select></label><p>회사·연도별 초안 분리</p></div>
          <div className={styles.subtabs} role="tablist" aria-label="기능 보기" onKeyDown={arrowFocus}>{[['list','목록·조회'],['edit','입력·수정'],['contract','저장 로직 설계'],['history','변경 이력']].map(([id,label])=><button key={id} role="tab" aria-selected={view===id} className={view===id?styles.selected:''} onClick={()=>{if(id==='edit'){startDraft();return;}if(!mayLeave())return;setDirty(false);setView(id);setPlan(null);setError('');}}>{label}</button>)}</div>
          {error&&<div role="alert" className={styles.error}>{error}</div>}{message&&<div role="status" className={styles.success}>{message}</div>}
          {view==='list'&&<>
            <div className={styles.toolbar}><label>초안 검색<input value={rowQuery} onChange={e=>setRowQuery(e.target.value)} placeholder="합성 대상명 또는 코드"/></label><label>시작일<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>종료일<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label><label>정렬<select value={sort} onChange={e=>setSort(e.target.value)}><option value="date-desc">최근 기준일</option><option value="name">대상명</option></select></label></div>
            <div className={styles.actions}><button className={styles.primary} onClick={()=>startDraft()}>새 연습 초안</button><button onClick={()=>{startDraft();setValues(sampleValues(feature,context.year));setDirty(true);}}>합성 예시로 입력</button><button disabled={!filteredRows.length} onClick={()=>download('ecount-preview-rows.csv',toCsv(filteredRows.map(r=>[r.id,r.status,...feature.schema.fields.map(f=>r.values[f.key]),...feature.schema.results.map(k=>r.results[k])]),['초안 ID','상태',...feature.schema.fields.map(f=>f.label),...feature.schema.results]),'text/csv;charset=utf-8')}>현재 목록 CSV</button></div>
            <p className={styles.muted}>{feature.mode==='report'?'공통 보고서 초안입니다. 원본 보고서 전용 집계·계층·출력 양식은 후속 검증 대상입니다.':'같은 업무의 입력/조회 메뉴는 연습 초안을 공유합니다.'}</p>
            {!!activeRows.length&&<div className={styles.results}>{Object.entries(resultTotals).map(([k,v])=><div key={k}><span>{k} 합계</span><b>{fmt(v)}</b></div>)}</div>}
            <div className={styles.tableWrap}><table><caption>{feature.label} · 합성 초안 {filteredRows.length}건</caption><thead><tr><th>초안</th><th>상태</th>{feature.schema.fields.map(f=><th key={f.key}>{f.label}</th>)}{feature.schema.results.map(k=><th key={k}>{k}</th>)}<th>조작</th></tr></thead><tbody>{filteredRows.map(r=><tr key={r.id}><td>{r.id}<small>v{r.revision}</small></td><td>{r.status}</td>{feature.schema.fields.map(f=><td key={f.key}>{fmt(r.values[f.key])}</td>)}{feature.schema.results.map(k=><td key={k}>{fmt(r.results[k])}</td>)}<td><div className={styles.rowActions}><button disabled={r.status==='취소(연습)'} onClick={()=>startDraft(r)}>수정</button><button disabled={r.status!=='초안'} onClick={()=>perform('review',r)}>검토</button><button disabled={r.status==='취소(연습)'} onClick={()=>{setCancelTarget(r);setCancelReason('');}}>취소</button></div></td></tr>)}</tbody></table></div>
            {!filteredRows.length&&<div className={styles.empty}><h3>아직 연습 초안이 없습니다</h3><p>새 초안을 입력하거나 합성 예시로 화면을 검토하세요. 운영 자료는 불러오지 않습니다.</p></div>}
            {cancelTarget&&<form className={styles.panel} onSubmit={e=>{e.preventDefault();perform('cancel',cancelTarget,cancelReason);}}><h3>{cancelTarget.id} 연습 취소</h3><label>취소 사유<input autoFocus required value={cancelReason} onChange={e=>setCancelReason(e.target.value)}/></label><button type="submit">메모리 초안 취소</button><button type="button" onClick={()=>setCancelTarget(null)}>닫기</button></form>}
          </>}
          {view==='edit'&&<form onSubmit={prepare} onKeyDown={e=>{if(e.key==='Escape'&&mayLeave()){setView('list');setDirty(false);setPlan(null);titleRef.current?.focus();}}}>
            <h3>{editing?`${editing.id} 수정`:'새 연습 초안'} <small>실제 저장 없음</small></h3>
            <div className={styles.formGrid}>{feature.schema.fields.map((f,i)=><label key={f.key}>{f.label}{f.required&&<span aria-hidden="true"> *</span>}{f.type==='select'?<select ref={i===0?startRef:null} value={values[f.key]??''} onChange={e=>{setValues(v=>({...v,[f.key]:e.target.value}));setDirty(true);setPlan(null);}}>{f.options.map(x=><option key={x}>{x}</option>)}</select>:f.type==='textarea'?<textarea ref={i===0?startRef:null} value={values[f.key]??''} maxLength={2000} rows={4} onChange={e=>{setValues(v=>({...v,[f.key]:e.target.value}));setDirty(true);setPlan(null);}}/>:<input ref={i===0?startRef:null} type={f.type} value={values[f.key]??''} min={f.min} max={f.max} step={f.type==='number'?10**(-f.precision):undefined} maxLength={2000} onChange={e=>{setValues(v=>({...v,[f.key]:e.target.value}));setDirty(true);setPlan(null);}}/>}</label>)}</div>
            <div className={styles.formula}><strong>계산·검증 기준</strong><p>{feature.schema.formula}</p></div>
            <div className={styles.actions}><button className={styles.primary} type="submit">검증·저장 계획 보기</button><button type="button" onClick={()=>{if(mayLeave()){setValues(sampleValues(feature,context.year));setDirty(true);setPlan(null);}}}>합성 예시 채우기</button><button type="button" onClick={()=>{if(mayLeave()){setView('list');setDirty(false);setPlan(null);}}}>입력 닫기</button></div>
            {plan&&<div className={styles.panel}><h3>저장 전 검토 · 실행되는 DB 작업 0건</h3><p>{plan.proposedTables.join(' + ')} — 향후 저장 대상 제안</p><div className={styles.results}>{Object.entries(plan.results).map(([k,v])=><div key={k}><span>{k}</span><b>{fmt(v)}</b></div>)}</div><p>{plan.external?'외부 처리는 연동대기 설계로 남습니다.':'검토한 내용은 현재 탭 메모리에만 반영합니다.'}</p><button className={styles.primary} type="button" disabled={!!plan.errors.length} onClick={commitPreview}>메모리에 연습 초안 적용</button><details><summary>필드별 저장 payload</summary><pre>{JSON.stringify(plan,null,2)}</pre></details></div>}
          </form>}
          {view==='contract'&&<div className={styles.contract}><h3>저장 로직 설계</h3><p>서버·DB 연결 코드는 제공하지 않습니다. 아래는 이 메뉴를 실제 기능으로 연결할 때 사용할 계약 초안입니다.</p><dl><dt>제안 저장 대상</dt><dd>{feature.schema.table} + WebErpDraftRevision</dd><dt>업무 식별자</dt><dd>회사 + 연도 + {feature.entity} + 문서 ID + revision</dd><dt>현재 보관</dt><dd>브라우저 메모리만 사용 · 새로고침 시 사라짐</dd><dt>동시 수정</dt><dd>revision 불일치 시 재조회. 검토 후 수정은 초안으로 복귀</dd><dt>취소</dt><dd>초안 보존 + 취소 사유 + 변경 전후 이력</dd><dt>연결 전 필수</dt><dd>원본 필드/상태 검증, 권한, 멱등키, 기간 마감, 스키마 적용, 계약 테스트</dd></dl><h3>필드 계약</h3><div className={styles.tableWrap}><table><thead><tr><th>항목</th><th>저장 키</th><th>형식</th><th>검증</th></tr></thead><tbody>{feature.schema.fields.map(f=><tr key={f.key}><td>{f.label}</td><td>{f.key}</td><td>{f.type}</td><td>{f.required?'필수':'선택'}{f.type==='number'?` · ${f.min} 이상 · 소수 ${f.precision}자리`:''}{f.options?' · '+f.options.join('/'):''}</td></tr>)}</tbody></table></div><h3>처리 순서</h3><ol>{savePlan(feature,sampleValues(feature,context.year),context).transaction.map(t=><li key={t}>{t}</li>)}</ol><p className={styles.formula}>{feature.schema.formula}</p>{feature.external&&<div className={styles.external}><h3>{feature.external.label} 연결 설계</h3><dl><dt>선행 조건</dt><dd>{feature.external.gate}</dd><dt>상태</dt><dd>{feature.external.states.join(' → ')}</dd><dt>멱등키</dt><dd>{feature.external.idempotency}</dd><dt>오류 복구</dt><dd>{feature.external.reconcile}</dd><dt>추가 저장 대상</dt><dd>WebIntegrationOutbox / WebIntegrationStatusEvent</dd></dl><p>수집·발행·서명·이체 실행 없음. 성공 상태를 모의 생성하지 않습니다.</p></div>}<button onClick={()=>download(`storage-design-${feature.program}.json`,JSON.stringify(savePlan(feature,sampleValues(feature,context.year),context),null,2))}>합성 예시 저장 설계 JSON</button></div>}
          {view==='history'&&<div><h3>현재 회사·연도·업무의 연습 이력</h3>{!scopedHistory.length&&<p className={styles.empty}>아직 변경 이력이 없습니다.</p>}{[...scopedHistory].reverse().map(h=><details className={styles.history} key={h.sequence}><summary>#{h.sequence} · {h.id} · {h.action==='save'?'초안 적용':h.action==='review'?'검토':'취소'} · v{h.revision}{h.reason?' · '+h.reason:''}</summary><pre>{JSON.stringify({before:h.before?.values??null,after:h.after.values,status:h.after.status},null,2)}</pre></details>)}</div>}
          </>}
        </>}
      </section>
    </div>
  </div>;
}
