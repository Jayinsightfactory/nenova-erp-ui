import { ActionScope, ObservedButton, ObservedDropdown, actionId, ExcelButton, presetButtons } from './ObservedPageControls';
import styles from '../../styles/ecount-workbench.module.css';
export const PURCHASE_COLUMNS=[[null,''],['refDate','일자-No.'],[null,'거래처명'],[null,'품목명(요약)'],['amountTotal','금액합계'],['foreignTotal','외화금액합계'],['exchangeRate','환율'],[null,'회계반영여부'],[null,'인쇄'],[null,'불러온전표']];
export function PurchaseToolbar({busy,searchOpen,onSearch,searchRef}) {
  return <ActionScope dataset="purchase" context="상단"><div className={`${styles.sourceToolbar} ${styles.purchaseToolbar}`} aria-label="구매 조회 도구">
    {!searchOpen&&<ActionScope dataset="purchase" context="상태 탭"><div className={styles.quoteStatusTabs}>{['전체','결재중','미확인','확인'].map(label=><ObservedButton key={label} reason="승인상태 자료가 아직 수집되지 않아 상태별 조회를 사용할 수 없습니다.">{label}</ObservedButton>)}</div></ActionScope>}
    <ObservedButton>Fn</ObservedButton><button className={styles.primary} ref={searchRef} disabled={busy} aria-expanded={searchOpen} aria-controls="ecount-source-search" data-ecount-action-id={actionId('purchase','Search(F3)','상단')} onClick={onSearch}>Search(F3)</button><ObservedButton>Option</ObservedButton><ObservedButton>도움말</ObservedButton>
  </div></ActionScope>;
}
export function PurchaseSearchPanel({busy,from,to,onFrom,onTo,onSubmit,presets=[],onPreset,onReset,onCustomer,inputRef}) {
  return <ActionScope dataset="purchase" context="검색 패널"><form id="ecount-source-search" className={styles.sourceSearch} onSubmit={event=>{event.preventDefault();onSubmit();}}>
    <div className={styles.searchLine}><span>조회기간</span><input ref={inputRef} type="date" aria-label="조회 시작일" value={from} onChange={event=>onFrom(event.target.value)}/><span>~</span><input type="date" aria-label="조회 종료일" min={from||undefined} value={to} onChange={event=>onTo(event.target.value)}/></div>
    {['거래유형','창고','거래처','품목'].map(label=><div key={label} className={styles.searchLine}><span>{label}</span><input aria-label={label} disabled title="선택할 자료가 아직 수집되지 않았습니다."/>{label==='거래처'?<button type="button" disabled={busy} data-ecount-action-id={actionId('purchase','거래처 검색 아이콘','검색 패널')} onClick={onCustomer}>검색</button>:<ObservedButton>검색</ObservedButton>}</div>)}
    <div className={styles.searchLine}><span>구매조회</span><select aria-label="구매조회" disabled data-ecount-action-id={actionId('purchase','구매조회(드롭다운)','검색 패널')} title="원본 양식 전환 동작을 아직 확인하지 않았습니다."><option>구매조회</option></select></div>
    <div className={styles.sourceToolbar}><button type="submit" className={styles.primary} disabled={busy||!!(from&&to&&from>to)} data-ecount-action-id={actionId('purchase','검색(F8)','검색 패널')}>검색(F8)</button>{presetButtons({dataset:'purchase',labels:['금일','전일','말일','금주(~오늘)','전주','금월(~오늘)','전월','다시작성'],enabled:presets,busy,onPreset,onReset})}</div>
  </form></ActionScope>;
}
export function PurchaseFooter({busy}) {
  return <ActionScope dataset="purchase" context="하단"><div className={styles.sourceToolbar} aria-label="구매 결과 도구">
    {['신규(F2)','Email','진행상태변경','보내기'].map(label=><ObservedButton key={label}>{label}</ObservedButton>)}
    <ObservedButton>인쇄</ObservedButton><ObservedDropdown busy={busy} label="인쇄 드롭다운" items={['프린트문제해결']} actionContext="하단 인쇄 옆 삼각 버튼" itemsContext="인쇄 드롭다운 펼침"/>
    {['바코드(품목)','전자결재','선택삭제'].map(label=><ObservedButton key={label}>{label}</ObservedButton>)}<ExcelButton>Excel</ExcelButton><ObservedButton>이력조회</ObservedButton>
  </div></ActionScope>;
}
