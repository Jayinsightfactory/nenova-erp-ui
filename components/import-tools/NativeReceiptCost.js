import React, { useEffect, useRef, useState } from 'react';
import { auInvoiceTariffDefault } from '../../lib/auInvoiceTariffDefaults.js';
import InvoiceReceiptCostReview from './InvoiceReceiptCostReview';
import styles from '../../styles/NativeReceiptCost.module.css';

export default function NativeReceiptCost({ orderYear, orderWeek, warehouseKey, onClose }) {
  const [data, setData] = useState(null), [error, setError] = useState('');
  const [metadata, setMetadata] = useState({ currency: '', transportMode: '', gw: '', cw: '' });
  const [applied, setApplied] = useState(null);
  const active = useRef(true), generation = useRef(0);
  function updateMetadata(key, value) { generation.current++; setMetadata(v => ({ ...v, [key]: value })); }
  useEffect(() => {
    const abort = new AbortController(); active.current = true; generation.current++;
    setData(null); setApplied(null); setError('');
    fetch(`/api/import/receipts/native-cost?${new URLSearchParams({ orderYear, orderWeek, warehouseKey })}`, { cache: 'no-store', signal: abort.signal })
      .then(async response => { const value = await response.json(); if (!response.ok || !value.success) throw new Error(value.error || '입고 조회 실패'); return value; })
      .then(value => { if (!abort.signal.aborted) { setData(value); setMetadata({ currency: '', transportMode: '', gw: value.source.gw ?? '', cw: value.source.cw ?? '' }); } })
      .catch(e => { if (!abort.signal.aborted) setError(e.message); });
    return () => { active.current = false; generation.current++; abort.abort(); };
  }, [orderYear, orderWeek, warehouseKey]);
  async function action(action, input) {
    const expected = generation.current;
    const response = await fetch('/api/import/receipts/native-cost', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderYear, orderWeek, warehouseKey, sourceHash: data.source.sourceHash, metadata: applied, action, input }) });
    if (!response.ok) { const value = await response.json(); throw new Error(value.error || '계산 실패'); }
    if (action === 'preview') return response.json();
    const blob = await response.blob();
    if (!active.current || expected !== generation.current) return;
    const url = URL.createObjectURL(blob), link = window.document.createElement('a');
    link.href = url; link.download = `도착원가_계산본_${orderYear}_${orderWeek}_${warehouseKey}.xlsx`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  let costDocument = null;
  if (data && applied && JSON.stringify(applied) === JSON.stringify(metadata)) {
    const lines = data.document.lines.map(line => ({ ...line, currency: applied.currency }));
    const tariffDefaults = Object.fromEntries(lines.map(line => [line.lineId, auInvoiceTariffDefault({
      ...data.document, reviewedMetadata: { ...data.document.reviewedMetadata, transportMode: applied.transportMode },
    }, { ProdKey: line.prodKey, ProdName: line.originalName, CounName: line.country === 'AU' ? '호주' : line.country, isDeleted: line.productDeleted })]).filter(([, value]) => value));
    costDocument = { ...data.document, lines, receiptLines: lines,
      reviewedMetadata: { ...data.document.reviewedMetadata, ...applied, tariffDefaults,
        gw: applied.gw === '' ? null : Number(applied.gw), cw: applied.cw === '' ? null : Number(applied.cw),
        invoiceCostInput: { ...data.document.reviewedMetadata.invoiceCostInput, nativeCurrency: applied.currency, freightCurrency: applied.currency,
          lineInputs: data.document.reviewedMetadata.invoiceCostInput.lineInputs.map(line => ({ ...line, ...(tariffDefaults[line.lineId] ? { tariffRate: tariffDefaults[line.lineId].tariffRate } : {}) })) } } };
  }
  return <section className={styles.panel} aria-label="기존 입고자료 원가 계산">
    <header className={styles.header}><div><small>입고자료로 바로 계산 · 원장 변경 없음</small><h3>{data?.source.farmName || '입고자료 조회'} <span>{orderYear} / {orderWeek}</span></h3>
      <p>송장 {data?.source.invoiceNo || '—'} · 입고 #{warehouseKey} · {data?.source.lines.length ?? '—'}품목</p></div><button type="button" onClick={onClose}>목록으로</button></header>
    {error && <p role="alert">{error}</p>}
    {!data && !error && <p role="status">전산 입고의 품목·수량·단가를 불러오는 중…</p>}
    {data && <>
      {data.source.country === 'AU' && <div role="status"><strong>호주 원가는 입고관리의 저장 총액(출하단가)을 기준으로 계산합니다.</strong>
        <p>CNF 단당 계산값 = 저장 총액 ÷ 단수. 입고의 원래 단가·총액은 변경하지 않습니다.</p>
        {data.document.lines.filter(line => line.nativePriceBasis && Math.abs(Number(line.nativeStoredUnitPrice) - line.unitPrice) > 0.000001).map(line =>
          <p key={line.lineId}>{line.originalName} · 저장 단가 {line.nativeStoredUnitPrice} · 저장 총액 {line.lineAmount} ÷ {line.bunchQuantity}단 = 원가 계산용 {line.unitPrice}/단</p>)}
      </div>}
      <form className={styles.metadata} onSubmit={event => { event.preventDefault(); generation.current++; setApplied({ ...metadata }); }}>
        <p>입고자료에 저장되지 않은 계산 기준만 확인하세요. 인보이스 파일은 필요하지 않습니다.</p>
        <label>매입 통화<select required value={metadata.currency} onChange={e => updateMetadata('currency', e.target.value)}><option value="">통화 선택</option>{['USD','EUR','CNY','AUD','NZD','THB'].map(value => <option key={value}>{value}</option>)}</select></label>
        <label>운송 방식<select required value={metadata.transportMode} onChange={e => updateMetadata('transportMode', e.target.value)}><option value="">운송 선택</option><option value="AIR">항공</option><option value="SEA">해상</option></select></label>
        {['gw','cw'].map(key => <label key={key}>{key.toUpperCase()} (kg)<input type="number" min="0" step="any" value={metadata[key]} placeholder="중량 배분 공식에만 필요" onChange={e => updateMetadata(key, e.target.value)} /></label>)}
        <button type="submit">{applied ? '기준 변경 · 입력 초기화' : '부족한 비용 입력하기'}</button>
      </form>
      {data.source.excluded.length > 0 && <details><summary>상품 원가에서 분리한 운송·중량 행 {data.source.excluded.length}건</summary><p>아래 원장 행은 상품 수량에 합산하지 않습니다. 운임 입력에 포함할지 확인하세요.</p>{data.source.excluded.map(row => <p key={row.key}>{row.name} · 수량 {row.quantity ?? '미기재'} · 금액 {row.amount ?? '미기재'}</p>)}</details>}
      {costDocument && <InvoiceReceiptCostReview key={JSON.stringify(applied)} document={costDocument} nativePreview onNativeAction={action} />}
    </>}
  </section>;
}
