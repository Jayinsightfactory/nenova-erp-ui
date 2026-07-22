// 주차별 매출이익보고서의 자동 비고 생성 — DB/API와 분리된 순수 함수.

export function formatUnclassifiedNote(details = [], maxRows = 40) {
  if (!Array.isArray(details) || details.length === 0) return '';
  const grouped = new Map();
  for (const row of details) {
    const key = [row.source, row.country, row.flower, row.product].join('|');
    const current = grouped.get(key) || { ...row, quantity: 0, amount: 0 };
    current.quantity += Number(row.quantity || 0);
    current.amount += Number(row.amount || 0);
    grouped.set(key, current);
  }
  const rows = [...grouped.values()].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  const lines = ['[자동 미분류 내역]'];
  rows.slice(0, maxRows).forEach((row) => {
    const qty = Math.abs(row.quantity) > 0.001 ? ` · 수량 ${Math.round(row.quantity).toLocaleString()}` : '';
    const amount = Math.abs(row.amount) > 0.001 ? ` · 금액 ${Math.round(row.amount).toLocaleString()}` : '';
    lines.push(`- ${row.source}: ${row.country} / ${row.flower} / ${row.product}${qty}${amount}`);
  });
  if (rows.length > maxRows) lines.push(`- 외 ${rows.length - maxRows}건`);
  return lines.join('\n').slice(0, 1900);
}

export function composeProfitReportNote(note, autoNote) {
  return [autoNote, String(note || '').trim()].filter(Boolean).join('\n\n').slice(0, 2000);
}
