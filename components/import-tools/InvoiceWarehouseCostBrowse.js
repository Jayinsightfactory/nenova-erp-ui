import React, { useEffect, useRef, useState } from 'react';
import { downloadInvoiceCostExport, invoiceCostExportEligibility } from '../../lib/invoiceReceiptStageLogClient.js';
import styles from '../../styles/InvoiceReceipt.module.css';
import NativeReceiptCost from './NativeReceiptCost';

export default function InvoiceWarehouseCostBrowse({ orderYear, orderWeek }) {
  const scope = `${orderYear}/${orderWeek}`;
  const live = useRef(scope); live.current = scope;
  const [state, setState] = useState({ rows: [], loading: true });
  const [action, setAction] = useState({ busy: false, error: '' });
  const lock = useRef(false);
  const [nativeKey, setNativeKey] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    setState({ rows: [], loading: true }); setAction({ busy: false, error: '' });
    setNativeKey(null);
    fetch(`/api/import/receipts/warehouse-list?${new URLSearchParams({ orderYear, orderWeek })}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => { const data = await response.json(); if (!response.ok || !data.success || !Array.isArray(data.rows)) throw new Error(data.error || '조회 응답을 확인하지 못했습니다.'); return data; })
      .then(data => { if (!controller.signal.aborted) setState({ ...data, loading: false }); })
      .catch(error => { if (!controller.signal.aborted) setState({ rows: [], loading: false, error: error.message }); });
    return () => controller.abort();
  }, [orderYear, orderWeek]);
  async function open(row, download) {
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
    {state.loading && <p role="status">입고내역 조회 중…</p>}
    {(state.error || action.error) && <p className={styles.error} role="alert">{state.error || action.error}</p>}
    {nativeKey ? <NativeReceiptCost key={`${scope}/${nativeKey}`} orderYear={orderYear} orderWeek={orderWeek} warehouseKey={nativeKey} onClose={() => setNativeKey(null)} /> : <div className={styles.savedList}>{state.rows.map(row => <div key={row.WarehouseKey}>
      <strong>{row.FarmName || '농장 미기재'} · {row.InvoiceNo || '송장번호 미기재'}</strong>
      <p>입고 #{row.WarehouseKey} · {row.InputDate} · GW {row.GrossWeight ?? '미기재'} / CW {row.ChargeableWeight ?? '미기재'} kg</p>
      <button type="button" disabled={action.busy} onClick={() => open(row, false)}>입고자료로 원가 계산</button>{' '}
      <button type="button" disabled={action.busy} onClick={() => open(row, true)}>기존 승인 원가 다운로드</button>
    </div>)}</div>}
    {!state.loading && !state.error && !state.rows.length && <p>해당 연도·세부차수의 입고내역이 없습니다.</p>}
    {state.hasMore && <p>최신 500건까지 표시합니다. 입고관리에서 나머지 내역을 확인하세요.</p>}
  </section>;
}
