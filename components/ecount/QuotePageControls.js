import { ObservedButton, actionId } from './ObservedPageControls';
import styles from '../../styles/ecount-workbench.module.css';

export const QUOTE_COLUMNS = [[null,''],['refDate','일자-No.'],[null,'최초작성일자'],[null,'거래처명'],[null,'품목명(요약)'],['estimateTotal','견적금액합계'],[null,'비고'],[null,'진행상태'],[null,'생성한전표'],[null,'인쇄']];
export function QuoteToolbar({busy,searchOpen,onSearch,searchRef}) {
  return <div className={styles.sourceToolbar} aria-label="견적 조회 도구"><ObservedButton>Fn</ObservedButton><button ref={searchRef} disabled={busy} aria-expanded={searchOpen} aria-controls="ecount-source-search" data-ecount-action-id={actionId('quote','Search(F3)')} onClick={onSearch}>Search(F3)</button>{searchOpen&&<><ObservedButton>Option</ObservedButton><ObservedButton>도움말</ObservedButton></>}</div>;
}
function Unavailable({label,children}) {
  return <div className={styles.searchLine} title="수집된 자료로는 이 검색 조건을 적용할 수 없습니다."><span>{label}</span>{children||<input aria-label={label} disabled/>}</div>;
}
export function QuoteSearchPanel({busy,from,to,onFrom,onTo,onSubmit,inputRef}) {
  return <form id="ecount-source-search" className={styles.sourceSearch} onSubmit={event=>{event.preventDefault();onSubmit();}}>
    <div className={styles.searchLine}><span>조회일자</span><input ref={inputRef} type="date" aria-label="조회 시작일" value={from} onChange={event=>onFrom(event.target.value)}/><span>~</span><input type="date" aria-label="조회 종료일" min={from||undefined} value={to} onChange={event=>onTo(event.target.value)}/></div>
    <Unavailable label="내자외자"><select aria-label="내자외자" disabled>{['전체','내자','외자'].map(label=><option key={label}>{label}</option>)}</select></Unavailable>
    {['창고','거래처','품목'].map(label=><Unavailable key={label} label={label}><input aria-label={label} disabled/><ObservedButton>검색</ObservedButton></Unavailable>)}
    <Unavailable label="발송"><select aria-label="발송" disabled>{['전체','미발송','발송'].map(label=><option key={label}>{label}</option>)}</select></Unavailable>
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
    <ObservedButton>전자결재</ObservedButton><ObservedButton>선택삭제</ObservedButton><ObservedButton actionLabel="Excel(표시형식) 드롭다운">Excel(표시형식) ▾</ObservedButton><ObservedButton>이력조회</ObservedButton><ObservedButton>웹자료올리기</ObservedButton>
  </div>;
}
