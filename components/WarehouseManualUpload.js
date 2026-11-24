import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Modal } from 'antd';
import { ReceiptProductSearch } from './IncomingCorrectionRequest.js';
import WarehouseFarmSelect from './WarehouseFarmSelect.js';
import { manualWarehouseLine, manualWarehouseMaxRows, manualWarehouseUnits } from '../lib/manualWarehouseUpload.js';
import styles from './WarehouseManualUpload.module.css';

const blankRow = id => ({ id, product: null, quantity: '', quantityUnit: '송이', stemsPerBox: '', stemsPerBunch: '', amountMode: 'total', amount: '' });
const number = value => value == null ? '—' : Number(value).toLocaleString('ko-KR',{maximumFractionDigits:10});

function requestLine(row) {
  const { product, quantity, quantityUnit, stemsPerBox, stemsPerBunch, amountMode, amount } = row;
  return { prodKey: product?.ProdKey, prodName: product?.ProdName, expectedOutUnit: product?.OutUnit?.trim(),
    expectedEstUnit: product?.EstUnit?.trim(), quantity, quantityUnit, stemsPerBox, stemsPerBunch, amountMode, amount };
}

async function readJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok || !body.success) throw Object.assign(new Error(body.error || '수기 입고 처리에 실패했습니다.'), { status: response.status, code:body.code, errors: body.errors });
  return body;
}

