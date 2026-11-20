import { useRef, useState } from 'react';

const fields = [
  ['duty', '관세'], ['serviceNet', '선율 공급가'], ['serviceVat', '선율 VAT'],
  ['disinfectionNet', '별도 방역 공급가'], ['disinfectionVat', '방역 VAT'], ['importVat', '수입 VAT (비용 제외)'],
];
const font = "'Pretendard Variable', 'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', '맑은 고딕', 'Segoe UI', sans-serif";
const cell = { padding: '8px 6px', borderBottom: '1px solid #cbd5e1', textAlign: 'right', whiteSpace: 'nowrap' };
export default function CustomsPhase03Panel({ year, major, value, onRefresh }) {
  const [drafts, setDrafts] = useState({}), [saving, setSaving] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('');
  const scope = useRef(`${year}|${major}`); scope.current = `${year}|${major}`;
  if (!value?.rows?.length) return null;
  const costValue = (row, field) => drafts[row.matchId]?.[field] ?? row.costs[field] ?? '';
  async function save(row) {
    const captured = `${year}|${major}`;
    const costs = Object.fromEntries(fields.map(([field]) => { const raw = costValue(row, field); return [field, raw === '' ? null : Number(raw)]; }));
    if (Object.values(costs).some(n => n !== null && (!Number.isSafeInteger(n) || n < 0))) { setError('금액은 0 이상의 정수로 입력하세요.'); return; }
    if (!window.confirm(`${year}년 ${row.orderWeek} ${row.category} / AWB ${row.awb}\n03차 비용 원천만 저장합니다. 기존 1·2차와 과거 보고서는 갱신하지 않습니다.\n저장할까요?`)) return;
    setSaving(row.matchId); setError(''); setMessage('');
    try {
      const response = await fetch('/api/sales/customs-clearance', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'savePhase03', year, week: major, row: { orderWeek: row.orderWeek, category: row.category, awb: row.awb, costs }, expectedDigest: value.digest, confirmed: true }) });
      const result = await response.json();
      if (scope.current !== captured) return;
      if (!response.ok || !result.success) throw Error(result.error || '저장 실패');
      setDrafts(previous => { const next = { ...previous }; delete next[row.matchId]; return next; });
      setMessage('03차 원천 저장·재조회 완료. 과거 보고서 갱신은 실행하지 않았습니다.');
      await onRefresh();
    } catch (e) { if (scope.current === captured) setError(e.message); }
    finally { if (scope.current === captured) setSaving(''); }
  }
  return <section aria-label="03차 AWB별 통관 비용" style={{ fontFamily: font, fontSize: 14, color: '#0f172a', padding: 12, border: '1px solid #cbd5e1', margin: '12px 0', background: '#fff', fontVariantNumeric: 'tabular-nums' }}>
    <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>03차 비용 누락·중복 방지 · AWB별 입력</h3>
    <p style={{ margin: '0 0 8px', color: '#334155', fontSize: 13 }}>관세 + 선율 공급가 + 별도 방역 공급가를 반영합니다. 베트남 선율은 승인된 엑셀 기준으로 수수료 VAT도 포함합니다. 수입 VAT는 항상 제외하며, 미입력과 명시 0을 구분합니다. 창고·운송비는 기존 합산 기준을 유지합니다.</p>
    <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead><tr><th style={{ ...cell, textAlign: 'left' }}>입고 / 근거</th>{fields.map(([field, label]) => <th key={field} style={cell}>{label}</th>)}<th style={cell}>비용 합계</th><th style={cell}>저장</th></tr></thead>
      <tbody>{value.rows.map(row => <tr key={row.matchId}>
        <td style={{ ...cell, textAlign: 'left' }}><strong>{row.orderWeek} {row.category}</strong><div>AWB {row.awb}</div><div style={{ fontSize: 12.5, color: '#475569' }}>{row.legacyPhase ? '기존 1차 반영 · 중복 저장 차단' : row.documentCount ? `ZIP ${row.documentCount}건 · 원문 항목 보호` : '수기 원천'}</div></td>
        {fields.map(([field, label]) => <td key={field} style={cell}><input aria-label={`${row.awb} ${label}`} inputMode="numeric" type="number" min="0" step="1"
          value={costValue(row, field)} disabled={!!saving || !!row.legacyPhase || row.sources[field] === 'settlement'}
          onChange={event => { const raw = event.target.value; setDrafts(previous => ({ ...previous, [row.matchId]: { ...previous[row.matchId], [field]: raw } })); }}
          style={{ width: 100, padding: '6px 4px', font: 'inherit', textAlign: 'right', color: '#0f172a', border: '1px solid #94a3b8', borderRadius: 3 }} /></td>)}
        <td style={cell}>{row.legacyPhase ? '1차 입력 대조 대상' : row.total == null ? '미입력' : Math.round(row.total).toLocaleString()}</td>
        <td style={cell}><button type="button" disabled={!!saving || !!row.legacyPhase} onClick={() => save(row)} style={{ padding: '6px 10px', font: 'inherit', color: '#0f172a', background: '#f1f5f9', border: '1px solid #94a3b8', borderRadius: 3 }}>{saving === row.matchId ? '저장 중' : '저장'}</button></td>
      </tr>)}</tbody>
    </table></div>
    {value.rows.some(row => row.conflicts?.length) && <p role="alert" style={{ color: '#b91c1c' }}>ZIP 원문과 기존 수기 금액이 다른 항목이 있습니다. 기존 수기를 보존했습니다. 원문 대조가 필요합니다.</p>}
    {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}{message && <p role="status">{message}</p>}
  </section>;
}
