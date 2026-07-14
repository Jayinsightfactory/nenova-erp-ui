// 라움 손익계산서 — 강남/건대 견적서(거래명세표) 업로드 → 품목+단가 동일 합산 → 차수별 손익 저장·인쇄.
// 매출단가 = 견적서 단가(자동), 매입단가 = 수기 입력(전산 참고단가 = Product.Cost÷1.1 채우기 보조).
// 순익분배 기본: 네노바 80% : 미우 20% (차수별 수정 가능). 인쇄는 iframe srcdoc 방식(프로젝트 규칙).
// Layout 은 _app.js 가 전역 래핑 — 페이지 자체 래핑 금지(이중 사이드바 원인)
import { useEffect, useMemo, useRef, useState } from 'react';

const fmt = v => (v == null || Number.isNaN(Number(v)) ? '' : Math.round(Number(v)).toLocaleString());
const fmt1 = v => (v == null || Number.isNaN(Number(v)) ? '' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 }));
const pct = v => (v == null || !Number.isFinite(v) ? '' : `${(v * 100).toFixed(1)}%`);
const dateStr = v => (v ? String(v).slice(0, 10) : '');

// 행 계산 — 매입액/이익/분배 (매입단가 미입력 행은 null)
function computeItemRow(it, nenovaPct) {
  const cost = it.costPrice != null && it.costPrice !== '' ? Number(it.costPrice) : null;
  const costAmount = cost != null ? cost * Number(it.qty || 0) : null;
  const sale = Number(it.supply || 0);
  const profit = costAmount != null ? sale - costAmount : null;
  const rate = profit != null && sale > 0 ? profit / sale : null;
  return {
    costAmount,
    profit,
    rate,
    nenova: profit != null ? profit * (nenovaPct / 100) : null,
    miu: profit != null ? profit * ((100 - nenovaPct) / 100) : null,
  };
}

function computeTotals(items, nenovaPct) {
  let sale = 0; let cost = 0; let missing = 0;
  for (const it of items) {
    sale += Number(it.supply || 0);
    const r = computeItemRow(it, nenovaPct);
    if (r.costAmount == null) missing += 1;
    else cost += r.costAmount;
  }
  const profit = sale - cost;
  return {
    sale, cost, missing, profit,
    rate: sale > 0 ? profit / sale : null,
    nenova: profit * (nenovaPct / 100),
    miu: profit * ((100 - nenovaPct) / 100),
  };
}

// ── 인쇄 (iframe srcdoc — 프로젝트 규칙: Blob+window.open 금지) ──
function printInIframe(html) {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;';
  iframe.srcdoc = html;
  let done = false;
  const cleanup = () => { if (done) return; done = true; setTimeout(() => iframe.remove(), 500); };
  iframe.onload = () => {
    try { iframe.contentWindow.focus(); iframe.contentWindow.print(); } catch (e) { console.error('[print]', e); }
    try { iframe.contentWindow.onafterprint = cleanup; } catch { /* cross-origin 등 */ }
    setTimeout(cleanup, 3000);
  };
  document.body.appendChild(iframe);
}

const PRINT_CSS = `
  * { box-sizing: border-box; font-family: 'Malgun Gothic', '맑은 고딕', sans-serif; }
  body { margin: 0; padding: 16px 20px; color: #111; }
  h1 { font-size: 17px; text-align: center; margin: 0 0 4px; }
  .sub { text-align: center; font-size: 11px; color: #444; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
  th, td { border: 1px solid #555; padding: 3px 5px; }
  th { background: #f0f0f0; font-weight: 700; text-align: center; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.ctr { text-align: center; }
  tr.total td { font-weight: 700; background: #fafafa; }
  .note { margin-top: 10px; font-size: 11px; }
  .missing { color: #b91c1c; }
  @media print { @page { size: A4 landscape; margin: 9mm 10mm; } }
`;

