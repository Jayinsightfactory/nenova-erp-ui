import { useEffect, useRef, useState } from 'react';
import { ActionScope, ObservedButton } from './ObservedPageControls';
import pageActions from '../../lib/ecountPageActions.cjs';
import styles from '../../styles/ecount-workbench.module.css';

// 2026-10-21 P008~P019 조사 기반 범용 셸. lib/ecountSurveyScreens.cjs 가 만든 정의(화면 종류·도구줄·검색 패널·입력칸)를 그대로 그린다.
// 원본 동작을 확인하지 않은 버튼은 전부 ObservedButton 자리표시이고, data-ecount-action-id 는 button-matches 의 matchId 그대로다.
// 활성 동작은 Search(F3) 토글, 관측된 기간 프리셋(날짜만 변경), 다시 작성(초기화), 검색(F8)=미수집 안내뿐이며 ECOUNT 원본·ERP 원장 쓰기는 없다.
export const UNCOLLECTED_MESSAGE='작업 자료가 아직 수집되지 않았습니다.';
export const PRESET_MESSAGE='기간 프리셋으로 날짜만 바꿨습니다. 작업 자료가 아직 수집되지 않아 조회는 실행되지 않습니다.';
export const SAVE_PENDING_REASON='원본 저장 계약 확정 전입니다.';
const UNVERIFIED_PRESET_REASON='원본 조사에서 프리셋 동작이 확인되지 않았습니다.';
const EMPTY_DRAFT=Object.freeze({from:'',to:''});
export function todayInSeoul(now=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const part=type=>parts.find(value=>value.type===type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
// 프리셋 → 검색 초안. range 화면은 from~to, single(기준일자) 화면은 관측대로 종료일 하나만 쓴다(단일 기준일/영업주기 화면 모두 range.to).
// 순수 함수라 테스트가 직접 호출한다. 오류 코드는 pageActions 의 것을 그대로 던진다.
export function presetDraft({screen,label,draft=EMPTY_DRAFT,today}){
  const preset=screen.searchPanel.presets.find(item=>item.label===label);
  if(!preset||!preset.enabled)throw new Error('PRESET_NOT_ENABLED');
  const id=pageActions.presetIdForLabel(label);
  const range=pageActions.datePreset(id,today,{weekStartsOn:0,currentTo:draft.to||null});
  if(screen.searchPanel.dateMode==='single')return {...draft,from:range.to,to:range.to};
  return {...draft,...range};
}
const INPUT_TYPES={checkbox:'checkbox',radio:'radio',number:'number',date:'date',email:'text',tel:'text',password:'text'};
function ReadOnlyField({field,index}){
  const id=`ecount-survey-field-${index}`;
  const control=field.type==='select'?<select id={id} disabled aria-label={field.label}><option>{''}</option></select>:field.type==='textarea'?<textarea id={id} readOnly disabled aria-label={field.label} rows={2}/>:<input id={id} type={INPUT_TYPES[field.type]||'text'} readOnly disabled aria-label={field.label}/>;
  return <label className={styles.field} htmlFor={id}>{field.label}{field.required?<span aria-label="필수"> *</span>:null} {control}</label>;
}
function placeholder(button,extra){
  return <ObservedButton key={button.id} data-ecount-action-id={button.id} reason={button.reason||extra}>{button.label}</ObservedButton>;
}
export function SurveyScreen({screen,busy=false,defaultSearchOpen}){
  const toggle=!!screen.searchToggleId;
  const panel=screen.searchPanel;
  const hasPanel=!!(panel.searchId||panel.resetId||panel.presets.length||panel.formButtons.length||panel.dateMode!=='none');
  const [searchOpen,setSearchOpen]=useState(defaultSearchOpen==null?!toggle:!!defaultSearchOpen);
  const [draft,setDraft]=useState(EMPTY_DRAFT);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const toggleRef=useRef(null),firstInputRef=useRef(null);
  const visible=hasPanel&&(!toggle||searchOpen);
  function openSearch(next){
    if(busy||!toggle)return;
    setSearchOpen(next);
    if(next)setTimeout(()=>firstInputRef.current?.focus(),0);else setTimeout(()=>toggleRef.current?.focus(),0);
  }
  function notice(){if(busy)return;setError('');setMessage(UNCOLLECTED_MESSAGE);}
  function reset(){if(busy)return;setDraft(pageActions.resetSearch(EMPTY_DRAFT));setError('');setMessage('');}
  function applyPreset(label){
    if(busy)return;
    try{setDraft(presetDraft({screen,label,draft,today:todayInSeoul()}));setError('');setMessage(PRESET_MESSAGE);}
    catch(e){setError(e.message==='CURRENT_END_REQUIRED'?'종료일을 먼저 지정해 주세요.':'조회 날짜를 확인해 주세요.');}
  }
  useEffect(()=>{
    const key=event=>{
      if(busy||event.altKey||event.ctrlKey||event.metaKey)return;
      const action=pageActions.keyboardAction(event);
      if(action==='open-search'&&toggle){event.preventDefault();openSearch(!searchOpen);}
      else if(action==='run-search'&&visible&&panel.searchId){event.preventDefault();notice();}
      else if(event.key==='Escape'&&toggle&&searchOpen){event.preventDefault();openSearch(false);}
    };
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[busy,toggle,searchOpen,visible,panel.searchId]); // eslint-disable-line react-hooks/exhaustive-deps
  const invalidRange=panel.dateMode==='range'&&!!(draft.from&&draft.to&&draft.from>draft.to);
  return <ActionScope dataset={screen.program}><div data-ecount-survey-screen={screen.program} data-ecount-screen-kind={screen.kind}>
    {screen.toolbar.length>0&&<div className={styles.sourceToolbar} aria-label="조회 도구">{screen.toolbar.map(button=>button.role==='toggle'
      ?<button key={button.id} type="button" ref={toggleRef} data-ecount-action-id={button.id} disabled={busy} aria-expanded={searchOpen} aria-controls="ecount-survey-search" onClick={()=>openSearch(!searchOpen)}>{button.label}</button>
      :placeholder(button))}</div>}
    {visible&&<form id="ecount-survey-search" className={styles.sourceSearch} aria-label="검색 조건" onSubmit={event=>{event.preventDefault();notice();}}>
      {panel.dateMode!=='none'&&<div className={styles.searchLine}><span>{panel.dateLabel}</span>
        {panel.dateMode==='range'
          ?<><input ref={firstInputRef} type="date" aria-label="조회 시작일" value={draft.from} disabled={busy} onChange={event=>setDraft(value=>({...value,from:event.target.value}))}/><span>~</span><input type="date" aria-label="조회 종료일" min={draft.from||undefined} value={draft.to} disabled={busy} onChange={event=>setDraft(value=>({...value,to:event.target.value}))}/></>
          :<input ref={firstInputRef} type="date" aria-label="기준일자" value={draft.to} disabled={busy} onChange={event=>setDraft({from:event.target.value,to:event.target.value})}/>}
      </div>}
      {panel.formButtons.length>0&&<div className={styles.searchLine}>{panel.formButtons.map(button=>placeholder(button))}</div>}
      {panel.presets.length>0&&<div className={styles.datePresets}>{panel.presets.map(preset=>preset.enabled
        ?<button key={preset.id} type="button" data-ecount-action-id={preset.id} disabled={busy} title={PRESET_MESSAGE} onClick={()=>applyPreset(preset.label)}>{preset.label}</button>
        :<ObservedButton key={preset.id} data-ecount-action-id={preset.id} reason={UNVERIFIED_PRESET_REASON}>{preset.label}</ObservedButton>)}</div>}
      {(panel.searchId||panel.resetId)&&<div className={styles.sourceToolbar}>
        {panel.searchId&&<button type="submit" className={styles.primary} data-ecount-action-id={panel.searchId} disabled={busy||invalidRange} title={UNCOLLECTED_MESSAGE}>검색(F8)</button>}
        {panel.resetId&&<button type="button" data-ecount-action-id={panel.resetId} disabled={busy} onClick={reset}>{panel.resetLabel}</button>}
      </div>}
    </form>}
    {error&&<p role="alert" className={styles.error}>{error}</p>}
    {message&&<p role="status" className={styles.message}>{message}</p>}
    {screen.kind==='input'&&screen.fields.length>0&&<fieldset className={styles.filters} disabled aria-label="입력 항목(읽기 전용)"><legend>입력 항목(읽기 전용, 원본 저장 계약 확정 전)</legend>{screen.fields.map((field,index)=><ReadOnlyField key={index} field={field} index={index}/>)}</fieldset>}
    <p className={styles.empty}>{screen.kind==='input'?'입력 화면 자리표시입니다. 원본 저장 계약이 확정될 때까지 저장 계열 버튼은 비활성입니다.':screen.kind==='hub'?'연결 화면 자리표시입니다. 원본 동작은 아직 확인되지 않았습니다.':UNCOLLECTED_MESSAGE}</p>
    {(screen.footer.length>0||screen.other.length>0)&&<div className={styles.sourceToolbar} aria-label="결과 도구">{screen.footer.map(button=>placeholder(button))}{screen.other.map(button=>placeholder(button))}</div>}
  </div></ActionScope>;
}
export default SurveyScreen;
