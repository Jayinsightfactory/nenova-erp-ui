import React, { useEffect, useRef, useState } from 'react';
import styles from '../../styles/InvoiceArrivalCostPanel.module.css';

const display = value => value === null || value === undefined || value === '' ? '—' : value;
const amount = value => value === null || value === undefined || value === '' ? '—' : Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 6 });

export default function InvoiceArrivalCostPanel({ orderYear, orderWeek, country }) {
  const scope = JSON.stringify([orderYear ?? '', orderWeek ?? '', country ?? '']);
  const [enabled, setEnabled] = useState(false);
  const [state, setState] = useState({ scope: null, rows: [], loading: false, error: '', hasMore: false });
  const generation = useRef(0);
  const controller = useRef(null);
  const liveScope = useRef(scope);
  liveScope.current = scope;

  async function load(append = false) {
    const id = ++generation.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const expectedScope = scope;
    setState(previous => ({ ...previous, loading: true, error: '' }));
    try {
      const params = new URLSearchParams({ orderYear: String(orderYear ?? ''), limit: '20' });
      if (orderWeek) params.set('orderWeek', orderWeek);
      if (country) params.set('country', country);
      if (append && state.scope === scope && state.nextCursor) params.set('beforeWarehouseKey', state.nextCursor);
      const response = await fetch(`/api/arrival-cost/invoice-costs?${params}`, { signal: abort.signal, cache: 'no-store', credentials: 'same-origin' });
      const data = await response.json();
      if (!response.ok || data.success !== true || !Array.isArray(data.rows)) throw new Error(data.error || '조회 응답을 확인하지 못했습니다.');
      if (generation.current !== id || liveScope.current !== expectedScope) return;
      setState(previous => ({ ...data, scope: expectedScope, loading: false, error: '', rows: append && previous.scope === expectedScope
        ? [...previous.rows, ...data.rows.filter(row => !previous.rows.some(old => old.warehouseKey === row.warehouseKey))] : data.rows }));
    } catch (error) {
      if (abort.signal.aborted || generation.current !== id || liveScope.current !== expectedScope) return;
      setState(previous => ({ ...previous, loading: false, error: error.message || '조회에 실패했습니다.' }));
    }
  }
  useEffect(() => {
    if (enabled) load();
    return () => { generation.current += 1; controller.current?.abort(); };
    // Scope changes intentionally restart the explicitly enabled read-only query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, enabled]);
  const visible = state.scope === scope;
  return <section className={styles.panel} aria-label="인보이스 입고 원가" aria-busy={state.loading}>
    <div className={styles.header}><h2>인보이스 입고 원가</h2>
      <button type="button" disabled={state.loading} onClick={() => enabled ? load() : setEnabled(true)}>인보이스 입고 원가 조회</button>
      <a href="/incoming">입고관리에서 조회</a><a href="/import/tools">입고·원가 검토</a></div>
    <p>실입고와 다시 대조한 실제 원가만 표시합니다. 기존 엑셀 도착원가 및 ERP 원장은 변경하지 않습니다.</p>
    <p>조회 범위: {display(orderYear)}년 · {orderWeek || '전체 차수'} · {country || '전체 국가'}</p>
    {state.loading && <p role="status">조회 중…</p>}
    {state.error && <p role="alert" className={styles.error}>{state.error} {visible ? '이전 조회 결과입니다. 최신 여부를 다시 확인하세요.' : '새 필터 조회에 실패했습니다. 이전 필터의 결과는 표시하지 않습니다.'}</p>}
    {visible && state.available === false && <p role="status">{state.message}</p>}
    {visible && state.available !== false && <div className={styles.scroll}><table><thead><tr>{['연도차수', '인보이스', '입고번호', '공식', '실제총원가', '상태', '승인자'].map(label => <th key={label}>{label}</th>)}</tr></thead>
      <tbody>{state.rows.map(row => <React.Fragment key={row.warehouseKey}><tr>
        <td>{row.orderYear} / {row.orderWeek}</td><td>{display(row.invoiceNo)}</td><td>{row.warehouseKey}</td>
        <td>{display(row.currentActual?.formulaId)}</td><td>{amount(row.currentActual?.totalCostKRW)} {row.currentActual?.totalCostKRW != null ? 'KRW' : ''}</td>
        <td>{row.currentActual ? '승인된 실제 원가' : row.latestStale ? 'STALE · 현재 원가 없음' : display(row.status)}</td>
        <td>{display(row.currentActual?.approvedBy)}<br />{display(row.currentActual?.approvedAt)}</td>
      </tr><tr><td colSpan={7}>{row.currentActual ? <details><summary>품목별 실제 원가 보기</summary><table><thead><tr>{['품목명', '품목키', '입고상세키', '단위', '수량', '단위당 원가(KRW)', '원가(KRW)'].map(label => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>{row.currentActual.lines.map((line, index) => <tr key={`${line.wdetailKey}-${index}`}><td>{display(line.productName)}</td><td>{display(line.prodKey)}</td><td>{display(line.wdetailKey)}</td><td>{display(line.unit)}</td><td>{amount(line.quantity)}</td><td>{amount(line.costPerUnitKRW)}</td><td>{amount(line.totalCostKRW)}</td></tr>)}</tbody></table></details>
        : row.latestStale ? <p className={styles.warning}>과거 비교용 · 현재 원가 아님: {display(row.latestStale.formulaId)} / {amount(row.latestStale.totalCostKRW)} KRW / {display(row.latestStale.approvedBy)} / {display(row.latestStale.approvedAt)}</p> : '현재 승인된 실제 원가가 없습니다.'}</td></tr></React.Fragment>)}</tbody></table>
      {!state.rows.length && <p>조회 범위에 인보이스 실제 원가가 없습니다.</p>}</div>}
    {visible && state.hasMore && <button type="button" disabled={state.loading} onClick={() => load(true)}>다음 20건 조회</button>}
  </section>;
}
