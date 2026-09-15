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
  text=String(text||'');
  const ranges=excludedTextRanges(text,excludedLineNos);
  for(const range of [...ranges].reverse())text=text.slice(0,range.start)+text.slice(range.start,range.end).replace(/[^\r\n]/g,' ')+text.slice(range.end);
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

export function excludedTextRanges(text, excluded = []) {
  const source=String(text||'');
  const valid=excluded.filter(r=>r&&typeof r==='object'&&Number.isInteger(r.start)&&Number.isInteger(r.end)&&r.start>=0&&r.end>r.start&&r.end<=source.length&&r.text===source.slice(r.start,r.end));
  return valid.sort((a,b)=>a.start-b.start).reduce((out,r)=>{
    const last=out[out.length-1];
    if(last&&r.start<=last.end){last.end=Math.max(last.end,r.end);last.text=source.slice(last.start,last.end);}
    else out.push({...r});
    return out;
  },[]);
}

export function toggleExcludedText(text, excluded, start, end) {
  const source=String(text||'');
  const a=Math.min(start,end),b=Math.max(start,end);
  if(!Number.isInteger(a)||!Number.isInteger(b)||a<0||b>source.length||a===b)return excluded;
  const ranges=excludedTextRanges(source,excluded);
  const covered=ranges.some(r=>r.start<=a&&r.end>=b);
  const next=covered?ranges.flatMap(r=>r.end<=a||r.start>=b?[r]:[{start:r.start,end:Math.min(a,r.end)},{start:Math.max(b,r.start),end:r.end}].filter(r=>r.end>r.start).map(r=>({...r,text:source.slice(r.start,r.end)}))):[...ranges,{start:a,end:b,text:source.slice(a,b)}];
  return [...(excluded||[]).filter(Number.isInteger),...excludedTextRanges(source,next)];
}
