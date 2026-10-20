import { StockBalanceToolbar, StockBalanceSearchPanel, StockBalanceFooter, StockBalanceTable } from '../../components/ecount/StockBalancePageControls';
import { ProductLookupOverlay } from '../../components/ecount/ProductLookupOverlay';
import { StockLedgerToolbar, StockLedgerSearchPanel, StockLedgerFooter, StockLedgerTable } from '../../components/ecount/StockLedgerPageControls';
import { WarehouseLookupOverlay } from '../../components/ecount/WarehouseLookupOverlay';
import { StockMovementToolbar, StockMovementSearchPanel, StockMovementFooter, StockMovementTable } from '../../components/ecount/StockMovementPageControls';
import { WarehouseStockToolbar, WarehouseStockSearchPanel, WarehouseStockFooter, WarehouseStockTable } from '../../components/ecount/WarehouseStockPageControls';
import { PURCHASE_TAX_STATUS_COLUMNS, PurchaseTaxStatusToolbar, PurchaseTaxStatusSearchPanel, PurchaseTaxStatusFooter } from '../../components/ecount/PurchaseTaxStatusPageControls';
import { SALES_TAX_STATUS_COLUMNS, SALES_TAX_STATUS_WIDTHS, SalesTaxStatusToolbar, SalesTaxStatusSearchPanel, SalesTaxStatusFooter } from '../../components/ecount/SalesTaxStatusPageControls';
import { TaxSearchPanel } from '../../components/ecount/TaxSearchPanel';
import { PURCHASE_TAX_COLUMNS, PURCHASE_TAX_WIDTHS, TaxQueryToolbar, PurchaseTaxFooter } from '../../components/ecount/PurchaseTaxQueryPageControls';
import { STOCK_COLUMNS, STOCK_WIDTHS, StockToolbar, StockSearchPanel, StockFooter } from '../../components/ecount/StockStatusPageControls';
import { SALES_TAX_COLUMNS, SALES_TAX_WIDTHS, SalesTaxToolbar, SalesTaxFooter, SalesTaxCell } from '../../components/ecount/SalesTaxQueryPageControls';
import { useLookupWindow } from '../../components/ecount/useLookupWindow';
import { JOURNAL_COLUMNS, JournalToolbar, JournalSearchPanel, JournalFooter } from '../../components/ecount/JournalPageControls';
import { PO_STATUS_COLUMNS, PO_DAILY_COLUMNS, PoAggregateLookup, PoStatusToolbar, PoStatusSearchPanel, PoStatusFooter } from '../../components/ecount/PoStatusPageControls';
import { ORDER_QUERY_COLUMNS, OrderQueryToolbar, OrderQuerySearchPanel, OrderQueryFooter } from '../../components/ecount/OrderQueryPageControls';
import { ORDER_STATUS_COLUMNS, ORDER_DAILY_COLUMNS, OrderAggregateLookup, OrderStatusToolbar, OrderStatusSearchPanel, OrderStatusFooter } from '../../components/ecount/OrderStatusPageControls';
import { QUOTE_AGGREGATE_COLUMNS, QUOTE_DETAIL_COLUMNS, QuoteStatusToolbar, QuoteStatusSearchPanel, QuoteStatusFooter } from '../../components/ecount/QuoteStatusPageControls';
import { UNSOLD_COLUMNS, UNBOUGHT_COLUMNS, UnfulfilledToolbar, UnfulfilledSearchPanel, UnfulfilledFooter } from '../../components/ecount/UnfulfilledPageControls';
import { SALE_QUERY_COLUMNS, SALE_QUERY_COLUMN_WIDTHS, formatSaleAmount, SaleQueryToolbar, SaleQuerySearchPanel, SaleQueryFooter } from '../../components/ecount/SaleQueryPageControls';
import { DISCOUNT_COLUMNS, BUY_DISCOUNT_COLUMNS, DiscountToolbar, DiscountSearchPanel, DiscountFooter } from '../../components/ecount/DiscountPageControls';
import { PURCHASE_ORDER_COLUMNS, PurchaseOrderToolbar, PurchaseOrderSearchPanel, PurchaseOrderFooter } from '../../components/ecount/PurchaseOrderPageControls';
import { SETTLEMENT_COLUMNS, SettlementToolbar, SettlementSearchPanel, SettlementFooter } from '../../components/ecount/SettlementPageControls';
import { PURCHASE_STATUS_COLUMNS, PurchaseStatusToolbar, PurchaseStatusSearchPanel, PurchaseStatusFooter } from '../../components/ecount/PurchaseStatusPageControls';
import { PURCHASE_COLUMNS, PurchaseToolbar, PurchaseSearchPanel, PurchaseFooter } from '../../components/ecount/PurchasePageControls';
import Head from 'next/head';
import { QUOTE_COLUMNS, QuoteToolbar, QuoteSearchPanel, QuoteFooter } from '../../components/ecount/QuotePageControls';
import { actionId, ActionScope, ResultToolbar, ResultFooter, MappingOverlay, CustomerLookupOverlay, SearchPanel } from '../../components/ecount/ObservedPageControls';
import { useEffect, useMemo, useRef, useState } from 'react';
import catalog from '../../data/ecount-workbench/source-menu.json';
import policy from '../../lib/ecountWorkspaceClient.cjs';
import pageActions from '../../lib/ecountPageActions.cjs';
import printPreview from '../../lib/ecountPrintPreview.cjs';
import { EcountWorkspaceDialog } from '../../components/EcountWorkspaceDialog';
import styles from '../../styles/ecount-workbench.module.css';

