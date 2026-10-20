import { ActionScope, ObservedButton, ObservedDropdown, actionId } from './ObservedPageControls';
import styles from '../../styles/ecount-workbench.module.css';

export const UNSOLD_COLUMNS=[[null,'일자-No.'],[null,'품목명(규격)'],['qty','수량'],['unfulfilledQty','미판매수량'],['supplyAmt','미판매공급가액'],[null,'거래처명'],[null,'적요'],[null,'품목별납기일자'],['vat','미판매부가세']];
export const UNBOUGHT_COLUMNS=[[null,'일자-No.'],[null,'품목명(규격)'],['qty','수량'],['unfulfilledQty','미구매수량'],[null,'품목별납기일자'],[null,'거래처명'],[null,'적요'],['vat','미구매부가세']];
const pending='기준일자(영업주기)와 실제 자료의 날짜 기준을 아직 확인하지 않아 검색을 사용할 수 없습니다.';
const presets=['검색(F8)','금일','전일','금주(~오늘)','전주','금월(~오늘)','전월','전월+금월','다시작성'];
function pageTitle(dataset){if(!['unsold','unbought'].includes(dataset))throw Error('INVALID_UNFULFILLED_DATASET');return dataset==='unsold'?'미판매현황':'미구매현황';}

export function UnfulfilledToolbar({dataset,busy,searchOpen,onSearch,searchRef}) {
  return <ActionScope dataset={dataset} context="상단"><div className={styles.sourceToolbar} aria-label={`${pageTitle(dataset)} 조회 도구`}><button ref={searchRef} disabled={busy} aria-expanded={searchOpen} aria-controls="ecount-source-search" data-ecount-action-id={actionId(dataset,'Search(F3)','상단')} onClick={onSearch}>Search(F3)</button><ObservedButton>Option</ObservedButton><ObservedButton>도움말</ObservedButton></div></ActionScope>;
}
export function UnfulfilledSearchPanel({dataset,inputRef}) {
  const title=pageTitle(dataset);
  const fields=[dataset==='unsold'?'품목별납기일자':'납기일자','창고','거래처','품목','담당자','거래처관리담당자',dataset==='unsold'?'미판매수량':'미구매수량'];
  return <ActionScope dataset={dataset} context="검색 패널"><section id="ecount-source-search" className={styles.sourceSearch} aria-label={`${title} 검색`} tabIndex={-1} ref={inputRef}><div className={styles.searchLine}><span>기준일자(영업주기)</span><input type="date" aria-label="조회 시작일" disabled title={pending}/><span>~</span><input type="date" aria-label="조회 종료일" disabled title={pending}/></div>{fields.map(label=><div className={styles.searchLine} key={label}><span>{label}</span><input aria-label={label} disabled title={pending}/></div>)}<div className={styles.searchLine}><span>구분</span><select aria-label="구분" disabled defaultValue="라인별"><option>품목별</option><option>라인별</option></select><label><input type="checkbox" disabled/>그래프</label><select aria-label="양식" disabled defaultValue={dataset==='unsold'?'현황':'현황(인쇄용)'}><option>{dataset==='unsold'?'현황':'현황(인쇄용)'}</option></select></div><div className={styles.sourceToolbar}>{presets.map(label=><ObservedButton key={label} reason={pending}>{label}</ObservedButton>)}</div></section></ActionScope>;
}
export function UnfulfilledFooter({dataset,busy}) {
  return <ActionScope dataset={dataset} context="하단"><div className={styles.sourceToolbar} aria-label={`${pageTitle(dataset)} 결과 도구`}><ObservedButton>인쇄</ObservedButton><ObservedDropdown label="인쇄 드롭다운" items={['PDF','미리보기','프린트문제해결']} busy={busy} actionContext="하단" itemsContext="인쇄 메뉴"/><ObservedButton>Excel(화면)</ObservedButton></div></ActionScope>;
}
