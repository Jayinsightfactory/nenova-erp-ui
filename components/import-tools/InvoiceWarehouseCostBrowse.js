import React, { useEffect, useRef, useState } from 'react';
import { downloadInvoiceCostExport, invoiceCostExportEligibility } from '../../lib/invoiceReceiptStageLogClient.js';
import styles from '../../styles/InvoiceReceipt.module.css';
import NativeReceiptCost from './NativeReceiptCost';
import { filterInvoiceWarehouses } from '../../lib/invoiceWarehouseBrowse.js';
import SharedAwbCostReview from './SharedAwbCostReview';
import ArrivalWeekCostReview from './ArrivalWeekCostReview';
import {baseCountry} from '../../lib/countryClassification.js';

export default function InvoiceWarehouseCostBrowse({ orderYear, orderWeek, invoiceNo, country }) {
  const scope = `${orderYear}/${orderWeek}/${invoiceNo ?? '*'}/${country??'*'}`;
  const live = useRef(scope); live.current = scope;
  const [state, setState] = useState({ rows: [], loading: true });
  const [action, setAction] = useState({ busy: false, error: '' });
  const lock = useRef(false);
  const [nativeKey, setNativeKey] = useState(null);
  const [selectionKeys,setSelectionKeys]=useState([]),[selectionRequest,setSelectionRequest]=useState(null);
  // 차수 통합이 기본이다. 기존 단일 AWB·개별 입고는 별도 선택으로 보존한다.
  const [showColombia, setShowColombia] = useState(false);
  const [sharedAwb,setSharedAwb]=useState('');
  const [individualCountry,setIndividualCountry]=useState('');
  useEffect(() => {
    setShowColombia(false);
    const controller = new AbortController();
    setState({ rows: [], loading: true }); setAction({ busy: false, error: '' });
    setNativeKey(null);
    setSelectionKeys([]);setSelectionRequest(null);
    fetch(`/api/import/receipts/warehouse-list?${new URLSearchParams({ orderYear, orderWeek })}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => { const data = await response.json(); if (!response.ok || !data.success || !Array.isArray(data.rows)) throw new Error(data.error || '조회 응답을 확인하지 못했습니다.'); return data; })
      .then(data => { if (!controller.signal.aborted) setState({ ...data, loading: false }); })
      .catch(error => { if (!controller.signal.aborted) setState({ rows: [], loading: false, error: error.message }); });
    return () => controller.abort();
  }, [orderYear, orderWeek, invoiceNo, country]);
  const rows = filterInvoiceWarehouses(state.rows, { orderYear, orderWeek }, invoiceNo).filter(row=>(!country||baseCountry(row.CountryName)===baseCountry(country))&&(!individualCountry||baseCountry(row.CountryName)===individualCountry));
  function nextSelection(){
    const selected=rows.filter(r=>selectionKeys.includes(r.WarehouseKey));
    if(selected.length===1&&selected[0].CostReferenceOnly){open(selected[0],false);return;}
    if(selected.some(r=>r.CostReferenceOnly)){setAction({busy:false,error:'운임·중량 참고자료는 상품 입고 선택에 합산하지 않습니다. 상품 입고만 선택하세요.'});return;}
    const countries=[...new Set(selected.map(r=>baseCountry(r.CountryName)))];
    if(selected.length===1&&!['중국','콜롬비아'].includes(countries[0])){setNativeKey(selected[0].WarehouseKey);return;}
    if(countries.length!==1||!['중국','콜롬비아'].includes(countries[0])){setAction({busy:false,error:'같은 국가의 중국 CLOUD 또는 콜롬비아 입고를 선택하세요. 다른 국가는 1건씩 계산할 수 있습니다.'});return;}
    setNativeKey(null);setAction({busy:false,error:''});setSelectionRequest({id:Date.now(),country:countries[0]==='중국'?'CN':'CO',keys:selected.map(r=>r.WarehouseKey)});
  }
  async function open(row, download) {
    if(!download&&row.CostReferenceOnly){
      const awb=String(row.OrderNo??'').replace(/[\s-]/g,'');
      const goods=state.rows.filter(r=>!r.CostReferenceOnly&&String(r.OrderNo??'').replace(/[\s-]/g,'')===awb&&baseCountry(r.CountryName)==='콜롬비아');
      setNativeKey(null);if(/^\d{11}$/.test(awb)&&goods.length){setSharedAwb(awb);setShowColombia(true);setAction({busy:false,error:''});}
      else setAction({busy:false,error:'이 입고는 운임·중량 참고자료이며 상품이 아닙니다. 해당 국가의 실제 상품 입고를 선택한 뒤 AWB 원문을 확인하세요.'});return;
    }
    if (!download) { setNativeKey(row.WarehouseKey); return; }
    if (lock.current) return;
    lock.current = true; const expected = scope; setAction({ busy: true, error: '' });
    try {
      const response = await fetch(`/api/warehouse/invoice-costs?warehouseKey=${encodeURIComponent(row.WarehouseKey)}`, { cache: 'no-store' });
      const data = await response.json();
      if (live.current !== expected) return;
      if (!response.ok || !data.success) throw new Error(data.error || '원가 연결을 확인하지 못했습니다.');
      const costs = data.costs;
      const eligibility = invoiceCostExportEligibility(null, costs?.currentActual);
      if (!eligibility.allowed) throw new Error(eligibility.message || '승인 원가가 없습니다. 입고자료로 원가 계산을 선택하면 계산본을 다운로드할 수 있습니다.');
      await downloadInvoiceCostExport(costs.currentActual, { isCurrent: () => live.current === expected });
    } catch (error) { if (live.current === expected) setAction({ busy: false, error: error.message }); }
    finally { lock.current = false; if (live.current === expected) setAction(value => ({ ...value, busy: false })); }
  }
  return <section className={styles.saved} aria-label="입고내역 도착원가 작업">
    <h3>{orderYear} / {orderWeek} 입고내역</h3>
    <p>인보이스 재연결 없이 입고자료로 계산합니다. 기존 입고·재고·승인 원가는 변경하지 않습니다.</p>
    <section aria-label="국가별 기존 원가 계산"><h3>국가별 도착원가 · 기존 공식</h3><p>네덜란드·중국·콜롬비아·에콰도르·미국·호주·뉴질랜드·태국·베트남은 아래 입고의 생성 버튼에서 기존 국가별 공식을 사용합니다. 중국 CLOUD A/B·콜롬비아 여러 입고는 별도 통합 계산을 사용합니다.</p><label>개별 원가 국가<select aria-label="개별 원가 국가" value={individualCountry} onChange={e=>{setIndividualCountry(e.target.value);setSelectionKeys([]);setNativeKey(null);}}><option value="">전체 국가</option>{['네덜란드','중국','콜롬비아','에콰도르','미국','호주','뉴질랜드','태국','베트남'].map(n=><option key={n}>{n}</option>)}</select></label></section>
    <ArrivalWeekCostReview orderYear={orderYear} orderWeek={orderWeek} selectionRequest={selectionRequest}/>
    {invoiceNo != null && <p>송장 {invoiceNo}의 기존 입고만 표시합니다. 현재 초안의 수정값은 사용하지 않습니다. 농장·송장을 확인하고 선택하세요.</p>}
    <p>입고는 여러 건을 선택한 뒤 다음을 누르세요. 체크만 하면 화면이 바뀌지 않습니다. 같은 국가·차수만 통합하며 개별 계산 버튼은 해당1건만 사용합니다.</p>
    <button type="button" disabled={!selectionKeys.length||state.loading||action.busy} onClick={nextSelection}>선택 {selectionKeys.length}건 다음 · 도착원가 작성</button>
    <button type="button" aria-expanded={showColombia} onClick={() => setShowColombia(value => !value)}>{showColombia ? 'AWB 업로드·공동 원가 접기' : 'AWB PDF 업로드·직접 입력 / 콜롬비아 공동 원가'}</button>
    {showColombia && <SharedAwbCostReview key={sharedAwb} native={{ orderYear, orderWeek, awb:sharedAwb }} />}
    {state.loading && <p role="status">입고내역 조회 중…</p>}
    {(state.error || action.error) && <p className={styles.error} role="alert">{state.error || action.error}</p>}
    {nativeKey ? <NativeReceiptCost key={`${scope}/${nativeKey}`} orderYear={orderYear} orderWeek={orderWeek} warehouseKey={nativeKey} onClose={() => setNativeKey(null)} /> : <div className={styles.savedList}>{rows.map(row => <div key={row.WarehouseKey}>
      <label><input type="checkbox" aria-label={`입고 ${row.WarehouseKey} 원가 선택`} checked={selectionKeys.includes(row.WarehouseKey)} onChange={e=>setSelectionKeys(current=>e.target.checked?[...current,row.WarehouseKey]:current.filter(k=>k!==row.WarehouseKey))}/>원가에 포함</label>
      <strong>{row.FarmName || '농장 미기재'} · {row.InvoiceNo || '송장번호 미기재'}</strong>
      {row.CostReferenceOnly&&<p>운임·중량 참고자료 · 상품 수량에 합산하지 않습니다. AWB {row.OrderNo||'미확인'}</p>}
      <p>입고 #{row.WarehouseKey} · {row.InputDate} · GW {row.GrossWeight ?? '미기재'} / CW {row.ChargeableWeight ?? '미기재'} kg</p>
      <button type="button" disabled={action.busy} onClick={() => open(row, false)}>도착원가 엑셀 생성·다운로드</button>{' '}
      <button type="button" disabled={action.busy} onClick={() => open(row, true)}>기존 승인 원가 다운로드</button>
    </div>)}</div>}
    {!state.loading && !state.error && !rows.length && <p>해당 연도·세부차수{invoiceNo != null ? '·송장' : ''}의 입고내역이 없습니다. 조회 조건을 확인하세요. 새 입고를 자동 등록하지 않습니다.</p>}
    {state.hasMore && <p>최신 500건까지 표시합니다. 입고관리에서 나머지 내역을 확인하세요.</p>}
  </section>;
}