const MENUS = catalog.menus;
const TABS = MENUS.filter(menu => menu.depth === 1);
const DATASETS = { E040727:'stkBalance', E040702: 'stkLedger', E040719:'stockMove', E040711: 'whStock', E040320: 'buyTaxStat', E040223: 'taxStat', E040219: 'buyTax', E040701: 'stock', E040218: 'salesTax', E010701: 'journal', E010205: 'cash', E040214: 'ar', E040309: 'ap', E040207: 'sales', E040202: 'quote', E040304: 'purchase', E040305: 'buyStatus', E040302: 'poQuery', E040217: 'receipt', E040310: 'payment', E040216: 'discount', E040313: 'buyDisc', E040206: 'saleQuery', E040212: 'unsold', E040307: 'unbought', E040208: 'quoteStat', E040204: 'orderQuery', E040209: 'orderStat', E040306: 'poStat' };
const LABELS = { refDate:'일자',date:'일자',amount:'금액',balance:'잔액',salesTotal:'매출합계',receiptTotal:'수금합계',etcDiff:'기타차액',openingDebt:'기초채무',stockBuy:'재고매입',acctBuy:'회계매입',payTotal:'지급합계',qty:'수량',supplyAmt:'공급가액',vat:'부가세',total:'합계',isSubtotal:'소계',flow:'구분',currency:'통화',rowNumber:'순번',unitPrice:'단가',unbilled:'미청구액' };
const ERRORS = { SOURCE_IMPORT_UNSUPPORTED:'이 메뉴는 파일 업로드로 작업 자료를 불러올 수 있습니다.', LOGIN_REQUIRED:'로그인 후 이용해 주세요.',ADMIN_REQUIRED:'관리자 권한이 필요합니다.',ACCOUNT_INACTIVE:'사용 가능한 관리자 계정인지 확인해 주세요.',WORKSPACE_NOT_INSTALLED:'작업용 SQL 영역이 아직 준비되지 않았습니다.',WORKSPACE_UNAVAILABLE:'작업 자료에 연결할 수 없습니다. 잠시 후 다시 조회해 주세요.',INVALID_PERIOD:'시작일과 종료일을 함께 지정해 주세요.',INVALID_DATE:'날짜 형식을 확인해 주세요.',SOURCE_DATE_MISMATCH:'원본 일자와 조회 일자가 일치하지 않습니다.',INVALID_SUBTOTAL_DATE:'월별 합계 행의 소계 구분을 확인해 주세요.',INVALID_DECIMAL:'숫자 형식을 확인해 주세요.',SOURCE_ROW_COUNT_MISMATCH:'수집 자료의 행 수가 일치하지 않아 불러오기를 중단했습니다.', UNAUTHORIZED:'로그인 후 이용해 주세요.',FORBIDDEN:'관리자 권한이 필요합니다.',REVISION_CONFLICT:'다른 작업에서 자료가 변경되었습니다. 다시 조회한 뒤 진행해 주세요.',WORKSPACE_NOT_INITIALIZED:'작업용 SQL 영역이 아직 준비되지 않았습니다.',SOURCE_NOT_FOUND:'가져올 수 있는 수집 자료가 없습니다.',SOURCE_TOO_LARGE:'한 번에 불러올 수 있는 범위를 초과했습니다. 자료를 나누어 주세요.',EMPTY_SAFE_ROW:'적재할 숫자 자료가 없는 행이 있습니다.',INVALID_SUBTOTAL:'소계 구분을 확인해 주세요.',INVALID_ROWS:'자료 행 수 또는 형식을 확인해 주세요.',VERSION_NOT_FOUND:'복원할 자료를 찾을 수 없습니다. 작업 이력을 다시 조회해 주세요.' };
const searchKey = value => String(value).toLowerCase().replace(/[\s/()·_-]/g,'');
function arrowFocus(event) {
  if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key) || /INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) return;
  const buttons = [...event.currentTarget.querySelectorAll('button:not(:disabled)')];
  const index = buttons.indexOf(document.activeElement); if (index < 0) return;
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length-1 : (index + (['ArrowLeft','ArrowUp'].includes(event.key) ? -1 : 1) + buttons.length) % buttons.length;
  event.preventDefault(); buttons[next]?.focus();
}
// Source-observed bank headers retain their order; restricted fields are never supplied.
const BANK_COLUMNS = [
  [null,''],['refDate','입/출금일자'],['flow','구분'],[null,'계좌번호'],[null,'계좌명'],[null,'거래처코드'],[null,'거래처명'],['amount','금액'],[null,'입금처(출금처)'],[null,'비 고'],['balance','원화잔액'],[null,'지점명/상대은행'],[null,'회계전표']
];
const AR_COLUMNS = [[null,'거래처명'],['salesTotal','매출합계'],['receiptTotal','수금합계'],['etcDiff','기타할인등차액'],['balance','잔액'],[null,'미회수월']];
const AP_COLUMNS = [[null,'거래처코드'],[null,'거래처명'],['openingDebt','기초채무'],['stockBuy','재고매입'],['acctBuy','회계매입'],['payTotal','지급합계'],['etcDiff','기타할인등차액'],['balance','잔액'],['unbilled','미청구액']];
const SALES_COLUMNS = [['refDate','일자-No.'],[null,'거래처명'],[null,'품목명'],['qty','수량'],['unitPrice','단가(vat포함)'],['supplyAmt','공급가액'],['vat','부가세'],['total','합계'],[null,'적요']];
function Table({ rows, dataset, dataState='uncollected', quoteReportMode='aggregate', orderReportMode='detail', orderAggregateCondition='', poReportMode='detail', poAggregateCondition='',warehouseMode='horizontal' }) {
  if(dataset==='stkBalance')return <StockBalanceTable rows={rows} dataState={dataState}/>;
  if(dataset==='stkLedger')return <StockLedgerTable rows={rows} dataState={dataState}/>;
  if(dataset==='stockMove')return <StockMovementTable rows={rows} dataState={dataState}/>;
  if(dataset==='whStock')return <WarehouseStockTable rows={rows} mode={warehouseMode} dataState={dataState}/>;
  const emptyText=dataState==='loading'?'작업 자료를 불러오는 중입니다.':dataState==='unavailable'?'작업 자료를 불러오지 못했습니다.':dataState!=='loaded'?'작업 자료가 아직 수집되지 않았습니다.':['purchase','poQuery','receipt','payment','saleQuery','buyStatus','salesTax','buyTax','taxStat','buyTaxStat'].includes(dataset)?'등록된 데이터가 없습니다.':'조회된 자료가 없습니다.';
  if((dataset==='orderStat'&&orderReportMode==='aggregate'&&orderAggregateCondition!=='daily')||(dataset==='poStat'&&poReportMode==='aggregate'&&poAggregateCondition!=='daily'))return <p className={styles.empty}>집계 결과의 열 구성이 아직 확인되지 않았습니다.</p>;
  const columns = dataset==='buyTaxStat'?PURCHASE_TAX_STATUS_COLUMNS:dataset==='taxStat'?SALES_TAX_STATUS_COLUMNS:dataset==='buyTax'?PURCHASE_TAX_COLUMNS:dataset==='stock'?STOCK_COLUMNS:dataset==='salesTax' ? SALES_TAX_COLUMNS : dataset==='journal' ? JOURNAL_COLUMNS : dataset==='cash' ? BANK_COLUMNS : dataset==='ar' ? AR_COLUMNS : dataset==='ap' ? AP_COLUMNS : dataset==='sales' ? SALES_COLUMNS : dataset==='quote' ? QUOTE_COLUMNS : dataset==='quoteStat' ? (quoteReportMode==='detail'?QUOTE_DETAIL_COLUMNS:QUOTE_AGGREGATE_COLUMNS) : dataset==='orderQuery' ? ORDER_QUERY_COLUMNS : dataset==='orderStat' ? (orderReportMode==='aggregate'&&orderAggregateCondition==='daily'?ORDER_DAILY_COLUMNS:ORDER_STATUS_COLUMNS) : dataset==='poStat' ? (poReportMode==='aggregate'&&poAggregateCondition==='daily'?PO_DAILY_COLUMNS:PO_STATUS_COLUMNS) : dataset==='purchase' ? PURCHASE_COLUMNS : dataset==='buyStatus' ? PURCHASE_STATUS_COLUMNS : dataset==='poQuery' ? PURCHASE_ORDER_COLUMNS : dataset==='saleQuery' ? SALE_QUERY_COLUMNS : dataset==='unsold' ? UNSOLD_COLUMNS : dataset==='unbought' ? UNBOUGHT_COLUMNS : dataset==='discount' ? DISCOUNT_COLUMNS : dataset==='buyDisc' ? BUY_DISCOUNT_COLUMNS : ['receipt','payment'].includes(dataset) ? SETTLEMENT_COLUMNS : [...new Set(rows.flatMap(row => Object.keys(row)))].map(key=>[key,LABELS[key]||key]);
  if (!columns.length) return <p className={styles.empty}>{emptyText}</p>;
  return <div className={`${styles.tableWrap} ${dataset==='purchase'?styles.purchaseTable:''} ${dataset==='saleQuery'?styles.saleQueryMeasuredTable:''} ${['salesTax','buyTax'].includes(dataset)?styles.salesTaxTable:''} ${dataset==='buyTax'?styles.buyTaxTable:''} ${dataset==='stock'?styles.stockTable:''} ${['taxStat','buyTaxStat'].includes(dataset)?styles.taxStatusTable:''} ${(dataset==='poStat'&&poReportMode==='aggregate'&&poAggregateCondition==='daily')||(dataset==='orderStat'&&orderReportMode==='aggregate'&&orderAggregateCondition==='daily')?styles.poDailyTable:''}`}><table>{['taxStat','buyTaxStat'].includes(dataset)&&<colgroup>{SALES_TAX_STATUS_WIDTHS.map((width,index)=><col key={index} style={{width}}/>)}</colgroup>}{dataset==='buyTax'&&<colgroup>{PURCHASE_TAX_WIDTHS.map((width,index)=><col key={index} style={{width}}/>)}</colgroup>}{dataset==='stock'&&<colgroup>{STOCK_WIDTHS.map((width,index)=><col key={index} style={{width}}/>)}</colgroup>}{dataset==='salesTax'&&<colgroup>{SALES_TAX_WIDTHS.map((width,index)=><col key={index} style={{width}}/>)}</colgroup>}{dataset==='purchase'&&<colgroup>{[3,11,12,29,8,11,11,6,4,5].map((width,index)=><col key={index} style={{width:`${width}%`}}/>)}</colgroup>}{dataset==='saleQuery'&&<colgroup>{SALE_QUERY_COLUMN_WIDTHS.map((width,index)=><col key={index} style={{width}}/>)}</colgroup>}{dataset==='orderStat'&&orderReportMode==='detail'&&<colgroup>{[8,20,10,12,12,20,18].map((width,index)=><col key={index} style={{width:`${width}%`}}/>)}</colgroup>}{['receipt','payment'].includes(dataset)&&<colgroup>{[20,33.333,20,26.667].map((width,index)=><col key={index} style={{width:`${width}%`}}/>)}</colgroup>}<thead><tr>{columns.map(([key,label],index) => <th key={index} scope="col">{label}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row,index) => <tr key={index}>{columns.map(([key],column) => <td key={column} title={key===null&&!(dataset==='salesTax'&&column>=6)?'개인정보 및 미수집 항목은 표시하지 않습니다.':undefined}>{dataset==='salesTax'?<SalesTaxCell row={row} column={column}/>:key===null ? '' : (dataset==='saleQuery'&&key==='amount'||dataset==='stock'&&key==='quantity')?formatSaleAmount(row[key]):key==='quoteStatus' ? ({in_progress:'진행중',completed:'완료'}[row[key]]||'') : key==='refDate' ? String(row.sourceDateLabel || row.refDate || '') : typeof row[key] === 'boolean' ? row[key] ? 'Y' : '' : String(row[key] ?? '')}</td>)}</tr>) : <tr><td colSpan={columns.length} className={styles.empty}>{emptyText}</td></tr>}</tbody></table></div>;
}

