import {useState} from 'react';
import {chinaInvoiceSheetList,reviewCloudChinaSheet,validateCloudMatchReview} from '../../lib/chinaInvoiceSheetReview.js';
import {parseChinaInvoiceWorkbook} from '../../lib/importChinaInvoice.js';
import InvoiceReceiptProductPicker from './InvoiceReceiptProductPicker.js';

const display=value=>value==null||value===''?'미기재':String(value);

export default function ChinaInvoiceSheetReview({xlsx,source,onContinue,onCancel,products=[]}) {
  const [selected,setSelected]=useState('');
  const [confirmed,setConfirmed]=useState(null);
  const [error,setError]=useState('');
  const [review,setReview]=useState({});
  const [reason,setReason]=useState('');
  const [approved,setApproved]=useState(null);
  const [matches,setMatches]=useState({});
  const [batchUnit,setBatchUnit]=useState('');
  const tabs=chinaInvoiceSheetList(source.book);
  const preview=selected?reviewCloudChinaSheet(xlsx,source.book,selected):null;
  function verify(){
    setError(''); setConfirmed(null);
    try {
      const parsed=parseChinaInvoiceWorkbook(xlsx,source.base64,{sheetName:selected});
      const result=JSON.parse(parsed.content[0].text);
      if(result.invoices.length!==1)throw Error('선택한 송장 1건을 확인하지 못했습니다.');
      setConfirmed(result.invoices[0]);
    }catch(e){setError(e.message);}
  }
  return <section aria-label="중국 XLSX 시트 선택">
    <h3>중국 XLSX 원본 시트 확인</h3>
    <p>{source.file.name} · 시트를 직접 선택하세요. 숨김과 빈 시트는 매칭 대상으로 선택할 수 없습니다.</p>
    <label>원본 시트 <select value={selected} onChange={e=>{setSelected(e.target.value);setConfirmed(null);setError('');setReview({});setApproved(null);setMatches({});setReason('');setBatchUnit('');}}>
      <option value="">시트 선택</option>
      {tabs.map(tab=><option key={tab.name} value={tab.name} disabled={tab.hidden||tab.empty}>{tab.name}{tab.hidden?' · 숨김':''}{tab.empty?' · 빈 시트':''}</option>)}
    </select></label>
    {preview&&<>
      <p>{preview.headerRow}행 헤더 · {preview.totalRow}행 TOTAL · {preview.currency} {display(preview.printedTotal)} · 행 합계 {display(preview.summed)} · 차이 {display(preview.difference)}</p>
      <div style={{overflowX:'auto'}}><table>
        <thead><tr>{['원본 행','품목','규격','수량 (단위 미기재)','단가 (기준 단위 미기재)','Packing fee','행 금액 (CNY)','검증'].map(label=><th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{preview.rows.map(row=><tr key={row.row}>{[row.row,row.item,row.specification,row.quantity,row.unitPrice,row.packing,row.amount,row.amountCheck].map((v,i)=><td key={i}>{display(v)}</td>)}</tr>)}</tbody>
      </table></div>
      <p>원본에는 수량·가격 기준 단위가 없습니다. 수량을 환산하지 않으며, 매칭은 이 화면에서만 검토합니다. 입고 저장은 지원하지 않습니다.</p>
      <label>소계 앞 상품행에 적용할 수량·가격 단위 <select value={batchUnit} onChange={e=>setBatchUnit(e.target.value)}><option value="">선택</option>{['박스','단','송이'].map(u=><option key={u}>{u}</option>)}</select></label>
      <button type="button" disabled={!batchUnit||!preview.rows.some(r=>r.subtotal)} onClick={()=>{
        const subtotal=preview.rows.find(r=>r.subtotal);
        setApproved(null);setMatches({});
        setReview(previous=>({...previous,...Object.fromEntries(preview.rows.filter(r=>r.row<subtotal.row)
          .map(r=>[r.row,{kind:'goods',quantityUnit:batchUnit,priceUnit:batchUnit}]))}));
      }}>소계 앞 상품행에 선택 단위 적용</button>
      <label>분류·단위 확인 근거 <input value={reason} onChange={e=>{setReason(e.target.value);setApproved(null);setMatches({});}}/></label>
      <div style={{overflowX:'auto'}}><table><thead><tr>{['원본 행','구분','수량 단위','가격 기준','전산 품목'].map(t=><th key={t}>{t}</th>)}</tr></thead><tbody>
      {preview.rows.filter(r=>!r.subtotal).map(row=>{
        const value=review[row.row]||{};
        const set=(field,next)=>{setApproved(null);setMatches({});setReview(old=>({...old,[row.row]:{...old[row.row],[field]:next}}));};
        return <tr key={row.row}><th scope="row">{row.row} · {row.item}</th>
          <td><select aria-label={`${row.row}행 구분`} value={value.kind||''} onChange={e=>set('kind',e.target.value)}><option value="">선택</option><option value="goods">상품</option><option value="charge">별도 비용</option></select></td>
          {['quantityUnit','priceUnit'].map((field,i)=><td key={field}><select disabled={value.kind!=='goods'} aria-label={`${row.row}행 ${i?'가격 기준':'수량 단위'}`} value={value[field]||''} onChange={e=>set(field,e.target.value)}><option value="">선택</option>{['박스','단','송이'].map(u=><option key={u}>{u}</option>)}</select></td>)}
          <td>{approved&&value.kind==='goods'&&<InvoiceReceiptProductPicker products={products} product={matches[row.row]} label={`${row.row}행 전산 품목 검색`} onSelect={p=>setMatches(old=>({...old,[row.row]:p}))}/>}</td></tr>;
      })}</tbody></table></div>
      <button type="button" onClick={()=>{
        const result=validateCloudMatchReview(preview,review,reason);setError(result.issues.join(' '));
        setApproved(result.issues.length?null:result);setMatches({});
      }}>원본 대조 확인 · 품목 매칭 열기</button>
      {approved&&<p role="status">상품 {approved.goods.length}행 · 별도 비용 {approved.charges.length}행 · 품목 선택 {Object.keys(matches).length}/{approved.goods.length}행</p>}
    </>}
    {!preview&&selected&&<button type="button" onClick={verify}>선택한 시트 검증</button>}
    {error&&<p role="alert">{error}</p>}
    {confirmed&&<>
      <p role="status">{selected} 서식 검증 완료 · 송장 {display(confirmed.invoice)} · 원본 통화 {display(confirmed.currency)} · 총액 {display(confirmed.invoice_total)}</p>
      <div style={{overflowX:'auto'}}><table><thead><tr>{['원본 행','품목','박스','단','송이','원문 단가','행 금액'].map(label=><th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{(confirmed.products||[]).map((row,i)=><tr key={i}>{[row.source_row,row.description,row.pcs,row.total_bunch,row.total_stems,row.u_price,row.t_price].map((v,j)=><td key={j}>{display(v)}</td>)}</tr>)}</tbody>
      </table></div>
      <button type="button" onClick={()=>onContinue(selected)}>이 시트로 매칭</button>
    </>}
    <button type="button" onClick={onCancel}>취소</button>
  </section>;
}
