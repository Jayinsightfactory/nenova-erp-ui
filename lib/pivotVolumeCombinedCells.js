// Read-only presentation of the existing pivot quantities. Never mutates ERP rows.
export function combinedCellContext(data, flag) {
  if (flag !== '1' && flag !== 'true') return null;
  const weeks = [...(data.weeks || [])].sort();
  if (!/^\d{4}$/.test(String(data.orderYear)) || weeks.length < 2 ||
      new Set(weeks).size !== weeks.length ||
      weeks.some(w => !/^\d{2}-\d{2}$/.test(w) || w.slice(0, 2) !== weeks[0].slice(0, 2))) {
    throw new Error('합산셀은 같은 연도·본차수의 세부차수 2개 이상 범위가 필요합니다.');
  }
  const indexes = weeks.map(week => {
    if (!Array.isArray(data.byWeek?.[week]?.rows)) throw new Error(`${week} 세부차수 데이터가 없어 합산셀을 만들 수 없습니다.`);
    const index = new Map();
    for (const row of data.byWeek[week].rows) {
      const key = String(row.prodKey);
      if (!row.prodKey || index.has(key)) throw new Error(`${week} 품목키 중복 또는 누락으로 합산셀을 만들 수 없습니다.`);
      index.set(key, row);
    }
    return index;
  });
  return { weeks, indexes, legend: `합산(${weeks.map(w => Number(w.slice(3)) + '차').join(',')})` };
}

export function combinedParts(context, row, customerName, convert) {
  const parts = context.indexes.map(index => convert(row, index.get(String(row.prodKey))?.orders?.[customerName] ?? 0));
  const total = convert(row, row.orders?.[customerName] ?? 0);
  if (![total, ...parts].every(Number.isFinite) || Math.abs(total - parts.reduce((a, b) => a + b, 0)) > 1e-7) {
    throw new Error(`${row.prodName} / ${customerName}: 합산수량과 세부차수 수량이 다릅니다. 다시 조회해 주세요.`);
  }
  return parts;
}

export function combinedNumberFormat(total, parts) {
  // Select precision per numeric cell: optional decimal masks can render a trailing dot.
  const text = value => String(Number(Number(value).toFixed(8)));
  const precision = (text(total).split('.')[1] || '').length;
  return `${precision ? '0.' + '0'.repeat(precision) : '0'}"(${parts.map(text).join(',')})"`;
}
