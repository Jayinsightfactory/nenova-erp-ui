import React, { useEffect, useMemo, useState } from 'react';

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function mergeFarmRows(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const farmKey = Number(row.FarmKey || 0);
    if (!farmKey) continue;
    const current = map.get(farmKey) || {
      ...row,
      FarmKey: farmKey,
      wOutQuantity: 0,
      sOutQuantity: 0,
      orderCodes: new Set(),
    };
    current.wOutQuantity += asNumber(row.wOutQuantity);
    current.sOutQuantity = Math.max(current.sOutQuantity, asNumber(row.sOutQuantity));
    if (row.OrderCode) current.orderCodes.add(row.OrderCode);
    map.set(farmKey, current);
  }
  return [...map.values()].map((row) => ({
    ...row,
    OrderCode: [...row.orderCodes].join(', '),
  }));
}

export default function PivotFarmAssignmentModal({ target, onClose, onSaved }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState([]);
  const [values, setValues] = useState({});
  const targetQty = asNumber(target?.newVal ?? target?.outQty);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({
      year: String(target.year),
      week: String(target.wk),
      custKey: String(target.ck),
      prodKey: String(target.pk),
    });
    fetch(`/api/shipment/farm-distribution?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        if (!data.success) throw new Error(data.error || '농장 목록을 불러오지 못했습니다.');
        const merged = mergeFarmRows(data.farms);
        setRows(merged);
        const initial = {};
        for (const row of merged) initial[row.FarmKey] = asNumber(row.sOutQuantity);
        // 신규 빈 행에 농장 후보가 하나뿐이면 exe 입력 결과와 같은 단일 배정으로 시작한다.
        const valid = merged.filter((row) => row.FarmKey > 0);
        if (targetQty > 0 && valid.length === 1 && valid[0].sOutQuantity === 0) {
          initial[valid[0].FarmKey] = targetQty;
        }
        setValues(initial);
      })
      .catch((e) => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [target.year, target.wk, target.ck, target.pk, targetQty]);

  const total = useMemo(
    () => rows.reduce((sum, row) => sum + asNumber(values[row.FarmKey]), 0),
    [rows, values],
  );
  const matches = Math.abs(total - targetQty) <= 0.001;

  const save = async () => {
    if (!matches) {
      setError(`농장 배분 합계 ${total}과 출고수량 ${targetQty}가 다릅니다.`);
      return;
    }
    const assignments = rows
      .map((row) => ({ farmKey: row.FarmKey, shipmentQuantity: asNumber(values[row.FarmKey]) }))
      .filter((row) => row.shipmentQuantity > 0);
    setSaving(true);
    setError('');
    try {
      const params = new URLSearchParams({
        year: String(target.year),
        week: String(target.wk),
        custKey: String(target.ck),
        prodKey: String(target.pk),
      });
      const getData = await fetch(`/api/shipment/farm-distribution?${params}`).then((r) => r.json());
      const sdetailKey = getData.detail?.sdetailKey || target.sdetailKey;
      // 수량 자체를 바꾸는 중이면 Farm 저장을 adjust 트랜잭션에 포함한다.
      // 현재수량을 그대로 농장배정만 보정하는 경우에만 여기서 즉시 저장한다.
      const canPersistNow = sdetailKey && getData.detail &&
        Math.abs(asNumber(getData.detail.outQuantity) - targetQty) <= 0.001 &&
        Math.abs(asNumber(target.val) - targetQty) <= 0.001;
      if (canPersistNow) {
        const response = await fetch('/api/shipment/farm-distribution', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            year: target.year,
            week: target.wk,
            custKey: target.ck,
            prodKey: target.pk,
            sdetailKey,
            assignments,
          }),
        });
        const data = await response.json();
        if (!data.success) throw new Error(data.error || '농장배정 저장에 실패했습니다.');
      }
      // 신규 빈 행은 ShipmentDetail이 아직 없으므로, assignments를 차수피벗 적용 요청에 넘긴다.
      onSaved?.({ assignments, sdetailKey: sdetailKey || null });
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 2300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 10, width: 'min(760px,94vw)', maxHeight: '88vh', overflow: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,.3)' }}>
        <div style={{ padding: '12px 16px', background: '#37474f', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <b>농장별 분배 — {target.custName} / {target.prodName}</b>
          <button onClick={onClose} style={{ background: 'none', border: 0, color: '#fff', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ padding: 16 }}>
          <div style={{ fontSize: 12, marginBottom: 10 }}>
            연도 {target.year} · {target.wk} · 출고수량 <b>{targetQty}</b>
          </div>
          {loading ? <div style={{ padding: 24, color: '#777' }}>농장 후보 조회 중...</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr><th style={{ textAlign: 'left', padding: 6 }}>농장</th><th>코드</th><th>주문코드</th><th>입고</th><th>기존출고</th><th>배분입력</th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.FarmKey}>
                    <td style={{ padding: 6 }}>{row.FarmName}</td>
                    <td>{row.FarmCode}</td>
                    <td>{row.OrderCode}</td>
                    <td style={{ textAlign: 'right' }}>{asNumber(row.wOutQuantity).toLocaleString()}</td>
                    <td style={{ textAlign: 'right' }}>{asNumber(row.sOutQuantity).toLocaleString()}</td>
                    <td style={{ textAlign: 'right' }}>
                      <input type="number" min="0" step="0.001" value={values[row.FarmKey] ?? 0}
                        onChange={(e) => setValues((prev) => ({ ...prev, [row.FarmKey]: asNumber(e.target.value) }))}
                        style={{ width: 90, textAlign: 'right', padding: 4 }} />
                    </td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', color: '#b71c1c' }}>입고농장/FarmKey 후보가 없습니다.</td></tr>}
              </tbody>
            </table>
          )}
          <div style={{ marginTop: 10, fontSize: 12, color: matches ? '#2e7d32' : '#c62828' }}>
            농장배분 합계: <b>{total}</b> / 출고수량: <b>{targetQty}</b>
          </div>
          {error && <div style={{ marginTop: 8, color: '#c62828', whiteSpace: 'pre-wrap' }}>{error}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <button onClick={onClose} style={{ padding: '7px 16px' }}>취소</button>
            <button onClick={save} disabled={loading || saving || !matches || !rows.length}
              style={{ padding: '7px 18px', background: matches ? '#1976d2' : '#bbb', color: '#fff', border: 0, borderRadius: 4 }}>
              {saving ? '저장 중...' : '네노바 방식으로 저장'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
