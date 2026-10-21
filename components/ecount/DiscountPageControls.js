import { ActionScope, ObservedButton, ObservedDropdown, actionId, ExcelButton, presetButtons } from './ObservedPageControls';
import styles from '../../styles/ecount-workbench.module.css';
export const DISCOUNT_COLUMNS=[[null,'월/일'],[null,'거래처명'],['salesAmount','판매금액'],['accountingAmount','회계반영금액'],['difference','차액'],[null,'적요']];
export const BUY_DISCOUNT_COLUMNS=[[null,'월/일'],[null,'거래처명'],['purchaseAmount','구매금액'],['accountingAmount','회계반영금액'],['difference','차액'],[null,'적요']];
const SEARCH_BUTTONS={discount:['검색(F8)','금일','전일','금주(~오늘)','전주','금월(~오늘)','전월','종료일','설정','다시 작성'],buyDisc:['검색(F8)','금일','전일','금주(~오늘)','전주','금월(~오늘)','전월','직전기수','다시 작성']};
const pendingDate='월/일 자료의 연도와 날짜 형식을 아직 확인하지 않아 기간 검색을 사용할 수 없습니다.';
export function DiscountToolbar({dataset='discount',busy,searchOpen,onSearch,searchRef}) {
  return <ActionScope dataset={dataset} context="상단"><div className={styles.sourceToolbar} aria-label={dataset==='buyDisc'?'구매할인현황 조회 도구':'판매할인현황 조회 도구'}><button ref={searchRef} disabled={busy} aria-expanded={searchOpen} aria-controls="ecount-source-search" data-ecount-action-id={actionId(dataset,'Search(F3)','상단')} onClick={onSearch}>Search(F3)</button><ObservedButton>Option</ObservedButton><ObservedButton>도움말</ObservedButton></div></ActionScope>;
}
export function DiscountSearchPanel({dataset='discount',inputRef,busy=false,from='',to='',presets=[],onPreset,onReset}) {
  return <ActionScope dataset={dataset} context="검색 패널"><section id="ecount-source-search" className={styles.sourceSearch} aria-label={dataset==='buyDisc'?'구매할인현황 검색':'판매할인현황 검색'} tabIndex={-1} ref={inputRef}><div className={styles.searchLine}><span>기준일자</span><input type="date" aria-label="조회 시작일" value={from} readOnly disabled title={pendingDate}/><span>~</span><input type="date" aria-label="조회 종료일" value={to} readOnly disabled title={pendingDate}/></div>{['거래유형','창고','거래처','거래처관리담당자','할인금액'].map(label=><div className={styles.searchLine} key={label}><span>{label}</span><input aria-label={label} disabled title="수집된 자료로는 이 검색 조건을 적용할 수 없습니다."/></div>)}<div className={styles.sourceToolbar}>{presetButtons({dataset,labels:SEARCH_BUTTONS[dataset],enabled:presets,busy,onPreset,onReset,reason:pendingDate})}</div></section></ActionScope>;
}
export function DiscountFooter({dataset='discount',busy}) {
  return <ActionScope dataset={dataset} context="하단"><div className={styles.sourceToolbar} aria-label={dataset==='buyDisc'?'구매할인현황 결과 도구':'판매할인현황 결과 도구'}><ObservedButton>인쇄</ObservedButton><ObservedDropdown label="인쇄 드롭다운" items={['PDF','미리보기','프린트문제해결']} busy={busy} actionContext="하단" itemsContext="인쇄 메뉴"/><ExcelButton>Excel</ExcelButton></div></ActionScope>;
}
