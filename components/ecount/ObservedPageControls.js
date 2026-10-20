import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { EcountWorkspaceDialog } from '../EcountWorkspaceDialog';
import styles from '../../styles/ecount-workbench.module.css';

// Stable report IDs; identifiers are DOM metadata, never visible product labels.
const ACTION_IDS = {
  "cash": {
    "unknown|Search(F3)": "E010205-A01",
    "unknown|Option": "E010205-A02",
    "unknown|도움말": "E010205-A03",
    "unknown|입금보고서작성": "E010205-A04",
    "unknown|즉시조회": "E010205-A05",
    "unknown|통장등록": "E010205-A06",
    "unknown|매핑조회": "E010205-A07",
    "unknown|Excel": "E010205-A08",
    "unknown|자동알림": "E010205-A09",
    "unknown|수집처별확인사항": "E010205-A10",
    "unknown|검색(F8)": "E010205-A11",
    "unknown|설정": "E010205-A12",
    "unknown|다시 작성": "E010205-A13"
  },
  "ar": {
    "unknown|Option": "E040214-A01",
    "unknown|도움말": "E040214-A02",
    "unknown|미수내역": "E040214-A03",
    "unknown|검색(F8)": "E040214-A04",
    "unknown|금일": "E040214-A05",
    "unknown|전일": "E040214-A06",
    "unknown|금주(~오늘)": "E040214-A07",
    "unknown|전주": "E040214-A08",
    "unknown|금월(~오늘)": "E040214-A09",
    "unknown|전월": "E040214-A10",
    "unknown|종료일": "E040214-A11",
    "unknown|다시 작성": "E040214-A12",
    "unknown|인쇄": "E040214-A13",
    "unknown|Excel": "E040214-A14",
    "unknown|Search(F3)": "E040214-A15"
  },
  "ap": {
    "unknown|Option": "E040309-A01",
    "unknown|도움말": "E040309-A02",
    "unknown|검색(F8)": "E040309-A03",
    "unknown|다시 작성": "E040309-A04",
    "unknown|인쇄": "E040309-A05",
    "unknown|Excel": "E040309-A06",
    "unknown|Search(F3)": "E040309-A07"
  },
  "sales": {
    "unknown|검색(F8)": "E040207-A1",
    "unknown|Search(F3)": "E040207-A2",
    "unknown|Option": "E040207-A3",
    "unknown|도움말": "E040207-A4",
    "unknown|인쇄": "E040207-A5",
    "unknown|Excel(화면)": "E040207-A6",
    "unknown|금주(~오늘)": "E040207-A07",
    "unknown|Fn": "E040207-A08",
    "unknown|인쇄 드롭다운": "E040207-A09",
    "unknown|Excel(화면) 드롭다운": "E040207-A10",
    "unknown|Email": "E040207-A11",
    "unknown|전주": "E040207-A12",
    "검색폼|거래처 검색 아이콘": "E040207-A13",
    "거래처 조회 오버레이|사용중단포함": "E040207-A14",
    "거래처 조회 오버레이|Fn": "E040207-A15",
    "거래처 조회 오버레이|Search(F3)": "E040207-A16",
    "거래처 조회 오버레이|Option": "E040207-A17",
    "거래처 조회 오버레이|적용(F8)": "E040207-A18",
    "거래처 조회 오버레이|신규(F2)": "E040207-A19",
    "거래처 조회 오버레이|닫기": "E040207-A20",
    "unknown|미리보기": "E040207-A21",
    "unknown|Excel(데이터)": "E040207-A22",
    "unknown|PDF": "E040207-A23",
    "unknown|프린트문제해결": "E040207-A24",
    "unknown|Excel(표시형식)": "E040207-A25"
  },
  "quote": {
    "unknown|Fn": "E040202-A01",
    "unknown|Search(F3)": "E040202-A02",
    "unknown|이름없는 드롭다운": "E040202-A03",
    "unknown|신규(F2)": "E040202-A04",
    "unknown|Email": "E040202-A05",
    "unknown|Email 드롭다운": "E040202-A06",
    "unknown|진행상태변경 드롭다운": "E040202-A07",
    "unknown|보내기 드롭다운": "E040202-A08",
    "unknown|인쇄 드롭다운": "E040202-A09",
    "unknown|바코드(품목) 드롭다운": "E040202-A10",
    "unknown|다른전표생성 드롭다운": "E040202-A11",
    "unknown|전자결재": "E040202-A12",
    "unknown|선택삭제": "E040202-A13",
    "unknown|Excel(표시형식) 드롭다운": "E040202-A14",
    "unknown|이력조회": "E040202-A15",
    "unknown|웹자료올리기": "E040202-A16",
    "unknown|Option": "E040202-A17",
    "unknown|도움말": "E040202-A18",
    "unknown|검색(F8)": "E040202-A19",
    "unknown|견적서 드롭다운": "E040202-A20",
    "unknown|금일": "E040202-A21",
    "unknown|전일": "E040202-A22",
    "unknown|금주(~오늘)": "E040202-A23",
    "unknown|전주": "E040202-A24",
    "unknown|금월(~오늘)": "E040202-A25",
    "unknown|전월": "E040202-A26",
    "unknown|종료일": "E040202-A27",
    "unknown|최근30일(+1개월)": "E040202-A28",
    "Option 펼침|업무설정": "E040202-A29",
    "Option 펼침|검색항목설정": "E040202-A30",
    "Option 펼침|양식설정": "E040202-A31",
    "Option 펼침|조건양식설정": "E040202-A32",
    "Option 펼침|문서발송내역": "E040202-A33",
    "Option 펼침|견적서조회 (OLD)": "E040202-A34",
    "견적서조회 상태 탭|전체": "E040202-A35",
    "견적서조회 상태 탭|결재중": "E040202-A36",
    "견적서조회 상태 탭|미확인": "E040202-A37",
    "견적서조회 상태 탭|확인": "E040202-A38",
    "견적서조회 상태 탭|진행중": "E040202-A39",
    "견적서조회 상태 탭|완료": "E040202-A40"
  }
};
const ActionContext=createContext({dataset:null,context:'unknown'});
export function ActionScope({dataset,context='unknown',children}) {return <ActionContext.Provider value={{dataset,context}}>{children}</ActionContext.Provider>;}
export function actionId(dataset,label,context='unknown'){return ACTION_IDS[dataset]?.[context+'|'+label];}
const pending = '원본 동작 확인 및 구현 전입니다.';
export function ObservedButton({ children, reason = pending, actionLabel, 'data-ecount-action-id': explicitId }) {
  const {dataset,context}=useContext(ActionContext);
  const stableId=explicitId||actionId(dataset,actionLabel||children,context);
  return <span title={reason}><button data-ecount-action-id={stableId} disabled>{children}</button></span>;
}
export function ResultToolbar({ busy, searchOpen, onSearch, searchRef, dataset }) {
  return <div className={styles.sourceToolbar} aria-label="조회 도구">{dataset==='sales'&&<ObservedButton>Fn</ObservedButton>}<button data-ecount-action-id={actionId(dataset,'Search(F3)')} ref={searchRef} disabled={busy} aria-expanded={searchOpen} aria-controls="ecount-source-search" onClick={onSearch}>Search(F3)</button><ObservedButton>Option</ObservedButton><ObservedButton>도움말</ObservedButton></div>;
}
function ObservedDropdown({ label, items, busy, onPreview }) {
  const {dataset}=useContext(ActionContext);
  const [open,setOpen]=useState(false);
  const wrapper=useRef(null),trigger=useRef(null),menu=useRef(null);
  useEffect(()=>{
    if(!open)return;
    (menu.current?.querySelector('button:not(:disabled)')||menu.current)?.focus();
    const outside=event=>{if(!wrapper.current?.contains(event.target))setOpen(false);};
    const key=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false);trigger.current?.focus();}};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key,true);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key,true);};
  },[open]);
  return <span ref={wrapper} className={styles.observedDropdown} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setOpen(false);}}>
    <button type="button" ref={trigger} disabled={busy} data-ecount-action-id={actionId(dataset,label)} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>▾</button>
    {open&&<span ref={menu} role="menu" aria-label={label} tabIndex={-1} className={styles.observedPopover} onKeyDown={event=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;const buttons=[...event.currentTarget.querySelectorAll('button:not(:disabled)')];if(!buttons.length)return;const index=buttons.indexOf(document.activeElement);const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowUp'?-1:1)+buttons.length)%buttons.length;event.preventDefault();buttons[next]?.focus();}}>{items.map(item=><span key={item} title={item==='미리보기'&&onPreview?undefined:pending}><button type="button" role="menuitem" disabled={!(item==='미리보기'&&onPreview)} data-ecount-action-id={actionId(dataset,item)} onClick={()=>{setOpen(false);trigger.current?.focus();onPreview?.();}}>{item}</button></span>)}</span>}
  </span>;
}
export function ResultFooter({ dataset, busy, onMapping, onPreview }) {
  return <div className={styles.sourceToolbar} aria-label="결과 도구">{dataset==='cash' ? <>
    <ObservedButton reason="입금보고서 저장 기능은 아직 구현되지 않았습니다.">입금보고서작성</ObservedButton>
    <ObservedButton reason="외부 금융 조회 연동이 필요합니다.">즉시조회</ObservedButton>
    <ObservedButton reason="계좌 등록 기능은 아직 구현되지 않았습니다.">통장등록</ObservedButton>
    <button data-ecount-action-id={actionId(dataset,'매핑조회')} disabled={busy} onClick={onMapping}>매핑조회</button><ObservedButton>Excel</ObservedButton><ObservedButton>자동알림</ObservedButton><ObservedButton>수집처별확인사항</ObservedButton>
  </> : <><ObservedButton>인쇄</ObservedButton>{dataset==='sales'&&<ObservedDropdown busy={busy} onPreview={onPreview} label="인쇄 드롭다운" items={['PDF','미리보기','프린트문제해결']}/>}<ObservedButton>{dataset==='sales'?'Excel(화면)':'Excel'}</ObservedButton>{dataset==='sales'&&<><ObservedDropdown busy={busy} label="Excel(화면) 드롭다운" items={['Excel(표시형식)','Excel(데이터)']}/><ObservedButton>Email</ObservedButton></>}</>}</div>;
}
export function MappingOverlay({ onClose }) {
  const columns=['','입금처(출금처)','계좌번호','지점명','매핑여부','거래처코드','거래처명'];
  return <ActionScope dataset="cash" context="매핑조회 오버레이"><EcountWorkspaceDialog title="매핑조회" onClose={onClose} busy={false}>
    <div className={styles.sourceToolbar}><ObservedButton>Search(F3)</ObservedButton><ObservedButton>Option</ObservedButton></div>
    <div className={styles.tableWrap}><table><thead><tr>{columns.map((label,index)=><th key={index} scope="col">{label}</th>)}</tr></thead><tbody><tr><td colSpan={columns.length} className={styles.empty}>매핑 자료가 아직 수집되지 않았습니다.</td></tr></tbody></table></div>
    <footer><ObservedButton>Excel</ObservedButton><button onClick={onClose}>닫기</button></footer>
  </EcountWorkspaceDialog></ActionScope>;
}
export function CustomerLookupOverlay({ onClose }) {
  const columns=['','거래처코드','거래처명','검색창내용','상세내역'];
  return <ActionScope dataset="sales" context="거래처 조회 오버레이"><EcountWorkspaceDialog title="거래처 검색" onClose={onClose} busy={false}>
    <div className={styles.sourceToolbar}><ObservedButton>사용중단포함</ObservedButton><input aria-label="거래처 검색어" placeholder="입력 후 [Enter]" disabled title="거래처 자료가 아직 수집되지 않았습니다."/></div>
    <div className={styles.sourceToolbar}><ObservedButton>Fn</ObservedButton><ObservedButton>Search(F3)</ObservedButton><ObservedButton>Option</ObservedButton></div>
    <div className={styles.tableWrap}><table><thead><tr>{columns.map((label,index)=><th key={index} scope="col">{label}</th>)}</tr></thead><tbody><tr><td colSpan={columns.length} className={styles.empty}>거래처 선택 자료가 아직 수집되지 않았습니다.</td></tr></tbody></table></div>
    <footer><ObservedButton>적용(F8)</ObservedButton><ObservedButton>신규(F2)</ObservedButton><button data-ecount-action-id={actionId('sales','닫기','거래처 조회 오버레이')} onClick={onClose}>닫기</button></footer>
  </EcountWorkspaceDialog></ActionScope>;
}
function UnavailableField({ label, children }) {
  return <div className={styles.searchLine} title="수집된 자료로는 이 검색 조건을 적용할 수 없습니다."><span>{label}</span>{children||<input aria-label={label} disabled/>}</div>;
}
export function SearchPanel({ dataset, busy, from, to, flow, query, onFrom, onTo, onFlow, onQuery, onSubmit, onPreset, onCustomer, inputRef }) {
  return <form id="ecount-source-search" className={styles.sourceSearch} onSubmit={event=>{event.preventDefault();onSubmit();}}>
    {dataset==='sales'&&<>
      <UnavailableField label="구분"><label><input type="radio" checked readOnly disabled/>현황</label><label><input type="radio" checked={false} readOnly disabled/>집계</label><select aria-label="라인별" disabled><option>라인별</option></select></UnavailableField>
      <UnavailableField label="기간비교"><select aria-label="기간비교" disabled>{['사용안함','전년동일기간','전월','전주','전일'].map(value=><option key={value}>{value}</option>)}</select></UnavailableField>
    </>}
    {['cash','sales'].includes(dataset)&&<div className={styles.searchLine}><span>조회기간</span><input ref={inputRef} type="date" aria-label="조회 시작일" value={from} onChange={event=>onFrom(event.target.value)} /><span>~</span><input type="date" aria-label="조회 종료일" min={from||undefined} value={to} onChange={event=>onTo(event.target.value)} /></div>}
    {dataset==='sales'&&<div className={styles.datePresets}><button data-ecount-action-id={actionId(dataset,'금주(~오늘)')} type="button" disabled={busy} onClick={()=>onPreset('thisWeek')}>금주(~오늘)</button><button data-ecount-action-id={actionId(dataset,'전주')} type="button" disabled={busy} onClick={()=>onPreset('previousWeek')}>전주</button></div>}
    {dataset==='cash'&&<div className={styles.searchLine}><span>구분</span>{['','입금','출금'].map(value=><label key={value}><input type="radio" name="cash-flow" checked={flow===value} onChange={()=>onFlow(value)} />{value||'전체'}</label>)}</div>}
    {dataset==='sales'&&<>
      <UnavailableField label="거래유형"><input aria-label="거래유형" disabled/><ObservedButton>검색</ObservedButton></UnavailableField>
      <UnavailableField label="내자외자"><select aria-label="내자외자" disabled>{['전체','내자','외자'].map(value=><option key={value}>{value}</option>)}</select></UnavailableField>
      <div className={styles.searchLine}><span>거래처</span><input aria-label="거래처" disabled/><button data-ecount-action-id={actionId(dataset,'거래처 검색 아이콘','검색폼')} type="button" disabled={busy} onClick={onCustomer} aria-label="거래처 검색">검색</button></div>
      <UnavailableField label="품목"><input aria-label="품목" disabled/><ObservedButton>검색</ObservedButton></UnavailableField>
      <UnavailableField label="일반/반품"><select aria-label="일반/반품" disabled><option>전체</option><option>일반</option><option>반품</option></select></UnavailableField>
      <UnavailableField label="거래처관리담당자"><input aria-label="거래처관리담당자" disabled/><ObservedButton>검색</ObservedButton></UnavailableField>
      <UnavailableField label="프로젝트"><input aria-label="프로젝트" disabled/><ObservedButton>검색</ObservedButton></UnavailableField>
      <UnavailableField label="제목"/>
      <UnavailableField label="추가수량"><input type="number" aria-label="추가수량 최소" disabled/><span>~</span><input type="number" aria-label="추가수량 최대" disabled/></UnavailableField>
      <UnavailableField label="판매현황"><select aria-label="판매현황" disabled><option>판매현황</option></select><ObservedButton>정렬기준설정</ObservedButton><ObservedButton>그래프로보기</ObservedButton></UnavailableField>
    </>}
    {dataset!=='sales'&&<div className={styles.searchLine}><label>검색 <input ref={['cash','sales'].includes(dataset)?undefined:inputRef} value={query} onChange={event=>onQuery(event.target.value)} /></label></div>}
    {dataset==='cash'&&<div className={styles.datePresets}>{['금일','전일','금주(~오늘)','전주','금월(~오늘)','전월','종료일','최근7일','전월+금월'].map(label=><ObservedButton key={label}>{label}</ObservedButton>)}</div>}
    <div className={styles.sourceToolbar}><button data-ecount-action-id={actionId(dataset,'검색(F8)')} type="submit" className={styles.primary} disabled={busy||!!(from&&to&&from>to)}>검색(F8)</button>{dataset==='cash'&&<><ObservedButton>설정</ObservedButton><ObservedButton>다시 작성</ObservedButton></>}</div>
  </form>;
}