export default function WarehouseManualUpload({ initial, onClose, onSaved }) {
  const [header,setHeader] = useState({orderYear: initial.orderYear, orderWeek: initial.orderWeek, inputDate: initial.inputDate, farmName: '', invoiceNo: '', awb: ''});
  const [rows,setRows] = useState([blankRow(1)]);
  const [catalog,setCatalog] = useState({ farms: [], products: [], periods: [] });
  const [manualWeek,setManualWeek] = useState(false);
  const [loading,setLoading] = useState(true);
  const [status,setStatus] = useState('');
  const [error,setError] = useState('');
  const [preview,setPreview] = useState(null);
  const [recovery,setRecovery] = useState(false);
  const [confirmed,setConfirmed] = useState(false);
  const nextId = useRef(2);
  const busy = useRef(false);
  const isBusy = Boolean(status);

  useEffect(() => {
    const ctrl = new AbortController();
    const options = {signal: ctrl.signal};
    Promise.all([readJson('/api/warehouse?manualOptions=1',options),readJson('/api/products/search',options)])
      .then(([farmResult,productResult]) => {
        if(!ctrl.signal.aborted)setCatalog({farms:farmResult.farms,products:productResult.products,periods:farmResult.periods??[]});
      })
      .catch(issue => { if(!ctrl.signal.aborted)setError(issue.message); })
      .finally(() => { if(!ctrl.signal.aborted)setLoading(false); });
    return () => ctrl.abort();
  },[]);

  useEffect(() => {
    if (!recovery) return;
    const blockExit = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload',blockExit);
    return () => window.removeEventListener('beforeunload',blockExit);
  },[recovery]);

  function clearPreview() { setPreview(null); setConfirmed(false); setError(''); }
  function changeHeader(field,value) { clearPreview(); setHeader(current=>({...current,[field]:value})); }
  function changeYear(orderYear) {
    clearPreview();
    setManualWeek(false);
    setHeader(current=>({...current,orderYear,orderWeek:''}));
  }
  function changeRow(id,values) { clearPreview(); setRows(current=>current.map(row=>row.id===id?{...row,...values}:row)); }
  function close() { if (!busy.current && !recovery) onClose(); }

  async function process(performWrite) {
    if (busy.current) return;
    busy.current = true;
    setError('');
    setStatus(performWrite ? '원장 등록 및 재고 재계산 중' : '농장·품목·차수 검증 중');
    const payload = performWrite ? preview.payload
      : { ...header, source: 'manual', operationId: crypto.randomUUID(), items: rows.map(requestLine) };
    try {
      const result = await readJson('/api/warehouse',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...payload,previewOnly:!performWrite,...(performWrite?{previewToken:preview.previewToken}:{})})});
      if (result.warehouseKey) onSaved(result);
      else if (performWrite) throw new Error('서버 원장번호를 확인하지 못했습니다.');
      else {
        setConfirmed(false);
        setPreview({payload,previewToken:result.previewToken,lines:result.manualPreview});
      }
    } catch (issue) {
      const unknown = performWrite && (issue.code === 'STOCK_GATE_BUSY' && recovery || ![400,403,409].includes(issue.status));
      if (unknown) setRecovery(true);
      else if (performWrite) { setRecovery(false); setPreview(null); setConfirmed(false); }
      setError(unknown ? '등록 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인하세요.'
        : [issue.message,...(issue.errors ?? []).map(row=>`${row.row}행 ${row.error}`)].join(' · '));
    } finally {
      busy.current = false;
      setStatus('');
    }
  }

  return <Modal open title="수기 입고 업로드" width={1040} footer={null} onCancel={close} closable={!isBusy && !recovery}
    keyboard={!isBusy && !recovery} mask={{closable:false}} focusTriggerAfterClose>
    <div className={styles.dialog}>
      {loading && <p role="status">농장과 품목을 불러오는 중입니다.</p>}
      {error && <Alert type="error" showIcon message={error}/>}
      {status && <p role="status">{status}</p>}
      <fieldset disabled={loading || isBusy || recovery} className={styles.fields}>
        <legend>입고 정보</legend>
        <WarehouseFarmSelect farms={catalog.farms} value={header.farmName} onChange={value=>changeHeader('farmName',value)} label="입고 농장" placeholder="농장을 선택하세요"/>
        <div className={styles.header}>
          <label>연도<select aria-label="입고 연도" value={header.orderYear} onChange={event=>changeYear(event.target.value)}>
            {[...new Set([initial.orderYear,...catalog.periods.map(period=>String(period.OrderYear).trim())])].sort().reverse().map(year=><option key={year}>{year}</option>)}
          </select></label>
          <label>세부차수<select aria-label="입고 세부차수" value={manualWeek?'manual':header.orderWeek} onChange={event=>{
            const week=event.target.value;
            setManualWeek(week==='manual');
            changeHeader('orderWeek',week==='manual'?'':week);
          }}>
            <option value="">세부차수 선택</option>
            {catalog.periods.filter(period=>String(period.OrderYear).trim()===header.orderYear).map(period=>{
              const week=String(period.OrderWeek).trim();
              return <option key={week}>{week}</option>;
            })}
            <option value="manual">직접 입력</option>
          </select></label>
          {manualWeek && <label>세부차수 직접 입력<input placeholder="47-02" value={header.orderWeek} onChange={event=>changeHeader('orderWeek',event.target.value)} maxLength={5}/></label>}
          <label>실제 입고일<input type="date" value={header.inputDate} onChange={event=>changeHeader('inputDate',event.target.value)}/></label>
          <label>인보이스 번호<input value={header.invoiceNo} onChange={event=>changeHeader('invoiceNo',event.target.value)} maxLength={50}/></label>
          <label>AWB<input value={header.awb} onChange={event=>changeHeader('awb',event.target.value)} maxLength={50}/></label>
        </div>
      </fieldset>
      <fieldset disabled={loading || !header.farmName || isBusy || recovery} className={styles.fields}>
        <legend>입고 품목</legend>
        <p>원본 인보이스 통화로 금액을 입력하세요. 출고·견적 단위가 다르면 포장당 송이 수도 입력하세요.</p>
        {rows.map((row,index)=>{
          let line;
          try { if(row.product)line=manualWarehouseLine(requestLine(row),row.product); } catch {}
          return <fieldset className={styles.line} key={row.id}>
            <legend>{index+1}행</legend>
            <ReceiptProductSearch index={index} productName={row.product?.ProdName ?? ''} products={catalog.products}
              onSelect={(_,product)=>changeRow(row.id,{product})}/>
            {row.product && <p className={styles.unit}>전산 출고 {row.product.OutUnit} · 견적 {row.product.EstUnit}</p>}
            <div className={styles.header}>
              <label>입고 수량<input inputMode="decimal" aria-label={`${index+1}행 입고 수량`} value={row.quantity} onChange={event=>changeRow(row.id,{quantity:event.target.value})}/></label>
              <label>수량 단위<select value={row.quantityUnit} onChange={event=>changeRow(row.id,{quantityUnit:event.target.value})}>{manualWarehouseUnits.map(unit=><option key={unit}>{unit}</option>)}</select></label>
              <label>송이/단<input inputMode="numeric" aria-label={`${index+1}행 송이/단`} value={row.stemsPerBunch} onChange={event=>changeRow(row.id,{stemsPerBunch:event.target.value})}/></label>
              <label>송이/박스<input inputMode="numeric" aria-label={`${index+1}행 송이/박스`} value={row.stemsPerBox} onChange={event=>changeRow(row.id,{stemsPerBox:event.target.value})}/></label>
              <label>금액 기준<select value={row.amountMode} onChange={event=>changeRow(row.id,{amountMode:event.target.value})}><option value="total">행 금액</option><option value="perStem">송이당 단가</option></select></label>
              <label>{row.amountMode==='total'?'행 금액':'송이당 단가'}<input inputMode="decimal" aria-label={`${index+1}행 금액`} value={row.amount} onChange={event=>changeRow(row.id,{amount:event.target.value})}/></label>
            </div>
            <div className={styles.actions}>
              {line && <span>{number(line.boxQty)}박스 · {number(line.bunchQty)}단 · {number(line.steamQty)}송이 · 송이당 {number(line.unitPrice)} · 합계 {number(line.totalPrice)}</span>}
              <Button size="small" disabled={rows.length===1} onClick={()=>{clearPreview();setRows(current=>current.filter(item=>item.id!==row.id));}}>행 삭제</Button>
            </div>
          </fieldset>;
        })}
        <Button size="small" disabled={rows.length>=manualWarehouseMaxRows} onClick={()=>{clearPreview();setRows(current=>[...current,blankRow(nextId.current++)]);}}>품목 행 추가</Button>
      </fieldset>
      {preview && <section aria-label="수기 입고 검증 결과">
        <p role="status">서버 검증 통과 · {preview.payload.orderYear}년 {preview.payload.orderWeek} · {preview.lines.length}개 품목</p>
        <div className={styles.table} tabIndex={0} role="region" aria-label="등록 수량과 금액 미리보기">
          <table><thead><tr>{['품목','박스','단','송이','출고 수량','견적 수량','송이당 단가','행 금액'].map(field=><th key={field} scope="col">{field}</th>)}</tr></thead>
            <tbody>{preview.lines.map((line,index)=><tr key={preview.payload.items[index].prodKey+'-'+index}><th scope="row">{line.prodName}</th>
              <td>{number(line.boxQty)}</td><td>{number(line.bunchQty)}</td><td>{number(line.steamQty)}</td>
              <td>{number(line.outQuantity)}{line.outUnit}</td><td>{number(line.estQuantity)}{line.estUnit}</td>
              <td>{number(line.unitPrice)}</td><td>{number(line.totalPrice)}</td></tr>)}</tbody></table>
        </div>
      </section>}
      <div className={styles.actions}>
        {preview && !recovery && <label><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)} disabled={isBusy}/> 차수·농장·품목과 금액을 확인했고 입고를 등록합니다.</label>}
        <Button disabled={isBusy || recovery} onClick={close}>닫기</Button>
        <Button disabled={loading || !header.farmName || isBusy || recovery} onClick={()=>process(false)}>등록 미리보기</Button>
        <Button type="primary" disabled={!preview || !confirmed || isBusy} onClick={()=>process(true)}>{recovery?'같은 등록 결과 다시 확인':'입고 등록'}</Button>
      </div>
    </div>
  </Modal>;
}
