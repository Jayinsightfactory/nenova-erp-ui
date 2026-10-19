// Output-only policy. Never recalculate or persist ERP/report values here.
export function outputScope(year, major) {
  if (Array.isArray(year) || Array.isArray(major)) throw new Error('연도와 차수는 하나씩 선택하세요.');
  if (!/^\d{4}$/.test(String(year ?? ''))) throw new Error('연도를 선택하세요.');
  if (!/^\d{1,2}$/.test(String(major ?? '')) || Number(major) < 1 || Number(major) > 53) throw new Error('차수는 1~53차로 선택하세요.');
  return { year: String(year), major: String(major).padStart(2, '0') };
}

export function outputWeeks(year, major, selected) {
  const scope = outputScope(year, major);
  const all = Array.from({ length: Number(scope.major) }, (_, i) => String(i + 1).padStart(2, '0'));
  if (selected === undefined) return all;
  if (!Array.isArray(selected) || !selected.length) throw new Error('인쇄할 차수를 선택하세요.');
  const wanted = new Set(selected.map(w => outputScope(year, w).major));
  if ([...wanted].some(w => !all.includes(w))) throw new Error('선택한 범위 밖 차수입니다.');
  return all.filter(w => wanted.has(w));
}

export async function collectOutput({ year, major, selected, fetchWeek, signal, onProgress = () => {} }) {
  const scope = outputScope(year, major);
  const weeks = outputWeeks(year, major, selected);
  const results = [];
  for (const week of weeks) {
    signal?.throwIfAborted();
    onProgress({ done: results.length, total: weeks.length, week });
    let item;
    try { item = await fetchWeek(scope.year, week, signal); }
    catch (e) { if (signal?.aborted) throw e; throw new Error(`${Number(week)}차 조회 실패: ${e.message}`); }
    signal?.throwIfAborted();
    if (item.year !== scope.year || item.major !== week || !item.workbook?.Sheets?.['주차별 매출이익 보고서']) throw new Error(`${Number(week)}차 응답 범위 또는 양식이 다릅니다.`);
    results.push(item);
  }
  onProgress({ done: weeks.length, total: weeks.length, week: weeks.at(-1) });
  return results;
}

export function combineOutputBooks(items) {
  if (!items.length) throw new Error('출력 자료가 없습니다.');
  const wb = { SheetNames: [], Sheets: {}, Workbook: { Names: [], Views: [{ activeTab: 0 }] } };
  const year = items[0].year;
  for (const item of items) {
    outputScope(item.year, item.major);
    if (item.year !== year) throw new Error('다른 연도의 자료를 합칠 수 없습니다.');
    for (const [source, suffix] of [['화면표시(선택컬럼)', '차']]) {
      const sheet = item.workbook.Sheets[source];
      if (!sheet) throw new Error(`${item.major}차 출력 시트가 없습니다.`);
      const name = `${item.major}${suffix}`;
      if (wb.Sheets[name]) throw new Error('중복 차수입니다.');
      const copy = structuredClone(sheet);
      const title = 'A1';
      copy[title] = { ...copy[title], t: 's', v: `${year}년 ${Number(item.major)}차 매출이익 보고서` };
      delete copy[title].w;
      if (source.startsWith('화면') && copy.A2) {
        copy.A2 = { ...copy.A2, v: '웹 화면의 표시열·필터 적용 · 차수당 한 시트' };
        delete copy.A2.w;
      }
      const note = item.workbook.Sheets['주차별 매출이익 보고서']?.B28?.v;
      if (note) {
        const [, lastCol, lastRow] = /([A-Z]+)(\d+)$/.exec(copy['!ref']);
        const noteRow = Number(lastRow) + 2;
        const colIndex = [...lastCol].reduce((n,c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
        copy[`A${noteRow}`] = { t: 's', v: String(note), s: { font: { name: '맑은 고딕', sz: 10 }, alignment: { wrapText: true, vertical: 'top' } } };
        copy['!merges'] = [...(copy['!merges'] || []), {s:{r:noteRow-1,c:0},e:{r:noteRow-1,c:colIndex}}];
        copy['!rows'] = copy['!rows'] || [];
        copy['!rows'][noteRow-1] = { hpt: Math.min(300, 18 * String(note).split('\n').length + 24) };
        copy['!ref'] = `A1:${lastCol}${noteRow}`;
      }
      wb.SheetNames.push(name); wb.Sheets[name] = copy;
      wb.Workbook.Names.push({ Name: '_xlnm.Print_Area', Sheet: wb.SheetNames.length - 1, Ref: `'${name}'!${copy['!ref']}` });
    }
  }
  return wb;
}

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function outputPrintHtml(items, sheetRows) {
  const sections = items.map(item => {
    const rows = sheetRows(item.workbook.Sheets['화면표시(선택컬럼)']).slice(3);
    const note = item.workbook.Sheets['주차별 매출이익 보고서'].B28?.v || '';
    const tr = (r, tag) => `<tr>${r.map(v => `<${tag}>${esc(v)}</${tag}>`).join('')}</tr>`;
    return `<section><h1>${esc(item.year)}년 ${Number(item.major)}차 매출이익 보고서</h1><table><thead>${tr(rows[0], 'th')}</thead><tbody>${rows.slice(1).map(r => tr(r, 'td')).join('')}</tbody></table><p class="note">${esc(note)}</p></section>`;
  });
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>주차별 매출이익 인쇄</title><style>@page{size:A3 landscape;margin:12mm}body{font:12px Arial,"Malgun Gothic",sans-serif;color:#172b4d}section{break-after:page}section:last-child{break-after:auto}h1{font-size:20px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #a6b7c8;padding:7px 5px;text-align:right;overflow-wrap:anywhere}th{background:#e8eff7}td:first-child,th:first-child{text-align:left;min-width:110px}tr:last-child{font-weight:bold;background:#e8eff7}tr{break-inside:avoid}.note{white-space:pre-wrap;line-height:1.5}thead{display:table-header-group}</style></head><body>${sections.join('')}</body></html>`;
}