function buildDetailPrintHtml(meta, items, totals, branches) {
  const nen = Number(meta.nenovaPct);
  const rows = items.map((it, i) => {
    const r = computeItemRow(it, nen);
    return `<tr>
      <td class="ctr">${i + 1}</td>
      <td>${it.name}</td>
      <td class="ctr">${it.unit || ''}</td>
      ${branches.map(b => `<td class="num">${fmt(it.byBranch?.[b])}</td>`).join('')}
      <td class="num">${fmt(it.qty)}</td>
      <td class="num">${it.costPrice != null ? fmt1(it.costPrice) : '<span class="missing">미입력</span>'}</td>
      <td class="num">${fmt(r.costAmount)}</td>
      <td class="num">${fmt1(it.price)}</td>
      <td class="num">${fmt(it.supply)}</td>
      <td class="num">${fmt(r.profit)}</td>
      <td class="num">${pct(r.rate)}</td>
      <td class="num">${fmt(r.nenova)}</td>
      <td class="num">${fmt(r.miu)}</td>
    </tr>`;
  }).join('');
  const missingNote = totals.missing > 0 ? `<div class="note missing">⚠ 매입단가 미입력 품목 ${totals.missing}건 — 총매입/이익은 입력된 품목만 합산된 값입니다.</div>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${meta.title}</title><style>${PRINT_CSS}</style></head><body>
    <h1>${meta.title} 손익계산서</h1>
    <div class="sub">견적일 ${dateStr(meta.quoteDate) || '-'} · 순익분배 네노바 ${nen}% : 미우 ${100 - nen}% · VAT 별도</div>
    <table>
      <thead><tr>
        <th>순번</th><th>품목명</th><th>단위</th>
        ${branches.map(b => `<th>${b}</th>`).join('')}
        <th>수량계</th><th>매입단가</th><th>매입액</th><th>매출단가</th><th>매출액</th>
        <th>이익</th><th>이익율</th><th>네노바이익<br/>(${nen}%)</th><th>미우이익<br/>(${100 - nen}%)</th>
      </tr></thead>
      <tbody>${rows}
        <tr class="total">
          <td class="ctr" colspan="3">합계</td>
          ${branches.map(b => `<td class="num">${fmt(items.reduce((a, it) => a + Number(it.byBranch?.[b] || 0), 0))}</td>`).join('')}
          <td class="num">${fmt(items.reduce((a, it) => a + Number(it.qty || 0), 0))}</td>
          <td></td>
          <td class="num">${fmt(totals.cost)}</td>
          <td></td>
          <td class="num">${fmt(totals.sale)}</td>
          <td class="num">${fmt(totals.profit)}</td>
          <td class="num">${pct(totals.rate)}</td>
          <td class="num">${fmt(totals.nenova)}</td>
          <td class="num">${fmt(totals.miu)}</td>
        </tr>
      </tbody>
    </table>
    ${meta.note ? `<div class="note"><b>특이사항</b> ${meta.note}</div>` : ''}
    ${missingNote}
  </body></html>`;
}

function buildSummaryPrintHtml(list) {
  const rows = list.map(m => {
    const profit = Number(m.SaleTotal || 0) - Number(m.CostTotal || 0);
    const rate = Number(m.SaleTotal) > 0 ? profit / Number(m.SaleTotal) : null;
    const nen = Number(m.NenovaPct);
    return `<tr>
      <td class="ctr">${Number(m.MajorWeek)}차</td>
      <td class="ctr">${dateStr(m.QuoteDate)}</td>
      <td class="num">${fmt(m.CostTotal)}</td>
      <td class="num">${fmt(m.SaleTotal)}</td>
      <td class="num">${fmt(profit)}</td>
      <td class="num">${pct(rate)}</td>
      <td class="num">${fmt(profit * nen / 100)}</td>
      <td class="num">${fmt(profit * (100 - nen) / 100)}</td>
    </tr>`;
  }).join('');
  const totalSale = list.reduce((a, m) => a + Number(m.SaleTotal || 0), 0);
  const totalCost = list.reduce((a, m) => a + Number(m.CostTotal || 0), 0);
  const totalProfit = totalSale - totalCost;
  const totalNen = list.reduce((a, m) => a + (Number(m.SaleTotal || 0) - Number(m.CostTotal || 0)) * Number(m.NenovaPct) / 100, 0);
  const year = list[0]?.OrderYear || new Date().getFullYear();
  return `<!doctype html><html><head><meta charset="utf-8"><title>라움 결산</title><style>${PRINT_CSS}</style></head><body>
    <h1>${year} 라움 손익 결산</h1>
    <div class="sub">차수별 합산 · VAT 별도 · 매입은 수기 입력 기준</div>
    <table>
      <thead><tr><th>차수</th><th>견적일</th><th>총 매입</th><th>총 매출(VAT별도)</th><th>총 이익</th><th>이익율</th><th>네노바이익</th><th>미우이익</th></tr></thead>
      <tbody>${rows}
        <tr class="total"><td class="ctr" colspan="2">합계</td>
          <td class="num">${fmt(totalCost)}</td><td class="num">${fmt(totalSale)}</td>
          <td class="num">${fmt(totalProfit)}</td><td class="num">${pct(totalSale > 0 ? totalProfit / totalSale : null)}</td>
          <td class="num">${fmt(totalNen)}</td><td class="num">${fmt(totalProfit - totalNen)}</td></tr>
      </tbody>
    </table>
  </body></html>`;
}