export default function EcountWorkbench() {
  const [tab,setTab] = useState(TABS[0].id);
  const [menuId,setMenuId] = useState(null);
  const [menuOpen,setMenuOpen] = useState(true);
  const [query,setQuery] = useState('');
  const [rowQuery,setRowQuery] = useState('');
  const [filterFrom,setFilterFrom] = useState('');
  const [filterTo,setFilterTo] = useState('');
  const [flow,setFlow] = useState('');
  const [quoteStatus,setQuoteStatus] = useState('all');
  const [quoteReportMode,setQuoteReportMode] = useState('aggregate');
  const [orderReportMode,setOrderReportMode] = useState('detail');
  const [orderAggregateCondition,setOrderAggregateCondition] = useState('');
  const [poReportMode,setPoReportMode] = useState('detail');
  const [poAggregateCondition,setPoAggregateCondition] = useState('');
  const [ledgerProductDraft,setLedgerProductDraft]=useState('');
  const [ledgerProductFilter,setLedgerProductFilter]=useState('');
  const [ledgerPending,setLedgerPending]=useState(null);
  const [warehouseMode,setWarehouseMode]=useState('horizontal');
  const [warehouseDraft,setWarehouseDraft]=useState([]);
  const [warehouseFilter,setWarehouseFilter]=useState([]);
  const [searchOpen,setSearchOpen] = useState(false);
  const [searchDraft,setSearchDraft] = useState({from:'',to:'',flow:'',query:''});
  const searchInputRef = useRef(null);
  const searchToggleRef = useRef(null);
  const [version,setVersion] = useState(null);
  const [revision,setRevision] = useState(null);
  const [error,setError] = useState('');
  const [message,setMessage] = useState('');
  const [loginNeeded,setLoginNeeded] = useState(false);
  const [busy,setBusy] = useState(false);
  const [dialog,setDialog] = useState(null);
  const [history,setHistory] = useState([]);
  const [audit,setAudit] = useState([]);
  const [upload,setUpload] = useState(null);
  const [sheet,setSheet] = useState('');
  const [periodFrom,setPeriodFrom] = useState('');
  const [periodTo,setPeriodTo] = useState('');
  const [rollbackId,setRollbackId] = useState('');
  const [reasonCode,setReasonCode] = useState('ROLLBACK');
  const requestId = useRef(0);
  const titleRef = useRef(null);
  const menuButtonRef = useRef(null);
  const feature = MENUS.find(menu => menu.id === menuId);
  const dataset = DATASETS[feature?.program];
  const openLookupWindow=useLookupWindow({scope:`${menuId}|${dataset}|${dialog}|${orderReportMode}|${poReportMode}`,onError:setError,onDaily:value=>{if(value==='orderStat')setOrderAggregateCondition('daily');else if(value==='poStat')setPoAggregateCondition('daily');setDialog(null);}});
  const menuList = useMemo(() => MENUS.filter(menu => menu.depth > 1 && (query ? searchKey(menu.path.join(' ')).includes(searchKey(query)) : menu.tab === tab)),[query,tab]);
  const filtered = useMemo(() => {
    if(!dataset) return {rows:[],unknownDateCount:0};
    try {if(['stockMove','stkLedger'].includes(dataset)){const from=filterFrom||version?.periodFrom,to=filterTo||version?.periodTo;if(!from||!to)return {rows:[],unknownDateCount:0,snapshotUnavailable:true};const selected=pageActions.selectStockPeriod({dataset,version,from,to});if(dataset==='stkLedger'&&ledgerProductFilter){selected.rows=selected.rows.filter(row=>row.productCode===ledgerProductFilter);if(!selected.rows.length)return {rows:[],unknownDateCount:0,snapshotUnavailable:true};}return {...selected,unknownDateCount:0,snapshotUnavailable:!selected.available};}if(['stock','whStock','stkBalance'].includes(dataset)){const asOf=filterFrom||version?.periodFrom;if(!asOf)return {rows:[],unknownDateCount:0,snapshotUnavailable:true};const selected=pageActions.selectStockSnapshot({dataset,version,asOf});if(dataset==='whStock'&&warehouseFilter.length){const known=new Set(selected.rows.map(row=>row.warehouseCode));if(warehouseFilter.some(code=>!known.has(code)))return {rows:[],unknownDateCount:0,snapshotUnavailable:true};selected.rows=selected.rows.filter(row=>warehouseFilter.includes(row.warehouseCode));}return {...selected,unknownDateCount:0,snapshotUnavailable:!selected.available};}return pageActions.filterSortRows({dataset,rows:version?.rows||[],from:filterFrom||null,to:filterTo||null,flow:flow==='입금'?'in':flow==='출금'?'out':'all',quoteStatus:dataset==='quote'?quoteStatus:'all'});}
    catch {return {rows:[],unknownDateCount:0,filterError:'조회 조건 또는 저장된 자료 형식을 확인해 주세요. Search(F3)에서 조건을 다시 지정할 수 있습니다.'};}
  },[dataset,version,filterFrom,filterTo,flow,quoteStatus,warehouseFilter,ledgerProductFilter]);
  const rows = useMemo(()=>filtered.rows.filter(row=>Object.values(row).join(' ').toLowerCase().includes(rowQuery.toLowerCase())),[filtered,rowQuery]);
  useEffect(()=>{
    if(dataset!=='quote'||quoteStatus==='all'||!version)return;
    const supported=version.rows?.some(row=>row.quoteStatus===quoteStatus&&['row_cell','query_filter'].includes(row.statusEvidence));
    if(!supported){setQuoteStatus('all');setMessage('현재 작업 자료에는 선택한 상태의 근거가 없어 전체 자료로 전환했습니다.');}
  },[dataset,version,quoteStatus]);
  const quickLinks = ['견적서조회','견적서입력','판매현황','구매조회','구매입력','구매현황','거래처별채권','거래처별채무','입/출금계좌 조회'].map(label => MENUS.find(menu => menu.label === label)).filter(Boolean);

  async function api(view='current',body=null) {
    const params = new URLSearchParams({dataset,menuId,view});
    const response = await fetch(`/api/ecount/workspace?${params}`,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify({...body,dataset,menuId}):undefined});
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success) {
      if (response.status === 401) setLoginNeeded(true);
      const code = String(result.error || `HTTP_${response.status}`);
      throw new Error(ERRORS[code] || (response.status === 409 ? ERRORS.REVISION_CONFLICT : `요청을 처리하지 못했습니다. (${/^[A-Z0-9_]+$/.test(code)?code:'WORKSPACE_ERROR'})`));
    }
    return result;
  }
  async function load() {
    if (!dataset) return;
    const id = ++requestId.current;
    setBusy(true);setError('');setLoginNeeded(false);
    try { const data = await api(); if (id !== requestId.current) return; setVersion(data.version);setRevision(data.revision); }
    catch (e) { if (id === requestId.current) {setVersion(null);setRevision(null);setError(e.message);} }
    finally { if (id === requestId.current) setBusy(false); }
  }
  function selectMenu(id, {updateLocation=true}={}) {
    if (busy) return;
    const next = MENUS.find(menu => menu.id === id); if (!next) return;
    if (id===menuId) {setMenuOpen(false);setQuery('');setTab(next.tab);setTimeout(()=>titleRef.current?.focus(),0);return;}
    ++requestId.current;setLedgerProductDraft('');setLedgerProductFilter('');setLedgerPending(null);setWarehouseDraft([]);setWarehouseFilter([]);setWarehouseMode('horizontal');setOrderAggregateCondition('');setPoAggregateCondition('');setPoReportMode('detail');setOrderReportMode('detail');setQuoteReportMode('aggregate');setDialog(null);setUpload(null);setSheet('');setRollbackId('');setHistory([]);setAudit([]);setLoginNeeded(false);setMenuId(id);setTab(next.tab);setMenuOpen(false);setQuery('');setVersion(null);setRevision(null);setError('');setMessage('');setRowQuery('');setFilterFrom('');setFilterTo('');setFlow('');setQuoteStatus('all');setSearchOpen(false);setSearchDraft({from:'',to:'',flow:'',query:''});
    if(updateLocation)window.history.replaceState(null,'',`${window.location.pathname}${window.location.search}#menu=${encodeURIComponent(id)}`);
    setTimeout(() => titleRef.current?.focus(),0);
  }
  function selectTab(id) { if (busy) return; setTab(id);setQuery('');setMenuOpen(true); }
  function closeDialog() { if (busy) return;setDialog(null);setUpload(null);setSheet('');setRollbackId(''); }
  async function showHistory() {
    setBusy(true);setError('');
    try { const data = await api('history');const current = await api();if (current.revision!==data.revision) throw new Error(ERRORS.REVISION_CONFLICT);setVersion(current.version);setHistory(data.versions || []);setAudit(data.events || []);setRevision(data.revision);setDialog('history'); }
    catch(e) {setError(e.message);} finally {setBusy(false);}
  }
  async function mutate(body) {
    let saved = false;
    setBusy(true);setError('');setMessage('');
    try {
      const result = await api('current',{...body,expectedRevision:revision});
      saved = true;setRevision(result.revision);setDialog(null);setUpload(null);setRollbackId('');
      const current = await api();setVersion(current.version);setRevision(current.revision);
      setMessage(body.action==='activate'?'선택한 작업 자료로 복원했습니다.':'작업 자료를 불러왔습니다.');
    } catch(e) {setError(saved?'저장은 완료되었으나 재조회에 실패했습니다. Search(F3)에서 검색(F8)을 실행해 현재 자료를 확인해 주세요.':e.message);} finally {setBusy(false);if(saved)setTimeout(()=>titleRef.current?.focus(),0);}
  }
  async function readFile(event) {
    const file = event.target.files?.[0]; if (!file) return;
    setUpload(null);setError('');
    if (file.size > 5*1024*1024) {setError('5MB 이하의 CSV 또는 XLSX 파일을 선택해 주세요.');return;}
    if (!/\.(csv|xlsx)$/i.test(file.name)) {setError('CSV 또는 XLSX 파일을 선택해 주세요.');return;}
    setBusy(true);
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false,cellFormula:false,cellHTML:false});
      const names = workbook.SheetNames;
      if (!names.length) throw new Error('파일에 시트가 없습니다.');
      const sheets = {};
      for (const name of names) {
        const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[name],{raw:false,defval:''});
        const aliases = {'전일재고':'openingQuantity','입고수량':'inQuantity','출고수량':'outQuantity','입/출금일자':'refDate','원화잔액':'balance','입출금구분':'flow','수급합계':'receiptTotal','기타할인등차액':'etcDiff','공급가':'supplyAmt','계':'total','단가(vat포함)':'unitPrice','매입부가세':'vat','매입합계':'total','매출부가세':'vat','매출합계':dataset==='taxStat'?'total':'salesTotal','창고코드':'warehouseCode','품목코드':'productCode','재고수량':'quantity','일자 - 번호':'refDate','합 계':'total','전표번호':'refDate','일자-No.':'refDate','견적금액합계':'estimateTotal','금액합계':dataset==='saleQuery'?'amount':'amountTotal','외화금액합계':'foreignTotal','환율':'exchangeRate','박스수량':'boxQty','외화금액':'foreignAmount','Weight':'weight','발주금액합계':'orderTotal'};
        const mappedRows = rawRows.map(row => Object.fromEntries(Object.entries(row).map(([key,value]) => [aliases[key.trim()] || Object.keys(LABELS).find(field => LABELS[field]===key.trim()) || key.trim(),value])));
        for (const row of mappedRows) {
          // Keep the source date label intact; the shared allowlist parser validates it.
          if (row.isSubtotal==null && /^\d{4}\/\d{2} {1,3}계$/.test(row.sourceDateLabel || row.refDate || '')) row.isSubtotal=true;
          if (typeof row.isSubtotal==='string') {
            if (['TRUE','Y','1'].includes(row.isSubtotal.toUpperCase())) row.isSubtotal=true;
            else if (['FALSE','N','0',''].includes(row.isSubtotal.toUpperCase())) row.isSubtotal=false;
          }
        }
        sheets[name] = policy.sanitizeRows(dataset,mappedRows);
      }
      setUpload({sheets,names});setSheet(names[0]);
    } catch {setError('파일을 읽을 수 없습니다. 열 이름과 날짜·숫자 형식을 확인해 주세요.');}
    finally {setBusy(false);}
  }
  useEffect(() => {
    const syncLocation = () => {
      if(busy)return;
      const id = new URLSearchParams(window.location.hash.slice(1)).get('menu');
      if(id!==menuId&&MENUS.some(menu=>menu.id===id))selectMenu(id,{updateLocation:false});
    };
    syncLocation();
    window.addEventListener('hashchange',syncLocation);
    window.addEventListener('popstate',syncLocation);
    return()=>{window.removeEventListener('hashchange',syncLocation);window.removeEventListener('popstate',syncLocation);};
  },[busy,menuId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (dataset) load(); /* Selected menu identifies the request scope. */ },[menuId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const back = event => {event.preventDefault();if(busy)return;if(dialog){closeDialog();return;}setMenuOpen(true);setTimeout(()=>menuButtonRef.current?.focus(),0);};
    window.addEventListener('nenova:menu-back-request',back);
    return () => window.removeEventListener('nenova:menu-back-request',back);
  },[busy,dialog]);

  function toggleSearch() {
    if (busy) return;
    if(['stkBalance','stkLedger','stockMove','stock','whStock','salesTax','buyTax','taxStat','buyTaxStat'].includes(dataset)&&!searchDraft.from)setSearchDraft(value=>({...value,from:version?.periodFrom||'',to:(['stock','whStock','stkBalance'].includes(dataset)?version?.periodFrom:version?.periodTo)||''}));
    setSearchOpen(open=>!open);
    if (!searchOpen) setTimeout(()=>searchInputRef.current?.focus(),0);
  }
  async function runSearch(criteria=searchDraft,noticeAccepted=false) {
    if (busy) return;
    if(['stkBalance','stkLedger','stockMove','stock','whStock','salesTax','buyTax','taxStat','buyTaxStat'].includes(dataset)){criteria={...criteria};for(const key of ['from','to']){const day=/^(\d{4}-\d{2}-)(\d{1,2})$/.exec(criteria[key]||'');if(day)criteria[key]=day[1]+day[2].padStart(2,'0');}if(['stock','whStock','stkBalance'].includes(dataset))criteria.to=criteria.from;}
    if(['buyTax','taxStat','buyTaxStat'].includes(dataset)&&!version){setError('작업 자료가 아직 수집되지 않아 조회를 실행할 수 없습니다.');return;}
    if(policy.READ_ONLY_DATASETS.includes(dataset)){setError('조회 기준일과 자료 날짜의 의미가 확인되지 않아 기간 검색을 사용할 수 없습니다.');return;}
    try {
      policy.date(criteria.from||null);policy.date(criteria.to||null);
      if (criteria.from && criteria.to && criteria.from>criteria.to) throw new Error('INVALID_PERIOD');
    } catch(e) {setError(ERRORS[e.message]||'조회 날짜를 확인해 주세요.');return;}
    if(['stockMove','stkLedger'].includes(dataset)&&(!criteria.from||!criteria.to)){setError('조회기간을 지정해 주세요.');return;}
    if(['stock','whStock','stkBalance'].includes(dataset)&&!criteria.from){setError('기준일자를 지정해 주세요.');return;}
    if(dataset==='stkLedger'&&!ledgerProductDraft&&!noticeAccepted){setLedgerPending({...criteria});setDialog('ledger-notice');return;}
    if(dataset==='stkLedger')setLedgerProductFilter(ledgerProductDraft);
    if(dataset==='whStock')setWarehouseFilter([...warehouseDraft]);
    setFilterFrom(criteria.from);setFilterTo(['stock','whStock','stkBalance'].includes(dataset)?criteria.from:criteria.to);setFlow(criteria.flow);setRowQuery(criteria.query);
    setSearchOpen(false);await load();setTimeout(()=>searchToggleRef.current?.focus(),0);
  }
  function openSalesPreview() {
    if(!['sales','buyStatus','receipt','payment'].includes(dataset)||busy||revision===null||!version)return;
    // Open only from the user's click, then sever opener before navigating to any data.
    let child;
    try {child=window.open('about:blank','_blank');} catch {setError('미리보기 새창을 열 수 없습니다. 브라우저의 팝업 허용 설정을 확인해 주세요.');return;}
    if(!child){setError('미리보기 새창이 차단되었습니다. 이 사이트의 팝업을 허용한 후 다시 실행해 주세요.');return;}
    let url;
    try {
      child.opener=null;
      const previewTitle=({buyStatus:'구매현황',receipt:'수금현황',payment:'지급현황'})[dataset]||'판매현황';
      const columns=(dataset==='buyStatus'?PURCHASE_STATUS_COLUMNS:['receipt','payment'].includes(dataset)?SETTLEMENT_COLUMNS:SALES_COLUMNS).map(([key,label],index)=>({key:key==='refDate'?'sourceDateLabel':key||`protected-${index}`,label}));
      const model=pageActions.buildExportModel({dataset,rows,columns,title:previewTitle});
      const filteredPeriod=!!(filterFrom||filterTo);
      const html=printPreview.renderPrintPreview(model,{company:'네노바',title:previewTitle,periodFrom:filteredPeriod?(filterFrom||null):(version?.periodFrom||null),periodTo:filteredPeriod?(filterTo||null):(version?.periodTo||null)});
      url=URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'}));
      child.location.replace(url);
      setTimeout(()=>URL.revokeObjectURL(url),120000);
      setError('');
    } catch {
      if(url)URL.revokeObjectURL(url);
      child.close();setError('현재 작업 자료의 미리보기를 만들 수 없습니다. 조회 조건과 자료 형식을 확인해 주세요.');
    }
  }
  function applyObservedPreset(id) {
    if(busy||!(dataset==='sales'&&['thisWeek','previousWeek'].includes(id)||['purchase','buyStatus','poQuery','saleQuery','journal','stkBalance','stkLedger','stockMove','stock','whStock','salesTax','buyTax','taxStat','buyTaxStat'].includes(dataset)&&id==='today'||['receipt','payment'].includes(dataset)&&['today','previousMonth'].includes(id)))return;
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const part=type=>parts.find(value=>value.type===type).value;
    const today=`${part('year')}-${part('month')}-${part('day')}`;
    const next={...searchDraft,...pageActions.datePreset(id,today,{weekStartsOn:0})};
    setSearchDraft(next);runSearch(next);
  }
  useEffect(()=>{
    const key=event=>{
      if (busy || dialog || menuOpen || !dataset || event.altKey || event.ctrlKey || event.metaKey) return;
      const action=pageActions.keyboardAction(event);
      if(action==='open-search'){event.preventDefault();toggleSearch();}
      if(action==='run-search'&&searchOpen){event.preventDefault();runSearch();}
      if(event.key==='Escape'&&searchOpen){event.preventDefault();setSearchOpen(false);searchToggleRef.current?.focus();}
    };
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[busy,dialog,menuOpen,dataset,searchOpen,searchDraft,warehouseDraft,ledgerProductDraft]);

  const workspaceActions = !policy.READ_ONLY_DATASETS.includes(dataset)&&<div className={styles.toolbar}><button disabled={busy||revision===null} onClick={()=>{setError('');setPeriodFrom('');setPeriodTo('');setDialog('upload');}}>자료 업로드</button>{policy.SOURCE_DATASETS.includes(dataset)&&<button disabled={busy||revision===null} onClick={()=>{setError('');setDialog('source');}}>수집 자료 불러오기</button>}<button disabled={busy||revision===null} onClick={showHistory}>작업 이력</button></div>;
  return <ActionScope dataset={dataset}><div className={styles.page}>
    <Head><title>{feature?.label || 'MyPage'} | NENOVA ERP</title><meta name="robots" content="noindex,nofollow" /></Head>
    <div className={styles.quickbar} onKeyDown={arrowFocus}><input aria-label="메뉴 검색" placeholder="메뉴검색" value={query} disabled={busy} onChange={event=>{setQuery(event.target.value);setMenuOpen(true);}} /><button ref={menuButtonRef} disabled={busy} onClick={()=>setMenuOpen(value=>!value)}>사이트맵</button>{quickLinks.map(menu=><button key={menu.id} disabled={busy} onClick={()=>selectMenu(menu.id)}>{menu.label}</button>)}</div>
    <nav className={styles.tabs} aria-label="업무 탭" onKeyDown={arrowFocus}><a href="/" className={styles.brand}>NENOVA</a>{TABS.map(item=><button key={item.id} disabled={busy} aria-expanded={menuOpen&&item.id===tab} className={item.id===tab?styles.activeTab:''} onClick={()=>selectTab(item.id)}>{item.label}</button>)}</nav>
    {menuOpen && <section className={styles.menuPanel} aria-label="전체 메뉴" onKeyDown={event=>{if(event.key==='Escape'){setMenuOpen(false);menuButtonRef.current?.focus();}else arrowFocus(event);}}><div className={styles.menuTree}>{menuList.map(menu=><button key={menu.id} disabled={busy} className={`${styles.menuItem} ${menu.hasChildren?styles.menuGroup:''} ${menu.id===menuId?styles.currentMenu:''}`} style={{paddingLeft:12+Math.max(0,menu.depth-2)*14}} onClick={()=>selectMenu(menu.id)} title={menu.path.join(' > ')}>{query?menu.path.slice(1).join(' > '):menu.label}</button>)}</div></section>}
    {!menuOpen && <section className={`${styles.content} ${['saleQuery','orderQuery'].includes(dataset)?styles.saleQueryContent:''} ${['receipt','payment','buyStatus','orderStat','poStat','taxStat','buyTaxStat'].includes(dataset)?`${styles.settlementContent} ${dataset==='buyStatus'?styles.buyStatusContent:dataset==='poStat'?styles.poStatusContent:['taxStat','buyTaxStat'].includes(dataset)?styles.taxStatusContent:''}`:''}`} aria-busy={busy}>
      <div className={styles.heading}><h1 data-ui-page-title ref={titleRef} tabIndex={-1}>{dataset==='buyTaxStat'?'매입(세금)계산서현황(재고)':dataset==='taxStat'?'매출(세금)계산서현황(재고)':dataset==='salesTax'?'매출(세금)계산서조회(재고)':dataset==='buyTax'?'매입(세금)계산서조회(재고)':feature?.label || 'MyPage'}</h1>{dataset==='buyTaxStat'?<PurchaseTaxStatusToolbar busy={busy} searchOpen={searchOpen} onSearch={toggleSearch} searchRef={searchToggleRef}/>:dataset==='taxStat'?<SalesTaxStatusToolbar busy={busy} searchOpen={searchOpen} onSearch={toggleSearch} searchRef={searchToggleRef}/>:dataset==='poStat'?<PoStatusToolbar busy={busy} searchOpen={searchOpen} onSearch={toggleSearch} searchRef={searchToggleRef}/>:dataset==='orderStat'?<OrderStatusToolbar busy={busy} searchOpen={searchOpen} onSearch={toggleSearch} searchRef={searchToggleRef}/>:dataset==='buyStatus'?<PurchaseStatusToolbar busy={busy} searchOpen={searchOpen} onSearch={toggleSearch} searchRef={searchToggleRef}/>:['receipt','payment'].includes(dataset)?<SettlementToolbar dataset={dataset} busy={busy} searchOpen={searchOpen} onSearch={toggleSearch} searchRef={searchToggleRef}/>:<span>{feature?.path.slice(0,-1).join(' > ')}</span>}</div>
      {error && <div role="alert" className={styles.error}>{error} {loginNeeded&&<a href="/login">로그인</a>}</div>}
      {filtered.filterError && <p role="alert" className={styles.error}>{filtered.filterError}</p>}
      {message && <p role="status" className={styles.message}>{message}</p>}
      {dataset ? <>
        {dataset==='stkBalance'?<StockBalanceToolbar busy={busy} searchOpen={searchOpen} onSearch={toggleSearch} searchRef={searchToggleRef}/>:dataset==='stkLedger'?<StockLedgerToolbar busy={busy} searchOpen={searchOpen} onSearch={toggleSearch} searchRef={searchToggleRef}/>:dataset==='stockMove'?<StockMovementToolbar busy={busy} searchOpen={searchOpen} onSearch={toggleSearch} searchRef={searchToggleRef}/>:dataset==='whStock'?<WarehouseStockToolbar busy={busy} searchOpen={searchOpen} onSearch={toggleSearch} searchRef={searchToggleRef}/>:['taxStat','buyTaxStat'].includes(dataset)?null:dataset==='buyTax'?<TaxQueryToolbar dataset={dataset} busy={busy} searchOpen={searchOpen} onSearch={toggleSearch} searchRef={searchToggleRef}/>:dataset==='stock'?<StockToolbar busy={busy} searchOpen={searchOpen} onSearch={toggleSearch} searchRef={searchToggleRef}/>:dataset==='salesTax'?<SalesTaxToolbar busy={busy} searchOpen={searchOpen} onSearch={toggleSearch} searchRef={searchToggleRef}/>:dataset==='journal'?<JournalToolbar busy={busy} searchOpen={searchOpen} onSearch={toggleSearch} searchRef={searchToggleRef}/>:dataset==='poStat'?null:dataset==='orderQuery'?<OrderQueryToolbar busy={busy} searchOpen={searchOpen} onSearch={toggleSearch} searchRef={searchToggleRef}/>:dataset==='orderStat'?null:dataset==='quoteStat'?<QuoteStatusToolbar busy={busy} searchOpen={searchOpen} onSearch={toggleSearch} searchRef={searchToggleRef}/>:['unsold','unbought'].includes(dataset)?<UnfulfilledToolbar dataset={dataset} busy={busy} searchOpen={searchOpen} onSearch={toggleSearch} searchRef={searchToggleRef}/>:dataset==='saleQuery'?<SaleQueryToolbar busy={busy} searchOpen={searchOpen} onSearch={toggleSearch} searchRef={searchToggleRef}/>:['discount','buyDisc'].includes(dataset)?<DiscountToolbar dataset={dataset} busy={busy} searchOpen={searchOpen} onSearch={toggleSearch} searchRef={searchToggleRef}/>:dataset==='poQuery'?<PurchaseOrderToolbar busy={busy} searchOpen={searchOpen} onSearch={toggleSearch} searchRef={searchToggleRef}/>:['receipt','payment'].includes(dataset)?null:dataset==='buyStatus'?null:dataset==='purchase'?<PurchaseToolbar busy={busy} searchOpen={searchOpen} onSearch={toggleSearch} searchRef={searchToggleRef}/>:dataset==='quote'?<QuoteToolbar busy={busy} searchOpen={searchOpen} onSearch={toggleSearch} searchRef={searchToggleRef} status={quoteStatus} canFilterInProgress={!!version?.rows?.some(row=>row.quoteStatus==='in_progress'&&['row_cell','query_filter'].includes(row.statusEvidence))} canFilterCompleted={!!version?.rows?.some(row=>row.quoteStatus==='completed'&&['row_cell','query_filter'].includes(row.statusEvidence))} onStatus={setQuoteStatus}/>:<ResultToolbar dataset={dataset} busy={busy} searchOpen={searchOpen} onSearch={toggleSearch} searchRef={searchToggleRef}/>}
        {searchOpen&&(dataset==='stkBalance'?<StockBalanceSearchPanel busy={busy} asOf={searchDraft.from} inputRef={searchInputRef} onDate={date=>setSearchDraft(value=>({...value,from:date,to:date}))} onSubmit={runSearch} onToday={()=>applyObservedPreset('today')}/>:dataset==='stkLedger'?<StockLedgerSearchPanel productCode={ledgerProductDraft} onProduct={()=>setDialog('ledger-product')} busy={busy} {...searchDraft} inputRef={searchInputRef} onFrom={from=>setSearchDraft(value=>({...value,from}))} onTo={to=>setSearchDraft(value=>({...value,to}))} onSubmit={runSearch} onToday={()=>applyObservedPreset('today')}/>:dataset==='stockMove'?<StockMovementSearchPanel busy={busy} {...searchDraft} inputRef={searchInputRef} onFrom={from=>setSearchDraft(value=>({...value,from}))} onTo={to=>setSearchDraft(value=>({...value,to}))} onSubmit={runSearch} onToday={()=>applyObservedPreset('today')}/>:dataset==='whStock'?<WarehouseStockSearchPanel busy={busy} asOf={searchDraft.from} inputRef={searchInputRef} onDate={date=>setSearchDraft(value=>({...value,from:date,to:date}))} onSubmit={runSearch} onToday={()=>applyObservedPreset('today')} mode={warehouseMode} onMode={setWarehouseMode} warehouseCodes={warehouseDraft} onWarehouse={()=>setDialog('warehouse')}/>:dataset==='buyTaxStat'?<PurchaseTaxStatusSearchPanel busy={busy} canQuery={!!version} {...searchDraft} inputRef={searchInputRef} onFrom={from=>setSearchDraft(value=>({...value,from}))} onTo={to=>setSearchDraft(value=>({...value,to}))} onSubmit={runSearch} onToday={()=>applyObservedPreset('today')}/>:dataset==='taxStat'?<SalesTaxStatusSearchPanel busy={busy} canQuery={!!version} {...searchDraft} inputRef={searchInputRef} onFrom={from=>setSearchDraft(value=>({...value,from}))} onTo={to=>setSearchDraft(value=>({...value,to}))} onSubmit={runSearch} onToday={()=>applyObservedPreset('today')}/>:dataset==='stock'?<StockSearchPanel busy={busy} asOf={searchDraft.from} inputRef={searchInputRef} onDate={date=>setSearchDraft(value=>({...value,from:date,to:date}))} onSubmit={runSearch} onToday={()=>applyObservedPreset('today')}/>:['salesTax','buyTax','taxStat','buyTaxStat'].includes(dataset)?<TaxSearchPanel dataset={dataset} canQuery={!!version} busy={busy} {...searchDraft} inputRef={searchInputRef} onFrom={from=>setSearchDraft(value=>({...value,from}))} onTo={to=>setSearchDraft(value=>({...value,to}))} onSubmit={runSearch} onToday={()=>applyObservedPreset('today')}/>:dataset==='journal'?<JournalSearchPanel busy={busy} {...searchDraft} inputRef={searchInputRef} onFrom={from=>setSearchDraft(value=>({...value,from}))} onTo={to=>setSearchDraft(value=>({...value,to}))} onSubmit={runSearch} onToday={()=>applyObservedPreset('today')}/>:dataset==='poStat'?<PoStatusSearchPanel inputRef={searchInputRef} mode={poReportMode} onMode={setPoReportMode} aggregateCondition={poAggregateCondition} onConditionLookup={()=>setDialog('po-aggregate')}/>:dataset==='orderQuery'?<OrderQuerySearchPanel inputRef={searchInputRef}/>:dataset==='orderStat'?<OrderStatusSearchPanel mode={orderReportMode} onMode={setOrderReportMode} inputRef={searchInputRef} aggregateCondition={orderAggregateCondition} onConditionLookup={()=>setDialog('order-aggregate')}/>:dataset==='quoteStat'?<QuoteStatusSearchPanel mode={quoteReportMode} onMode={setQuoteReportMode} inputRef={searchInputRef}/>:['unsold','unbought'].includes(dataset)?<UnfulfilledSearchPanel dataset={dataset} inputRef={searchInputRef}/>:dataset==='saleQuery'?<SaleQuerySearchPanel busy={busy} {...searchDraft} inputRef={searchInputRef} onFrom={from=>setSearchDraft(value=>({...value,from}))} onTo={to=>setSearchDraft(value=>({...value,to}))} onSubmit={runSearch} onToday={()=>applyObservedPreset('today')}/>:['discount','buyDisc'].includes(dataset)?<DiscountSearchPanel dataset={dataset} inputRef={searchInputRef}/>:dataset==='poQuery'?<PurchaseOrderSearchPanel busy={busy} {...searchDraft} inputRef={searchInputRef} onFrom={from=>setSearchDraft(value=>({...value,from}))} onTo={to=>setSearchDraft(value=>({...value,to}))} onSubmit={runSearch} onToday={()=>applyObservedPreset('today')}/>:['receipt','payment'].includes(dataset)?<SettlementSearchPanel dataset={dataset} busy={busy} {...searchDraft} inputRef={searchInputRef} onFrom={from=>setSearchDraft(value=>({...value,from}))} onTo={to=>setSearchDraft(value=>({...value,to}))} onSubmit={runSearch} onPreset={applyObservedPreset}/>:dataset==='buyStatus'?<PurchaseStatusSearchPanel busy={busy} {...searchDraft} inputRef={searchInputRef} onFrom={from=>setSearchDraft(value=>({...value,from}))} onTo={to=>setSearchDraft(value=>({...value,to}))} onSubmit={runSearch} onToday={()=>applyObservedPreset('today')}/>:dataset==='purchase'?<PurchaseSearchPanel busy={busy} {...searchDraft} inputRef={searchInputRef} onFrom={from=>setSearchDraft(value=>({...value,from}))} onTo={to=>setSearchDraft(value=>({...value,to}))} onSubmit={runSearch} onToday={()=>applyObservedPreset('today')} onCustomer={()=>setDialog('purchase-customer')}/>:dataset==='quote'?<QuoteSearchPanel busy={busy} {...searchDraft} inputRef={searchInputRef} onFrom={from=>setSearchDraft(value=>({...value,from}))} onTo={to=>setSearchDraft(value=>({...value,to}))} onSubmit={runSearch}/>:<SearchPanel dataset={dataset} busy={busy} {...searchDraft} inputRef={searchInputRef} onFrom={from=>setSearchDraft(value=>({...value,from}))} onTo={to=>setSearchDraft(value=>({...value,to}))} onFlow={flow=>setSearchDraft(value=>({...value,flow}))} onQuery={query=>setSearchDraft(value=>({...value,query}))} onSubmit={runSearch} onPreset={applyObservedPreset} onCustomer={()=>setDialog('customer')}/>)}
        {['receipt','payment','buyStatus','poStat'].includes(dataset)&&<h2 className={styles.settlementTitle}>{{receipt:'수금현황',payment:'지급현황',buyStatus:'구매현황',poStat:'발주서현황'}[dataset]}</h2>}
        {!['receipt','payment','buyStatus','saleQuery','taxStat','buyTaxStat'].includes(dataset)&&workspaceActions}
        {busy && <p role="status">처리 중…</p>}
        {['taxStat','buyTaxStat'].includes(dataset)&&<h2 className={styles.settlementTitle}>{dataset==='buyTaxStat'?'매입청구서현황':'매출청구서현황'}</h2>}
        {version && !['stock','whStock','stkBalance'].includes(dataset)&& <p className={`${styles.period} ${dataset==='purchase'?styles.purchasePeriod:''}`}>조회기간 {(filterFrom||filterTo?filterFrom:version.periodFrom)||'미지정'} ~ {(filterFrom||filterTo?filterTo:version.periodTo)||'미지정'}</p>}
        {dataset==='quote'&&quoteStatus!=='all'&&filtered.excludedUnknownStatusCount>0&&<p role="status" className={styles.period}>진행상태가 확인되지 않은 자료는 현재 상태 검색에서 제외됩니다.</p>}
        {filtered.unknownDateCount>0&&<p role="status" className={styles.period}>일자가 없는 합계·미상일자 행은 기간 검색에서 제외됩니다.</p>}
        {['taxStat','buyTaxStat'].includes(dataset)&&version&&<p role="status" className={styles.period}>업로드 자료의 날짜 조건만 적용되며 승인 상태는 확인되지 않았습니다.</p>}
        {['stock','whStock','stkBalance'].includes(dataset)&&<p className={styles.period}>기준일자 {filterFrom||version?.periodFrom||'미지정'}</p>}
        <Table rows={rows} dataset={dataset} warehouseMode={warehouseMode} dataState={busy?'loading':(error||filtered.filterError)?'unavailable':version&&!filtered.snapshotUnavailable?'loaded':'uncollected'} quoteReportMode={quoteReportMode} orderReportMode={orderReportMode} orderAggregateCondition={orderAggregateCondition} poReportMode={poReportMode} poAggregateCondition={poAggregateCondition} />
        {dataset==='stkBalance'?<StockBalanceFooter busy={busy}/>:dataset==='stkLedger'?<StockLedgerFooter busy={busy}/>:dataset==='stockMove'?<StockMovementFooter busy={busy}/>:dataset==='whStock'?<WarehouseStockFooter/>:dataset==='buyTaxStat'?<PurchaseTaxStatusFooter busy={busy}/>:dataset==='taxStat'?<SalesTaxStatusFooter busy={busy}/>:dataset==='buyTax'?<PurchaseTaxFooter busy={busy}/>:dataset==='stock'?<StockFooter/>:dataset==='salesTax'?<SalesTaxFooter/>:dataset==='journal'?<JournalFooter busy={busy}/>:dataset==='poStat'?<PoStatusFooter busy={busy}/>:dataset==='orderQuery'?<OrderQueryFooter busy={busy}/>:dataset==='orderStat'?<OrderStatusFooter busy={busy}/>:dataset==='quoteStat'?<QuoteStatusFooter busy={busy}/>:['unsold','unbought'].includes(dataset)?<UnfulfilledFooter dataset={dataset} busy={busy}/>:dataset==='saleQuery'?<SaleQueryFooter busy={busy}/>:['discount','buyDisc'].includes(dataset)?<DiscountFooter dataset={dataset} busy={busy}/>:dataset==='poQuery'?<PurchaseOrderFooter busy={busy}/>:['receipt','payment'].includes(dataset)?<SettlementFooter dataset={dataset} busy={busy} onPreview={!version?undefined:openSalesPreview}/>:dataset==='buyStatus'?<PurchaseStatusFooter busy={busy} onPreview={!version?undefined:openSalesPreview}/>:dataset==='purchase'?<PurchaseFooter busy={busy}/>:dataset==='quote'?<QuoteFooter/>:<ResultFooter dataset={dataset} busy={busy} onMapping={()=>setDialog('mapping')} onPreview={!version?undefined:openSalesPreview}/>}
        {['receipt','payment','buyStatus','saleQuery','taxStat','buyTaxStat'].includes(dataset)&&workspaceActions}
      </> : <><div className={styles.sectionLinks} onKeyDown={arrowFocus}>{MENUS.filter(menu=>menu.parentId===menuId).map(menu=><button key={menu.id} onClick={()=>selectMenu(menu.id)}>{menu.label}</button>)}</div>{!feature?.hasChildren&&<p className={styles.empty}>이 화면은 아직 준비 중입니다.</p>}</>}
    </section>}
    {dialog==='ledger-product'&&dataset==='stkLedger'&&<ProductLookupOverlay rows={version?.rows||[]} selected={ledgerProductDraft?[ledgerProductDraft]:[]} onClose={closeDialog} onApply={codes=>{setLedgerProductDraft(codes[0]||'');closeDialog();}}/>}
    {dialog==='ledger-notice'&&dataset==='stkLedger'&&<EcountWorkspaceDialog title="알림" busy={busy} onClose={()=>{setLedgerPending(null);setSearchOpen(true);closeDialog();}}><p>품목개수가 많을 경우 검색시간이 오래 걸릴 수 있습니다. 조회품목을 재지정하겠습니까?</p><footer><button type="button" onClick={()=>{setLedgerPending(null);setSearchOpen(true);closeDialog();}} data-ecount-action-id={actionId('stkLedger','확인','조회품목 재지정 알림')}>확인</button><button type="button" onClick={()=>{const pending=ledgerPending;setLedgerPending(null);closeDialog();if(pending)runSearch(pending,true);}} data-ecount-action-id={actionId('stkLedger','취소','조회품목 재지정 알림')}>취소</button></footer></EcountWorkspaceDialog>}
    {dialog==='warehouse'&&dataset==='whStock'&&<WarehouseLookupOverlay rows={version?.rows||[]} selected={warehouseDraft} onClose={closeDialog} onApply={codes=>{setWarehouseDraft(codes);closeDialog();}}/>}
    {dialog==='order-aggregate'&&<OrderAggregateLookup onNewWindow={()=>openLookupWindow('orderStat')} onClose={closeDialog} onDaily={()=>{setOrderAggregateCondition('daily');closeDialog();}}/>}
    {dialog==='po-aggregate'&&<PoAggregateLookup onNewWindow={()=>openLookupWindow('poStat')} onClose={closeDialog} onDaily={()=>{setPoAggregateCondition('daily');closeDialog();}}/>}
    {dialog==='purchase-customer'&&<CustomerLookupOverlay dataset="purchase" context="거래처 검색 오버레이" onClose={closeDialog}/>}
    {dialog==='customer'&&<CustomerLookupOverlay onClose={closeDialog}/>}
    {dialog==='mapping'&&<MappingOverlay onClose={closeDialog}/>}
    {dialog && !['ledger-product','ledger-notice','warehouse','mapping','customer','purchase-customer','po-aggregate','order-aggregate'].includes(dialog) && <EcountWorkspaceDialog title={dialog==='upload'?'자료 업로드':dialog==='source'?'수집 자료 불러오기':'작업 이력'} busy={busy} onClose={closeDialog}>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {dialog==='upload' && <>
        <p>파일의 자료를 이카운트 전용 SQL 작업 영역에 새 버전으로 저장합니다. 개인정보·계좌번호·자유기재 열은 제외됩니다.</p>
        <label className={styles.field}>파일 <input type="file" accept=".csv,.xlsx" onChange={readFile} disabled={busy}/></label>
        {upload && <><label className={styles.field}>시트 <select value={sheet} disabled={busy} onChange={event=>setSheet(event.target.value)}>{upload.names.map(name=><option key={name}>{name}</option>)}</select></label><Table rows={(upload.sheets[sheet] || []).slice(0,10)} dataset={dataset}/></>}
        <div className={styles.filters}><label>시작일 <input type="date" value={periodFrom} disabled={busy} onChange={event=>setPeriodFrom(event.target.value)}/></label><label>종료일 <input type="date" value={periodTo} disabled={busy} onChange={event=>setPeriodTo(event.target.value)}/></label></div>
        <footer><button disabled={busy} onClick={closeDialog}>취소</button><button className={styles.primary} disabled={busy||!upload?.sheets[sheet]?.length||(Boolean(periodFrom)!==Boolean(periodTo))||(periodFrom&&periodTo&&periodFrom>periodTo)} onClick={()=>mutate({action:'import',reasonCode:'IMPORT',rows:upload.sheets[sheet],periodFrom:periodFrom||null,periodTo:periodTo||null})}>작업 영역에 저장</button></footer>
      </>}
      {dialog==='source' && <><p>이미 수집된 최신 자료를 별도 SQL 작업 영역에 새 버전으로 불러옵니다. 이카운트에는 접속하거나 입력하지 않습니다.</p><footer><button disabled={busy} onClick={closeDialog}>취소</button><button className={styles.primary} disabled={busy} onClick={()=>mutate({action:'import-latest',reasonCode:'IMPORT'})}>불러오기</button></footer></>}
      {dialog==='history' && <>
        <div className={styles.tableWrap}><table><thead><tr><th>선택</th><th>저장시각</th><th>기간</th><th>원천</th></tr></thead><tbody>{history.map(item=><tr key={item.versionId}><td><input type="radio" name="version" aria-label={`${item.createdAt} 자료 선택`} checked={rollbackId===item.versionId} disabled={busy||item.versionId===version?.versionId} onChange={()=>setRollbackId(item.versionId)}/>{item.versionId===version?.versionId?' 현재':''}</td><td>{item.createdAt}</td><td>{item.periodFrom||'미지정'} ~ {item.periodTo||'미지정'}</td><td>{item.sourceKind}</td></tr>)}</tbody></table></div>
        {!history.length&&<p>저장된 작업 이력이 없습니다.</p>}{audit.length>0&&<><h3>변경 이력</h3><div className={styles.tableWrap}><table><thead><tr><th>시각</th><th>작업</th><th>사유</th></tr></thead><tbody>{audit.map(item=><tr key={item.revision}><td>{item.createdAt}</td><td>{{import:'파일 자료 저장','import-latest':'수집 자료 저장',activate:'이전 버전 복원'}[item.action]||item.action}</td><td>{{IMPORT:'자료 가져오기',ROLLBACK:'이전 작업으로 되돌리기',CORRECTION:'자료 정정'}[item.reasonCode]||item.reasonCode}</td></tr>)}</tbody></table></div></>}
        <label className={styles.field}>복원 사유 <select value={reasonCode} disabled={busy} onChange={event=>setReasonCode(event.target.value)}><option value="ROLLBACK">이전 작업으로 되돌리기</option></select></label>
        <p>선택한 버전을 현재 작업 자료로 지정합니다. 기존 버전과 이력은 유지됩니다.</p>
        <footer><button disabled={busy} onClick={closeDialog}>닫기</button><button disabled={busy||!rollbackId} onClick={()=>mutate({action:'activate',versionId:rollbackId,reasonCode})}>선택한 자료로 복원</button></footer>
      </>}
    </EcountWorkspaceDialog>}
  </div></ActionScope>;
}
