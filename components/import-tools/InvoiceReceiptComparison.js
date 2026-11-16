import {useEffect,useState} from 'react';
import InvoiceTotalEvidence from './InvoiceTotalEvidence.js';
import {RECEIPT_COMPARE_FIELDS,receiptComparisonFocus} from '../../lib/invoiceReceiptComparison.js';
import styles from '../../styles/InvoiceReceipt.module.css';
import WorkflowGuide from '../WorkflowGuide.js';

export default function InvoiceReceiptComparison({file,document,productByKey,onReady}) {
 const [focus,setFocus]=useState(null);
 useEffect(()=>setFocus(null),[file,document.documentId,document.sourceHash,document.revision,document.orderYear,document.orderWeek]);
 const totals=document.rawMetadata?.metadataEvidence || document.rawMetadata?.reviewEvidence || {};
 const format=value=>value==null?'미기재':Number(value).toLocaleString('ko-KR',{maximumFractionDigits:6});
 return <div className={styles.receiptCompare} aria-label="원본과 입고 예정 수량 대조">
  <div className={styles.compareGuide}><WorkflowGuide workflowId="receipt-source-comparison" initialRole="수입부"/></div>
  <div className={styles.compareSource}><InvoiceTotalEvidence file={file} evidence={totals.invoice_total||totals.total_value} focus={focus} onReady={onReady}/></div>
  <section className={styles.compareValues} aria-label="품목별 입고 예정값">
   <h3>입고 예정 품목·수량</h3><p>수량 버튼을 누르면 원본 품목행을 확대합니다. 미기재는 0이 아닙니다.</p>
   <button type="button" onClick={()=>setFocus(null)}>원본 총금액 보기</button>
   <table><thead><tr><th>원본 → 전산 품목</th>{RECEIPT_COMPARE_FIELDS.map(([key,label])=><th key={key}>{label}</th>)}</tr></thead>
    <tbody>{document.lines.map(line=><tr key={line.lineId} className={focus?.key.startsWith(`${line.lineId}:`)?styles.compareSelected:undefined}>
     <th scope="row"><button type="button" onClick={()=>setFocus(receiptComparisonFocus(line,'description'))}>{line.lineNo} · {line.originalName}</button><small>{productByKey?.get(Number(line.prodKey))?.ProdName||'전산 품목 미선택'}</small></th>
     {RECEIPT_COMPARE_FIELDS.map(([key,label])=><td key={key}><button type="button" aria-pressed={focus?.key===`${line.lineId}:${key}`} aria-label={`${line.lineNo}행 ${label} ${format(line[key])} 원본 대조`} onClick={()=>setFocus(receiptComparisonFocus(line,key))}>{format(line[key])}</button></td>)}
    </tr>)}</tbody></table>
   <p>틀린 값은 아래 ‘닫기 · 입력값 유지’로 돌아가 수정하세요. 이 창을 열거나 확대하는 것만으로 입고되지 않습니다.</p>
  </section>
 </div>;
}
