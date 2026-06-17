// 붙여넣기/기초재고 — 제외 하이라이트(드래그) 구간·줄 처리

export function lineIndicesInRange(start, end) {
  const a = Math.min(start, end);
  const b = Math.max(start, end);
  const out = [];
  for (let i = a; i <= b; i += 1) out.push(i);
  return out;
}

export function toggleExcludedLines(excluded, indices) {
  const set = new Set(excluded || []);
  const list = Array.isArray(indices) ? indices : [indices];
  const allOn = list.every(i => set.has(i));
  list.forEach(i => {
    if (allOn) set.delete(i);
    else set.add(i);
  });
  return [...set].sort((a, b) => a - b);
}

/** 제외 줄을 빼고 텍스트 재조합 (AI·파서용) */
export function textWithoutExcludedLines(text, excludedLineNos = []) {
  const skip = new Set(excludedLineNos || []);
  if (!skip.size) return String(text || '');
  return String(text || '')
    .split(/\r?\n/)
    .filter((_, idx) => !skip.has(idx))
    .join('\n');
}

export function isLineExcluded(idx, excludedLineNos = []) {
  return (excludedLineNos || []).includes(idx);
}
