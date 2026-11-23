import {useEffect,useState} from 'react';
import InvoiceTotalEvidence from './InvoiceTotalEvidence.js';
import {RECEIPT_COMPARE_FIELDS,receiptComparisonFocus,receiptComparisonValues} from '../../lib/invoiceReceiptComparison.js';
import styles from '../../styles/InvoiceReceipt.module.css';
import WorkflowGuide from '../WorkflowGuide.js';

export default function InvoiceReceiptComparison({file,document,productByKey,onReady,sourceOnly=false}) {
 const [focus,setFocus]=useState(null);
 useEffect(()=>setFocus(null),[file,document.documentId,document.sourceHash,document.revision,document.orderYear,document.orderWeek]);
 const totals=document.rawMetadata?.metadataEvidence || document.rawMetadata?.reviewEvidence || {};
 const format=value=>value==null?'미기재':typeof value==='number'?value.toLocaleString('ko-KR',{maximumFractionDigits:6}):String(value);
 return <div className={styles.receiptCompare} aria-label="원본과 입고 예정 수량 대조">
  {!sourceOnly&&<div className={styles.compareGuide}><WorkflowGuide workflowId="receipt-source-comparison" initialRole="수입부"/></div>}
  <div className={styles.compareSource}><InvoiceTotalEvidence file={file} evidence={totals.invoice_total||totals.total_value} focus={focus} onReady={onReady}/></div>
  <section className={styles.compareValues} aria-label="품목별 입고 예정값">
   <h3>{sourceOnly?'원본 품목·수량·금액':'원본과 입고 예정값'}</h3><p>수량·단가·금액 버튼을 누르면 원본 품목행을 확대합니다. 미기재는 0이 아닙니다.</p>
   <button type="button" onClick={()=>setFocus(null)}>원본 총금액 보기</button>
   <div className={styles.compareTableScroll}><table><thead><tr><th>{sourceOnly?'원본 품목':'원본 → 전산 품목'}</th>{RECEIPT_COMPARE_FIELDS.map(([key,label])=><th key={key}>{label}</th>)}</tr></thead>
    <tbody>{document.lines.map(line=><tr key={line.lineId} className={focus?.key.startsWith(`${line.lineId}:`)?styles.compareSelected:undefined}>
     <th scope="row"><button type="button" onClick={()=>setFocus(receiptComparisonFocus(line,'description'))}>{line.lineNo} · {line.originalName}{line.sourceEvidence?.sourceVariety&&<small>Variety: {line.sourceEvidence.sourceVariety}</small>}</button><small>{sourceOnly?`Units (원문): ${format(line.printedUnits)}`:productByKey?.get(Number(line.prodKey))?.ProdName||'전산 품목 미선택'}</small></th>
     {RECEIPT_COMPARE_FIELDS.map(([key,label])=>{
      const v=receiptComparisonValues(line,key,document.rawMetadata?.currency);
      const money=key==='unitPrice'||key==='lineAmount';
      const show=(value,currency,unit)=>[format(value),money?(currency||'통화 미확인'):null,key==='unitPrice'?(unit||'가격 기준 단위 미확인'):null].filter(Boolean).join(' · ');
      return <td key={key}><button type="button" aria-pressed={focus?.key===`${line.lineId}:${key}`} aria-label={`${line.lineNo}행 ${label} ${format(line[key]??v.printed)} 원본 대조`} onClick={()=>setFocus(receiptComparisonFocus(line,key))}>원본 {show(v.printed,v.sourceCurrency,v.sourceUnit)}</button>
      {!sourceOnly&&<small>예정 {show(v.planned,v.plannedCurrency,v.plannedUnit)}</small>}</td>;
     })}
    </tr>)}</tbody></table></div>
   {!sourceOnly&&<p>틀린 값은 아래 ‘닫기 · 입력값 유지’로 돌아가 수정하세요. 이 창을 열거나 확대하는 것만으로 입고되지 않습니다.</p>}
  </section>
 </div>;
}
