import { useEffect, useRef, useState } from 'react';

const fmtQty = (value) => value == null ? '확인 필요' : new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 6 }).format(value);
const signed = (value) => value == null ? '확인 필요' : `${value > 0 ? '+' : ''}${fmtQty(value)}`;
const box = { marginTop: 12, padding: '12px 14px', border: '1px solid #cbd5e1', borderRadius: 8, background: '#f8fafc', fontSize: 12.5, color: '#334155' };
const cell = { padding: '7px 9px', borderBottom: '1px solid #e2e8f0', textAlign: 'left', verticalAlign: 'top' };

export default function ProfitStockAdjustmentNotes({ orderYear, major, confirmed, refreshToken }) {
  const scopeKey = orderYear && major ? `${orderYear}:${major}` : '';
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState({ scopeKey: '', status: 'loading', data: null, error: '' });
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    if (!scopeKey) return undefined;
    const controller = new AbortController();
    setResult({ scopeKey, status: 'loading', data: null, error: '' });
    const load = async () => {
      try {
        const res = await fetch(`/api/sales/profit-stock-adjustment-notes?year=${encodeURIComponent(orderYear)}&week=${encodeURIComponent(major)}`, {
          credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.message || '재고조정 이력 조회 실패');
        if (controller.signal.aborted || requestId.current !== id) return;
        if (String(data.orderYear) !== String(orderYear) || String(data.major) !== String(major)) throw new Error('조회 차수가 일치하지 않습니다.');
        setResult({ scopeKey, status: 'ready', data, error: '' });
      } catch (error) {
        if (controller.signal.aborted || requestId.current !== id) return;
        setResult({ scopeKey, status: 'error', data: null, error: error?.message || '재고조정 이력 조회 실패' });
      }
    };
    load();
    return () => { controller.abort(); requestId.current += 1; };
  }, [scopeKey, attempt, refreshToken]);

  const visible = result.scopeKey === scopeKey ? result : { status: 'loading', data: null, error: '' };
  const unitTotals = new Map();
  for (const item of visible.data?.items || []) {
    if (!unitTotals.has(item.unit)) unitTotals.set(item.unit, { increase: 0, decrease: 0, invalidCount: 0 });
    const total = unitTotals.get(item.unit);
    total.increase += item.increase;
    total.decrease += item.decrease;
    total.invalidCount += item.invalidCount;
  }

  return (
    <section style={box} aria-label="실제 재고조정·차감 이력">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 5 }}>
        <strong style={{ fontSize: 13 }}>실제 재고조정·차감 이력 · {orderYear}년 {Number(major)}차</strong>
        <button type="button" style={{ marginLeft: 'auto' }} onClick={() => setAttempt((n) => n + 1)}>이력 새로고침</button>
      </div>
      <div style={{ color: '#64748b', lineHeight: 1.5, marginBottom: 9 }}>
        현재 ERP 원장의 StockHistory 조정·차감 이력을 별도로 조회한 참고자료입니다. 품명·단위는 현재 품목마스터 기준이며,
        {confirmed ? ' 확정본의 저장 당시 근거 또는 금액을 변경하지 않습니다.' : ' 보고서 금액과 수기 비고를 변경하지 않습니다.'}
      </div>
      {visible.status === 'loading' && <div role="status">재고조정 이력 조회 중…</div>}
      {visible.status === 'error' && <div role="alert" style={{ color: '#b91c1c' }}>
        조회 실패: {visible.error} <button type="button" onClick={() => setAttempt((n) => n + 1)}>다시 시도</button>
      </div>}
      {visible.status === 'ready' && visible.data?.count === 0 && <div>해당 차수 재고조정·차감 이력 없음</div>}
      {visible.status === 'ready' && visible.data?.count > 0 && <>
        <div style={{ marginBottom: 8 }}>원장 이력 {visible.data.count}건 · 순증감 0이어도 증가·감소 기록을 표시합니다.{visible.data.queriedAt && ` · 조회 ${new Date(visible.data.queriedAt).toLocaleString('ko-KR')}`}</div>
        <div style={{ marginBottom: 8 }}>
          {[...unitTotals.entries()].map(([unit, total]) => <div key={unit}>
            {unit === '단위 미확인' ? '단위 미확인 품목은 전체 수량 합계를 산출하지 않습니다.' : <>
              {unit} 합계: 순증감 {total.invalidCount ? '확인 필요' : signed(total.increase + total.decrease)} {unit}
              {' · '}증가 +{fmtQty(total.increase)} {unit} · 감소 {fmtQty(total.decrease)} {unit}
              {total.invalidCount > 0 && ` · 수량 확인 필요 ${total.invalidCount}건`}
            </>}
          </div>)}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 750 }}>
            <thead><tr><th style={cell}>세부차수</th><th style={cell}>품목</th><th style={cell}>국가·품종</th><th style={cell}>유형</th><th style={cell}>순증감</th><th style={cell}>증가 / 감소</th><th style={cell}>건수</th><th style={cell}>사유</th></tr></thead>
            <tbody>{visible.data.items.map((item) => <tr key={item.groupKey}>
              <td style={cell}>{item.weeks.join(', ')}</td>
              <td style={cell}>{item.productName} {item.prodKey != null && <small>(#{item.prodKey})</small>}</td>
              <td style={cell}>{item.country} · {item.flower}</td>
              <td style={cell}>{item.changeTypes.join(' · ')}</td>
              <td style={cell}>{signed(item.net)} {item.unit}{item.net === 0 && (item.increase > 0 || item.decrease < 0) && <div>증감 상쇄</div>}</td>
              <td style={cell}>+{fmtQty(item.increase)} / {fmtQty(item.decrease)} {item.unit}{item.invalidCount > 0 && <div>수량 확인 필요 {item.invalidCount}건</div>}</td>
              <td style={cell}>{item.count}</td>
              <td style={{ ...cell, whiteSpace: 'pre-wrap' }}>{item.reasons.join(' · ')}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </>}
    </section>
  );
}
