import { TaxQueryToolbar } from './PurchaseTaxQueryPageControls';
import { ActionScope, ObservedButton, actionId } from './ObservedPageControls';
import styles from '../../styles/ecount-workbench.module.css';
export const SALES_TAX_COLUMNS=[[null,''],['refDate','일자 - 번호'],[null,'거래처명'],['supplyAmt','공급가액'],['vat','부가세'],['total','합 계'],[null,'내역보기'],[null,'인쇄']];
export const SALES_TAX_WIDTHS=[25,100,115,100,90,100,140,60];
const pending='원본 동작 확인 및 구현 전입니다.';
export function SalesTaxToolbar(props){return <TaxQueryToolbar {...props} dataset="salesTax"/>;}
export function SalesTaxFooter(){
 return <ActionScope dataset="salesTax" context="하단"><div className={styles.sourceToolbar} aria-label="매출세금계산서조회 결과 도구"><ObservedButton>Email</ObservedButton><ObservedButton>대화방</ObservedButton><ObservedButton>인쇄</ObservedButton><ObservedButton actionLabel="인쇄 드롭다운">▴</ObservedButton><ObservedButton>선택삭제</ObservedButton><ObservedButton>Excel</ObservedButton></div></ActionScope>;
}

export function SalesTaxCell({row,column}) {
 const label=column===1?'일자 - 번호':column===6?'내역보기':column===7?'인쇄':null;
 if(label)return <span role="link" aria-disabled="true" className={styles.salesTaxDisabledLink} title={pending} data-ecount-action-id={actionId('salesTax',label,'결과 행')}>{column===1?String(row.sourceDateLabel||row.refDate||''):label}</span>;
 const key=SALES_TAX_COLUMNS[column][0];return key===null?'':String(row[key]??'');
}
