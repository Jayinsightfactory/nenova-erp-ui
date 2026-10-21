import { useEffect, useRef, useState } from 'react';
import { ObservedButton, actionId, ExcelButton } from './ObservedPageControls';
import styles from '../../styles/ecount-workbench.module.css';

export const QUOTE_COLUMNS = [[null,''],['refDate','일자-No.'],[null,'최초작성일자'],[null,'거래처명'],[null,'품목명(요약)'],['estimateTotal','견적금액합계'],[null,'비고'],['quoteStatus','진행상태'],[null,'생성한전표'],[null,'인쇄']];
const QUOTE_OPTION_ITEMS=['업무설정','검색항목설정','양식설정','조건양식설정','문서발송내역','견적서조회 (OLD)'];
function QuoteOptionMenu({busy}) {
  const [open,setOpen]=useState(false);
  const wrapper=useRef(null),trigger=useRef(null),panel=useRef(null),focusOnOpen=useRef(false);
  useEffect(()=>{
    if(!open)return;
    if(focusOnOpen.current)panel.current?.focus();
    const outside=event=>{if(!wrapper.current?.contains(event.target))setOpen(false);};
    const key=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false);trigger.current?.focus();}};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key,true);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key,true);};
  },[open]);
  return <span ref={wrapper} className={styles.observedDropdown} onMouseEnter={()=>{if(!busy){focusOnOpen.current=false;setOpen(true);}}} onMouseLeave={()=>{if(!wrapper.current?.contains(document.activeElement))setOpen(false);}} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setOpen(false);}}>
    <button ref={trigger} type="button" disabled={busy} aria-haspopup="menu" aria-expanded={open} data-ecount-action-id={actionId('quote','Option')} onClick={()=>{focusOnOpen.current=true;if(open)panel.current?.focus();else setOpen(true);}}>Option</button>
    {open&&<span ref={panel} role="menu" aria-label="Option" tabIndex={-1} className={`${styles.observedPopover} ${styles.quoteOptionPopover}`}>{QUOTE_OPTION_ITEMS.map(label=><span key={label} title="원본 항목의 실행 결과를 아직 확인하지 않았습니다."><button type="button" role="menuitem" disabled data-ecount-action-id={actionId('quote',label,'Option 펼침')}>{label}{label==='양식설정'?' ▸':''}</button></span>)}</span>}
  </span>;
}
export function QuoteToolbar({busy,searchOpen,onSearch,searchRef,status='all',canFilterInProgress=false,canFilterCompleted=false,onStatus}) {
  return <div className={styles.sourceToolbar} aria-label="견적 조회 도구">{!searchOpen&&<div className={styles.quoteStatusTabs} aria-label="진행상태" onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;const controls=[...event.currentTarget.querySelectorAll('button:not(:disabled)')];const index=controls.indexOf(document.activeElement);if(index<0)return;event.preventDefault();controls[event.key==='Home'?0:event.key==='End'?controls.length-1:(index+(event.key==='ArrowLeft'?-1:1)+controls.length)%controls.length]?.focus();}}>{['전체','결재중','미확인','확인','진행중','완료'].map(label=>{
    const value={'전체':'all','진행중':'in_progress','완료':'completed'}[label];
    if(!value)return <ObservedButton key={label} data-ecount-action-id={actionId('quote',label,'견적서조회 상태 탭')} reason="이 상태의 의미와 조회 조건을 아직 확인하지 않았습니다.">{label}</ObservedButton>;
    const available=value==='all'||(value==='in_progress'?canFilterInProgress:canFilterCompleted);
    return <span key={label} title={!available?`${label} 상태의 근거가 있는 자료가 아직 수집되지 않았습니다.`:value==='all'?'현재 작업 영역에 불러온 자료 전체입니다.':'현재 작업 영역에서 상태가 확인된 자료만 조회합니다.'}><button type="button" data-ecount-action-id={actionId('quote',label,'견적서조회 상태 탭')} disabled={busy||!available} aria-pressed={status===value} onClick={()=>onStatus?.(value)}>{label}</button></span>;
  })}</div>}<ObservedButton>Fn</ObservedButton><button ref={searchRef} disabled={busy} aria-expanded={searchOpen} aria-controls="ecount-source-search" data-ecount-action-id={actionId('quote','Search(F3)')} onClick={onSearch}>Search(F3)</button>{searchOpen&&<><QuoteOptionMenu busy={busy}/><ObservedButton>도움말</ObservedButton></>}</div>;
}
function Unavailable({label,children}) {
  return <div className={styles.searchLine} title="수집된 자료로는 이 검색 조건을 적용할 수 없습니다."><span>{label}</span>{children||<input aria-label={label} disabled/>}</div>;
}
export function QuoteSearchPanel({busy,from,to,onFrom,onTo,onSubmit,inputRef}) {
  return <form id="ecount-source-search" className={styles.sourceSearch} onSubmit={event=>{event.preventDefault();onSubmit();}}>
    <div className={styles.searchLine}><span>기준일자</span><input ref={inputRef} type="date" aria-label="조회 시작일" value={from} onChange={event=>onFrom(event.target.value)}/><span>~</span><input type="date" aria-label="조회 종료일" min={from||undefined} value={to} onChange={event=>onTo(event.target.value)}/></div>
    <Unavailable label="내.외자구분"><select aria-label="내.외자구분" disabled>{['전체','내자','외자'].map(label=><option key={label}>{label}</option>)}</select></Unavailable>
    {['창고','거래처','품목'].map(label=><Unavailable key={label} label={label}><input aria-label={label} disabled/><ObservedButton>검색</ObservedButton></Unavailable>)}
    <Unavailable label="발송여부"><select aria-label="발송여부" disabled>{['전체','미발송','발송'].map(label=><option key={label}>{label}</option>)}</select></Unavailable>
    {['견적No.','규격','프로젝트','관리항목','적요1','적요2','적요3','문자형식2','문자형식3','문자형식4','문자형식5','장문형식1','제목'].map(label=><Unavailable key={label} label={label}/>)}
    <Unavailable label="정렬"><label><input type="checkbox" disabled/>수정일자순</label></Unavailable>
    <Unavailable label="견적서"><select aria-label="견적서" data-ecount-action-id={actionId('quote','견적서 드롭다운')} disabled><option>견적서</option></select></Unavailable>
    <div className={styles.sourceToolbar}><button type="submit" data-ecount-action-id={actionId('quote','검색(F8)')} className={styles.primary} disabled={busy||!!(from&&to&&from>to)}>검색(F8)</button></div>
    <div className={styles.datePresets}>{['금일','전일','금주(~오늘)','전주','금월(~오늘)','전월','종료일','최근30일(+1개월)'].map(label=><ObservedButton key={label}>{label}</ObservedButton>)}</div>
  </form>;
}
export function QuoteFooter() {
  return <div className={styles.sourceToolbar} aria-label="견적 결과 도구">
    <ObservedButton>신규(F2)</ObservedButton><ObservedButton>Email</ObservedButton><ObservedButton actionLabel="Email 드롭다운">▾</ObservedButton>
    {['진행상태변경','보내기','인쇄','바코드(품목)','다른전표생성'].map(label=><ObservedButton key={label} actionLabel={`${label} 드롭다운`}>{label} ▾</ObservedButton>)}
    <ObservedButton>전자결재</ObservedButton><ObservedButton>선택삭제</ObservedButton><ExcelButton actionLabel="Excel(표시형식) 드롭다운" mode="label">Excel(표시형식) ▾</ExcelButton><ObservedButton>이력조회</ObservedButton><ObservedButton>웹자료올리기</ObservedButton>
  </div>;
}
