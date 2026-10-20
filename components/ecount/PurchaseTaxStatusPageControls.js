import { SalesTaxStatusToolbar,SalesTaxStatusSearchPanel,SalesTaxStatusFooter } from './SalesTaxStatusPageControls';
export const PURCHASE_TAX_STATUS_COLUMNS=[['refDate','일자-No.'],[null,'거래처명'],['supplyAmt','공급가액'],['vat','매입부가세'],['total','매입합계'],[null,'내역보기']];
export function PurchaseTaxStatusToolbar(props){return <SalesTaxStatusToolbar {...props} dataset="buyTaxStat"/>;}
export function PurchaseTaxStatusSearchPanel(props){return <SalesTaxStatusSearchPanel {...props} dataset="buyTaxStat"/>;}
export function PurchaseTaxStatusFooter(props){return <SalesTaxStatusFooter {...props} dataset="buyTaxStat"/>;}