// ── 스타일 ──────────────────────────────────────────────────
// ── 검증 패널 — 견적서 원본 숫자와 파싱/합산 결과 대조 (✓ 전부 일치해야 안심) ──
function VerifyPanel({ verification, items }) {
  const [open, setOpen] = useState(true);
  if (!verification?.length) {
    return (
      <div style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 10px' }}>
        검증 정보 없음 — 이 기록은 검증 패널 추가 전에 저장됐습니다. 같은 견적서를 다시 업로드하면 생성됩니다.
      </div>
    );
  }
  const fails = verification.filter(c => !c.ok);
  const erpMismatch = (items || []).filter(it => it.erpSalePrice != null && it.price != null && Math.abs(it.erpSalePrice - it.price) > 1);
  const allOk = fails.length === 0;
  const head = allOk
    ? `✅ 검증 통과 — 견적서 합계와 ${verification.filter(c => c.ok && !c.info).length}개 항목 모두 일치`
    : `🚨 검증 실패 ${fails.length}건 — 아래 불일치 항목을 확인하세요 (저장 전 원본 견적서와 대조 필요)`;
  const n = v => (v == null ? '' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }));
  return (
    <div style={{
      border: `1px solid ${allOk ? '#86efac' : '#fca5a5'}`, background: allOk ? '#f0fdf4' : '#fef2f2',
      borderRadius: 8, padding: '10px 14px', margin: '0 0 12px', fontSize: 12.5,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        <b style={{ color: allOk ? '#166534' : '#991b1b' }}>{head}</b>
        <span style={{ color: '#64748b' }}>{open ? '▲ 접기' : '▼ 자세히'}</span>
      </div>
      {open ? (
        <table style={{ borderCollapse: 'collapse', marginTop: 8, fontSize: 12 }}>
          <thead>
            <tr>
              {['구분', '항목', '견적서 값', '파싱/합산 값', '차이', '판정'].map(h => (
                <th key={h} style={{ border: '1px solid #d7dde5', background: '#fff', padding: '3px 10px', fontWeight: 700 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {verification.map((c, i) => (
              <tr key={i} style={{ background: c.ok ? '#fff' : '#fee2e2' }}>
                <td style={{ border: '1px solid #e2e8f0', padding: '3px 10px' }}>{c.group}</td>
                <td style={{ border: '1px solid #e2e8f0', padding: '3px 10px' }}>{c.label}</td>
                {c.info ? (
                  <td style={{ border: '1px solid #e2e8f0', padding: '3px 10px' }} colSpan={3}>{c.info}</td>
                ) : (
                  <>
                    <td style={{ border: '1px solid #e2e8f0', padding: '3px 10px', textAlign: 'right' }}>{n(c.sheetVal)}</td>
                    <td style={{ border: '1px solid #e2e8f0', padding: '3px 10px', textAlign: 'right' }}>{n(c.parsedVal)}</td>
                    <td style={{ border: '1px solid #e2e8f0', padding: '3px 10px', textAlign: 'right', color: c.ok ? '#94a3b8' : '#b91c1c' }}>{n(c.diff)}</td>
                  </>
                )}
                <td style={{ border: '1px solid #e2e8f0', padding: '3px 10px', textAlign: 'center' }}>{c.ok ? '✓' : '✗'}</td>
              </tr>
            ))}
            <tr>
              <td style={{ border: '1px solid #e2e8f0', padding: '3px 10px' }}>전산 교차</td>
              <td style={{ border: '1px solid #e2e8f0', padding: '3px 10px' }}>견적단가 ↔ 전산 분배단가</td>
              <td style={{ border: '1px solid #e2e8f0', padding: '3px 10px' }} colSpan={3}>
                {erpMismatch.length === 0
                  ? '매칭된 품목 모두 전산 분배단가와 일치'
                  : `단가 다른 품목 ${erpMismatch.length}건 (행의 ⚠ 표시) — 이월 품목이면 정상`}
              </td>
              <td style={{ border: '1px solid #e2e8f0', padding: '3px 10px', textAlign: 'center' }}>{erpMismatch.length === 0 ? '✓' : '⚠'}</td>
            </tr>
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

const st = {
  page: { padding: '18px 22px', maxWidth: 1500 },
  h1: { fontSize: 20, fontWeight: 700, margin: '0 0 4px' },
  desc: { fontSize: 12.5, color: '#64748b', margin: '0 0 14px' },
  bar: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 },
  btn: { padding: '7px 14px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontSize: 13 },
  btnPrimary: { padding: '7px 14px', borderRadius: 6, border: '1px solid #2563eb', background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  btnDanger: { padding: '5px 10px', borderRadius: 6, border: '1px solid #fca5a5', background: '#fff', color: '#b91c1c', cursor: 'pointer', fontSize: 12 },
  table: { borderCollapse: 'collapse', fontSize: 12.5, width: '100%' },
  th: { border: '1px solid #d7dde5', background: '#f1f5f9', padding: '6px 8px', fontWeight: 700, whiteSpace: 'nowrap', textAlign: 'center' },
  td: { border: '1px solid #e2e8f0', padding: '5px 8px', whiteSpace: 'nowrap' },
  num: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  input: { width: 84, padding: '3px 6px', border: '1px solid #cbd5e1', borderRadius: 4, fontSize: 12.5, textAlign: 'right' },
  warn: { background: '#fef9c3', border: '1px solid #fde047', borderRadius: 6, padding: '8px 12px', fontSize: 12.5, margin: '0 0 10px', whiteSpace: 'pre-wrap' },
  err: { background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 6, padding: '8px 12px', fontSize: 12.5, margin: '0 0 10px', color: '#991b1b' },
  ok: { background: '#dcfce7', border: '1px solid #86efac', borderRadius: 6, padding: '8px 12px', fontSize: 12.5, margin: '0 0 10px', color: '#166534' },
  badge: { display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11.5, fontWeight: 600 },
};

export default function RaumPnlPage() {
  const [list, setList] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  // detail: { meta:{pnlKey?, orderYear, major, title, quoteDate, nenovaPct, note, sourceFile}, items, warnings, sheets, unsaved }
  const [detail, setDetail] = useState(null);
  const fileRef = useRef(null);

  const loadList = async () => {
    setLoadingList(true);
    setError('');
    try {
      const r = await fetch('/api/raum/pnl?view=list');
      const j = await r.json();
      if (!j.success) throw new Error(j.error || '목록 조회 실패');
      setList(j.list || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingList(false);
    }
  };
  useEffect(() => { loadList(); }, []);

  // ── 업로드 → 미리보기 ──
  const onUpload = async (file) => {
    if (!file) return;
    setUploading(true);
    setError('');
    setMessage('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch('/api/raum/pnl-import', { method: 'POST', body: fd });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || '업로드 실패');
      const warnings = [...(j.warnings || [])];
      if (j.existing) {
        warnings.push(`${Number(j.major)}차는 이미 저장돼 있습니다 (${dateStr(j.existing.UpdatedAt || j.existing.CreatedAt)}). 저장하면 품목이 이번 업로드 내용으로 교체됩니다 (수기 매입단가 포함 초기화).`);
      }
      setDetail({
        meta: {
          pnlKey: j.existing?.PnlKey || null,
          orderYear: j.orderYear,
          major: j.major || '',
          title: `라움 ${Number(j.major) || '?'}차`,
          quoteDate: j.quoteDate,
          nenovaPct: j.nenovaPct,
          note: '',
          sourceFile: j.fileName,
        },
        sheets: j.sheets,
        items: j.items.map(it => ({ ...it, costPrice: it.costPrice ?? null })),
        verification: j.verification || null,
        warnings,
        unsaved: true,
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // ── 저장본 열기 ──
  const openDetail = async (pnlKey) => {
    setError('');
    setMessage('');
    try {
      const r = await fetch(`/api/raum/pnl?key=${pnlKey}`);
      const j = await r.json();
      if (!j.success) throw new Error(j.error || '조회 실패');
      setDetail({
        meta: {
          pnlKey: j.master.PnlKey,
          orderYear: j.master.OrderYear,
          major: j.master.MajorWeek,
          title: j.master.Title || `라움 ${Number(j.master.MajorWeek)}차`,
          quoteDate: dateStr(j.master.QuoteDate),
          nenovaPct: Number(j.master.NenovaPct),
          note: j.master.Note || '',
          sourceFile: j.master.SourceFile || '',
        },
        sheets: null,
        items: j.items,
        verification: j.verification || null,
        warnings: [],
        unsaved: false,
      });
    } catch (e) {
      setError(e.message);
    }
  };

  const save = async () => {
    if (!detail) return;
    const { meta, items } = detail;
    if (!meta.major) { setError('차수를 입력하세요 (예: 27).'); return; }
    setSaving(true);
    setError('');
    try {
      const r = await fetch('/api/raum/pnl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          orderYear: meta.orderYear,
          major: meta.major,
          title: meta.title,
          quoteDate: meta.quoteDate,
          nenovaPct: meta.nenovaPct,
          note: meta.note,
          sourceFile: meta.sourceFile,
          items,
          verification: detail.verification || null,
        }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || '저장 실패');
      setDetail(d => ({ ...d, meta: { ...d.meta, pnlKey: j.pnlKey }, unsaved: false }));
      setMessage(`저장 완료 — ${Number(meta.major)}차 손익계산서가 히스토리에 기록되었습니다.`);
      loadList();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (pnlKey, title) => {
    if (!window.confirm(`${title} 손익계산서를 삭제할까요? (히스토리에서 제거)`)) return;
    try {
      const r = await fetch('/api/raum/pnl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', key: pnlKey }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || '삭제 실패');
      if (detail?.meta?.pnlKey === pnlKey) setDetail(null);
      loadList();
    } catch (e) {
      setError(e.message);
    }
  };

  const setItem = (idx, patch) => {
    setDetail(d => {
      const items = d.items.slice();
      items[idx] = { ...items[idx], ...patch };
      return { ...d, items, unsaved: true };
    });
  };
  const setMeta = patch => setDetail(d => ({ ...d, meta: { ...d.meta, ...patch }, unsaved: true }));

  const fillRefPrices = () => {
    setDetail(d => ({
      ...d,
      items: d.items.map(it => (it.costPrice == null || it.costPrice === '') && it.refPrice != null
        ? { ...it, costPrice: it.refPrice }
        : it),
      unsaved: true,
    }));
  };

  const branches = useMemo(() => {
    if (!detail) return [];
    const set = new Set();
    for (const it of detail.items) Object.keys(it.byBranch || {}).forEach(b => set.add(b));
    return [...set];
  }, [detail]);

  const nenovaPct = detail ? Number(detail.meta.nenovaPct) || 0 : 80;
  const totals = useMemo(() => (detail ? computeTotals(detail.items, nenovaPct) : null), [detail, nenovaPct]);
  const hasRef = detail ? detail.items.some(it => it.refPrice != null) : false;

  // ── 렌더 ──
  return (
    <div style={st.page}>
      <h1 style={st.h1}>라움 손익계산서</h1>
      <p style={st.desc}>
        강남/건대 라움 견적서(거래명세표 엑셀)를 업로드하면 품목+단가가 같은 행을 합산해 차수별 손익계산서를 만듭니다.
        매출단가는 견적서 단가, 매입단가는 직접 입력합니다 (전산 품목원가÷1.1 을 참고단가로 제공). 저장하면 차수별 히스토리가 남습니다.
      </p>

      {error ? <div style={st.err}>{error}</div> : null}
      {message ? <div style={st.ok}>{message}</div> : null}

      <div style={st.bar}>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          style={{ display: 'none' }}
          onChange={e => onUpload(e.target.files?.[0])}
        />
        <button style={st.btnPrimary} disabled={uploading} onClick={() => fileRef.current?.click()}>
          {uploading ? '분석 중…' : '📤 견적서 업로드'}
        </button>
        {detail ? (
          <>
            <button style={st.btn} onClick={() => { setDetail(null); setMessage(''); setError(''); }}>← 결산 목록</button>
            <button style={st.btnPrimary} disabled={saving} onClick={save}>{saving ? '저장 중…' : '💾 저장'}</button>
            <button
              style={st.btn}
              onClick={() => printInIframe(buildDetailPrintHtml(detail.meta, detail.items, totals, branches))}
            >🖨 인쇄</button>
            {detail.unsaved ? <span style={{ ...st.badge, background: '#fef3c7', color: '#92400e' }}>저장 전</span>
              : <span style={{ ...st.badge, background: '#dcfce7', color: '#166534' }}>저장됨</span>}
          </>
        ) : (
          <button style={st.btn} disabled={!list.length} onClick={() => printInIframe(buildSummaryPrintHtml(list))}>🖨 결산표 인쇄</button>
        )}
      </div>

      {!detail ? (
        // ── 결산(히스토리) 목록 ──
        <div>
          {loadingList ? <div style={{ fontSize: 13, color: '#64748b' }}>불러오는 중…</div> : null}
          {!loadingList && !list.length ? (
            <div style={{ fontSize: 13.5, color: '#64748b', padding: '30px 0' }}>
              저장된 손익계산서가 없습니다. 위 [견적서 업로드]로 시작하세요.
            </div>
          ) : null}
          {list.length ? (
            <table style={{ ...st.table, maxWidth: 1100 }}>
              <thead>
                <tr>
                  {['차수', '견적일', '품목수', '총 매입', '총 매출(VAT별도)', '총 이익', '이익율', '네노바이익', '미우이익', '수정일', ''].map(h => (
                    <th key={h} style={st.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.map(m => {
                  const profit = Number(m.SaleTotal || 0) - Number(m.CostTotal || 0);
                  const rate = Number(m.SaleTotal) > 0 ? profit / Number(m.SaleTotal) : null;
                  const nen = Number(m.NenovaPct);
                  return (
                    <tr key={m.PnlKey} style={{ cursor: 'pointer' }} onClick={() => openDetail(m.PnlKey)}>
                      <td style={{ ...st.td, fontWeight: 700 }}>{Number(m.MajorWeek)}차</td>
                      <td style={st.td}>{dateStr(m.QuoteDate)}</td>
                      <td style={{ ...st.td, ...st.num }}>
                        {m.ItemCount}{Number(m.MissingCost) > 0 ? <span style={{ color: '#b91c1c' }}> (매입단가 미입력 {m.MissingCost})</span> : null}
                      </td>
                      <td style={{ ...st.td, ...st.num }}>{fmt(m.CostTotal)}</td>
                      <td style={{ ...st.td, ...st.num }}>{fmt(m.SaleTotal)}</td>
                      <td style={{ ...st.td, ...st.num, fontWeight: 700 }}>{fmt(profit)}</td>
                      <td style={{ ...st.td, ...st.num }}>{pct(rate)}</td>
                      <td style={{ ...st.td, ...st.num }}>{fmt(profit * nen / 100)} <span style={{ color: '#94a3b8' }}>({nen}%)</span></td>
                      <td style={{ ...st.td, ...st.num }}>{fmt(profit * (100 - nen) / 100)}</td>
                      <td style={st.td}>{dateStr(m.UpdatedAt || m.CreatedAt)}</td>
                      <td style={st.td} onClick={e => e.stopPropagation()}>
                        <button style={st.btnDanger} onClick={() => remove(m.PnlKey, `${Number(m.MajorWeek)}차`)}>삭제</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}
        </div>
      ) : (
        // ── 상세 (미리보기/편집) ──
        <div>
          <VerifyPanel verification={detail.verification} items={detail.items} />
          {detail.warnings?.length ? <div style={st.warn}>{detail.warnings.map((w, i) => `⚠ ${w}`).join('\n')}</div> : null}

          <div style={{ ...st.bar, gap: 14 }}>
            <label style={{ fontSize: 13 }}>차수{' '}
              <input
                style={{ ...st.input, width: 46, textAlign: 'center' }}
                value={detail.meta.major}
                onChange={e => setMeta({ major: e.target.value.replace(/[^0-9]/g, '').slice(0, 2), title: `라움 ${Number(e.target.value) || '?'}차` })}
              />차 ({detail.meta.orderYear}년)
            </label>
            <label style={{ fontSize: 13 }}>견적일{' '}
              <input style={{ ...st.input, width: 110, textAlign: 'center' }} value={detail.meta.quoteDate || ''}
                onChange={e => setMeta({ quoteDate: e.target.value })} placeholder="YYYY-MM-DD" />
            </label>
            <label style={{ fontSize: 13 }}>순익분배 네노바{' '}
              <input
                style={{ ...st.input, width: 46, textAlign: 'center' }}
                value={detail.meta.nenovaPct}
                onChange={e => {
                  const v = e.target.value.replace(/[^0-9.]/g, '');
                  setMeta({ nenovaPct: v === '' ? '' : Math.min(100, Number(v)) });
                }}
              />% : 미우 {Number.isFinite(nenovaPct) ? 100 - nenovaPct : ''}%
            </label>
            {hasRef ? (
              <button style={st.btn} onClick={fillRefPrices} title="매입단가가 비어있는 행에 전산 참고단가(품목원가÷1.1)를 채웁니다. 채운 뒤 개별 수정 가능.">
                ⤵ 참고단가 채우기
              </button>
            ) : null}
            {detail.sheets ? (
              <span style={{ fontSize: 12, color: '#64748b' }}>
                {detail.sheets.map(s => `${s.branch} ${s.itemCount}품목 ${fmt(s.parsedSupply)}원`).join(' · ')} → 합산 {detail.items.length}품목
              </span>
            ) : null}
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={st.table}>
              <thead>
                <tr>
                  <th style={st.th}>순번</th>
                  <th style={st.th}>품목명</th>
                  <th style={st.th}>단위</th>
                  {branches.map(b => <th key={b} style={st.th}>{b}</th>)}
                  <th style={st.th}>수량계</th>
                  <th style={st.th}>매입단가 ✏️</th>
                  <th style={st.th}>매입액</th>
                  <th style={st.th}>매출단가</th>
                  <th style={st.th}>매출액</th>
                  <th style={st.th}>이익</th>
                  <th style={st.th}>이익율</th>
                  <th style={st.th}>네노바이익 ({nenovaPct}%)</th>
                  <th style={st.th}>미우이익 ({100 - nenovaPct}%)</th>
                  <th style={st.th}>참고단가(전산)</th>
                  <th style={st.th}>적요</th>
                </tr>
              </thead>
              <tbody>
                {detail.items.map((it, i) => {
                  const r = computeItemRow(it, nenovaPct);
                  const erpMismatch = it.erpSalePrice != null && it.price != null && Math.abs(it.erpSalePrice - it.price) > 1;
                  return (
                    <tr key={`${it.name}|${it.price}`}>
                      <td style={{ ...st.td, textAlign: 'center' }}>{i + 1}</td>
                      <td style={st.td} title={it.prodName ? `전산 매칭: ${it.prodName}` : '전산 미매칭'}>
                        {it.name}{it.prodName ? '' : ' ⚪'}
                      </td>
                      <td style={{ ...st.td, textAlign: 'center' }}>{it.unit}</td>
                      {branches.map(b => <td key={b} style={{ ...st.td, ...st.num }}>{fmt(it.byBranch?.[b])}</td>)}
                      <td style={{ ...st.td, ...st.num, fontWeight: 600 }}>{fmt(it.qty)}</td>
                      <td style={{ ...st.td, ...st.num }}>
                        <input
                          style={{ ...st.input, background: it.costPrice != null && it.costPrice !== '' ? '#ecfdf5' : '#fff' }}
                          value={it.costPrice ?? ''}
                          placeholder={it.refPrice != null ? String(it.refPrice) : ''}
                          onChange={e => setItem(i, { costPrice: e.target.value.replace(/[^0-9.]/g, '') })}
                        />
                      </td>
                      <td style={{ ...st.td, ...st.num }}>{fmt(r.costAmount)}</td>
                      <td style={{ ...st.td, ...st.num }} title={erpMismatch ? `전산 분배단가 ${fmt1(it.erpSalePrice)}원과 다름` : (it.erpSalePrice != null ? '전산 분배단가와 일치' : '')}>
                        {fmt1(it.price)}{erpMismatch ? ' ⚠' : ''}
                      </td>
                      <td style={{ ...st.td, ...st.num }}>{fmt(it.supply)}</td>
                      <td style={{ ...st.td, ...st.num, color: r.profit != null && r.profit < 0 ? '#b91c1c' : undefined }}>{fmt(r.profit)}</td>
                      <td style={{ ...st.td, ...st.num }}>{pct(r.rate)}</td>
                      <td style={{ ...st.td, ...st.num }}>{fmt(r.nenova)}</td>
                      <td style={{ ...st.td, ...st.num }}>{fmt(r.miu)}</td>
                      <td style={{ ...st.td, ...st.num, color: '#64748b' }} title={it.refSource || ''}>{it.refPrice != null ? fmt1(it.refPrice) : ''}</td>
                      <td style={{ ...st.td, fontSize: 11.5, color: '#64748b' }}>{it.remark}</td>
                    </tr>
                  );
                })}
                <tr>
                  <td style={{ ...st.td, textAlign: 'center', fontWeight: 700 }} colSpan={3}>합계</td>
                  {branches.map(b => (
                    <td key={b} style={{ ...st.td, ...st.num, fontWeight: 700 }}>
                      {fmt(detail.items.reduce((a, it) => a + Number(it.byBranch?.[b] || 0), 0))}
                    </td>
                  ))}
                  <td style={{ ...st.td, ...st.num, fontWeight: 700 }}>{fmt(detail.items.reduce((a, it) => a + Number(it.qty || 0), 0))}</td>
                  <td style={st.td}></td>
                  <td style={{ ...st.td, ...st.num, fontWeight: 700 }}>{fmt(totals.cost)}</td>
                  <td style={st.td}></td>
                  <td style={{ ...st.td, ...st.num, fontWeight: 700 }}>{fmt(totals.sale)}</td>
                  <td style={{ ...st.td, ...st.num, fontWeight: 700 }}>{fmt(totals.profit)}</td>
                  <td style={{ ...st.td, ...st.num, fontWeight: 700 }}>{pct(totals.rate)}</td>
                  <td style={{ ...st.td, ...st.num, fontWeight: 700 }}>{fmt(totals.nenova)}</td>
                  <td style={{ ...st.td, ...st.num, fontWeight: 700 }}>{fmt(totals.miu)}</td>
                  <td style={st.td} colSpan={2}></td>
                </tr>
              </tbody>
            </table>
          </div>

          {totals.missing > 0 ? (
            <div style={{ ...st.warn, marginTop: 10 }}>
              ⚠ 매입단가 미입력 {totals.missing}건 — 총매입/이익은 입력된 품목만 합산됩니다. 참고단가(전산 품목원가÷1.1)를 쓰려면 [⤵ 참고단가 채우기]를 누르세요.
            </div>
          ) : null}

          <div style={{ marginTop: 12 }}>
            <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>특이사항</label>
            <textarea
              style={{ width: '100%', maxWidth: 700, minHeight: 54, border: '1px solid #cbd5e1', borderRadius: 6, padding: 8, fontSize: 13 }}
              value={detail.meta.note}
              onChange={e => setMeta({ note: e.target.value })}
              placeholder="예: 손실 분배, 이월 품목 포함 여부 등"
            />
          </div>
        </div>
      )}
    </div>
  );
}
