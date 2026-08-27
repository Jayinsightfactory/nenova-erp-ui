import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import * as XLSX from 'xlsx';
import { apiGet } from '../../lib/useApi';
import {
  buildChinaVolumeWorkbookRows,
  chinaVolumeProductLabel,
  matchChinaPackingRows,
  mergeChinaPackingIntoPivotCells,
  parseChinaPackingRows,
  validateChinaCellAllocation,
} from '../../lib/chinaVolumeBoard';

const currentYear = new Date().getFullYear();
const currentWeek = String(Math.min(52, Math.ceil((((new Date()) - new Date(currentYear, 0, 1)) / 86400000 + 1) / 7))).padStart(2, '0');
const DEFAULT_WEEK = `${currentWeek}-01`;

function fmt(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : number.toLocaleString('ko-KR', { maximumFractionDigits: 3 });
}

function BoxBadges({ allocations = [] }) {
  const visible = allocations.slice(0, 4);
  if (!allocations.length) return null;
  const title = allocations.map(item => `${item.boxNo}번 ${fmt(item.quantity)}`).join(' / ');
  return (
    <span className="box-badges" title={title} aria-label={`박스 ${title}`}>
      {visible.map((item, index) => {
        const digits = Math.min(3, Math.max(1, String(item.boxNo || '').length));
        return <span className="box-badge" data-digits={digits} key={`${item.boxNo}-${index}`}>{item.boxNo}</span>;
      })}
      {allocations.length > visible.length && <span className="box-badge more">+{allocations.length - visible.length}</span>}
    </span>
  );
}

function CellEditor({ draft, onChange, onClose, onSave }) {
  if (!draft) return null;
  const check = validateChinaCellAllocation(draft);
  const updateAllocation = (index, patch) => {
    const allocations = draft.allocations.map((item, i) => i === index ? { ...item, ...patch } : item);
    onChange({ ...draft, allocations });
  };
  return (
    <div className="modal-shade" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section className="cell-modal" role="dialog" aria-modal="true" aria-labelledby="cell-editor-title">
        <header><strong id="cell-editor-title">업체×품목 셀 수정</strong><button onClick={onClose}>×</button></header>
        <div className="modal-meta"><b>{draft.customerName}</b><span>{draft.productName}</span><small>웹 물량표 표기만 수정 · 전산 원장 미반영</small></div>
        <label className="qty-field">표시 수량<input type="number" min="0" step="0.001" value={draft.quantity} onChange={e => onChange({ ...draft, quantity: Number(e.target.value) })} /></label>
        <div className="alloc-title"><b>박스별 배정</b><span>각 박스가 독립 수정칸입니다.</span></div>
        <div className="alloc-list">
          {draft.allocations.map((item, index) => (
            <div className="alloc-row" key={index}>
              <label>박스번호<input value={item.boxNo} onChange={e => updateAllocation(index, { boxNo: e.target.value.replace(/[^0-9A-Za-z-]/g, '') })} /></label>
              <label>배정수량<input type="number" min="0" step="0.001" value={item.quantity} onChange={e => updateAllocation(index, { quantity: Number(e.target.value) })} /></label>
              <button className="remove" onClick={() => onChange({ ...draft, allocations: draft.allocations.filter((_, i) => i !== index) })}>삭제</button>
            </div>
          ))}
        </div>
        <button className="add-box" onClick={() => onChange({ ...draft, allocations: [...draft.allocations, { boxNo: '', quantity: 0 }] })}>+ 박스 추가</button>
        <div className={`allocation-check ${check.valid ? 'ok' : 'bad'}`}>
          표시 {fmt(check.quantity)} · 배정 {fmt(check.allocated)} · 차이 {fmt(check.difference)}
        </div>
        <footer><button onClick={onClose}>취소</button><button className="primary" disabled={!check.valid} onClick={onSave}>저장</button></footer>
      </section>
    </div>
  );
}

export default function ChinaVolumeBoard() {
  const router = useRouter();
  const [year, setYear] = useState(currentYear);
  const [week, setWeek] = useState(DEFAULT_WEEK);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [packingRows, setPackingRows] = useState([]);
  const [cells, setCells] = useState({});
  const [selectedKey, setSelectedKey] = useState('');
  const [draft, setDraft] = useState(null);
  const storageKey = `china-volume-board:${year}:${week}`;

  const load = async () => {
    setLoading(true); setError('');
    try {
      const result = await apiGet('/api/stats/pivot-data', { orderYear: year, weekStart: week, weekEnd: week });
      setData(result);
      const saved = localStorage.getItem(`china-volume-board:${year}:${week}`);
      setCells(saved ? JSON.parse(saved) : {});
      setPackingRows([]);
    } catch (e) { setError(e.message || '물량표 조회 실패'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const chinaRows = useMemo(() => (data?.rows || []).filter(row => /중국/i.test(String(row.country || ''))), [data]);
  const customers = useMemo(() => {
    const used = new Set();
    chinaRows.forEach(row => Object.entries(row.outOrders || {}).forEach(([name, qty]) => Number(qty || 0) > 0 && used.add(name)));
    return (data?.customers || []).filter(customer => used.has(customer.custName));
  }, [data, chinaRows]);

  const handleUpload = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !data) return;
    setError('');
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      const matched = matchChinaPackingRows(parseChinaPackingRows(aoa), data);
      setPackingRows(matched);
      const automatic = mergeChinaPackingIntoPivotCells(matched, data);
      setCells(previous => {
        const next = { ...previous, ...automatic };
        localStorage.setItem(storageKey, JSON.stringify(next));
        return next;
      });
    } catch (e) { setError(`패킹리스트 분석 실패: ${e.message || e}`); }
  };

  const openCell = (row, customer) => {
    const key = `${customer.custKey}:${row.prodKey}`;
    const currentQty = Number(row.outOrders?.[customer.custName] || 0);
    const saved = cells[key];
    setSelectedKey(key);
    setDraft({
      customerName: customer.custName,
      productName: row.prodName,
      quantity: saved?.quantity ?? currentQty,
      allocations: (saved?.allocations || []).map(item => ({ ...item })),
    });
  };

  const saveCell = () => {
    const next = { ...cells, [selectedKey]: { quantity: draft.quantity, allocations: draft.allocations } };
    setCells(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
    setDraft(null); setSelectedKey('');
  };

  const matchedCount = packingRows.filter(row => row.mappingStatus === 'MATCHED').length;

  const downloadExcel = () => {
    if (!data) return;
    const sheet = XLSX.utils.aoa_to_sheet(buildChinaVolumeWorkbookRows({ year, week, rows: chinaRows, customers, cells }));
    sheet['!cols'] = [{ wch: 48 }, ...customers.map(() => ({ wch: 16 }))];
    sheet['!rows'] = [{ hpt: 26 }, { hpt: 20 }, ...chinaRows.map(() => ({ hpt: 24 }))];
    sheet['!autofilter'] = { ref: `A2:${XLSX.utils.encode_col(customers.length)}${chinaRows.length + 2}` };
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, '중국물량표');
    XLSX.writeFile(workbook, `${year}_${week}_자동중국물량표.xlsx`);
  };

  return (
    <>
      <Head><title>자동 중국물량표 - nenova ERP</title></Head>
      <div className="page">
        <header className="titlebar"><b>자동 중국물량표</b><span>1920×1080 기준</span><button onClick={() => window.opener ? window.close() : router.push('/dashboard')}>닫기</button></header>
        <div className="toolbar">
          <label>연도<input type="number" value={year} onChange={e => setYear(Number(e.target.value))} /></label>
          <label>차수<input value={week} onChange={e => setWeek(e.target.value)} placeholder="35-01" /></label>
          <button className="load" onClick={load} disabled={loading}>{loading ? '조회 중…' : '중국 물량표 조회'}</button>
          <label className={`upload ${!data ? 'disabled' : ''}`}>패킹리스트 업로드<input type="file" accept=".xlsx,.xls" onChange={handleUpload} disabled={!data} /></label>
          <button onClick={downloadExcel} disabled={!data}>엑셀 다운로드</button>
          <span className="legend"><i>16</i> 빨간 번호는 패킹 박스 · 셀마다 클릭 수정</span>
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        <main>
          <section className="board-wrap">
            {!data && !loading && <div className="empty">연도·차수를 조회한 뒤 패킹리스트를 업로드하세요.</div>}
            {data && (
              <table className="board">
                <thead><tr><th className="product-head">품종 · 품목</th>{customers.map(customer => <th key={customer.custKey}>{customer.custName}<small>{customer.orderCode || ''}</small></th>)}</tr></thead>
                <tbody>{chinaRows.map(row => (
                  <tr key={row.prodKey}>
                    <th title={chinaVolumeProductLabel(row.prodName)}><small>{row.flower}</small><span>{chinaVolumeProductLabel(row.prodName)}</span></th>
                    {customers.map(customer => {
                      const key = `${customer.custKey}:${row.prodKey}`;
                      const originalQty = Number(row.outOrders?.[customer.custName] || 0);
                      const saved = cells[key];
                      const quantity = saved?.quantity ?? originalQty;
                      const allocations = saved?.allocations || [];
                      return <td key={key} className={`${quantity > 0 ? 'active' : ''} ${allocations.length ? 'boxed' : ''}`} onClick={() => openCell(row, customer)}>
                        <span className="qty">{quantity > 0 ? fmt(quantity) : ''}</span><BoxBadges allocations={allocations} />
                      </td>;
                    })}
                  </tr>
                ))}</tbody>
              </table>
            )}
          </section>
          <aside>
            <div className="aside-title"><b>업로드 입고원장</b><span>{packingRows.length ? `${matchedCount}/${packingRows.length}건 매칭` : '업로드 대기'}</span></div>
            <p>Customer 코드는 거래처 Client No., Item Name은 중국 품목으로 자동 매칭합니다.</p>
            <div className="packing-list">
              {packingRows.map((row, index) => <article key={`${row.sourceRow}-${index}`} className={row.mappingStatus === 'MATCHED' ? 'matched' : 'unmatched'}>
                <header><b>{row.customerCode}</b><span>{row.sourceBoxText}</span></header>
                <strong>{row.sourceItemName}</strong><div>{fmt(row.quantity)} · {row.allocations.map(a => <i key={`${a.boxNo}-${a.quantity}`}>{a.boxNo}:{fmt(a.quantity)}</i>)}</div>
                <small>{row.mappingStatus === 'MATCHED' ? `${row.customer.custName} / ${row.product.prodName}` : row.mappingStatus === 'CUSTOMER_UNMATCHED' ? '업체 매칭 필요' : '품목 매칭 필요'}</small>
              </article>)}
              {!packingRows.length && <div className="aside-empty">예: ROSE Diana 20단 / NO.16.17<br />→ 16번 10단 + 17번 10단</div>}
            </div>
          </aside>
        </main>
      </div>
      <CellEditor draft={draft} onChange={setDraft} onClose={() => setDraft(null)} onSave={saveCell} />
      <style jsx global>{`
        html,body,#__next{height:100%;margin:0} body{overflow:hidden;font-family:Arial,'맑은 고딕',sans-serif;background:#eef1f5;color:#172033}
        *{box-sizing:border-box} button,input{font:inherit}.page{height:100vh;display:flex;flex-direction:column}.titlebar{height:30px;flex:none;background:linear-gradient(90deg,#071780,#087bc2);color:#fff;display:flex;align-items:center;padding:0 10px;font-size:12px;gap:12px}.titlebar span{font-weight:400;opacity:.8}.titlebar button{margin-left:auto;color:#fff;background:transparent;border:1px solid #ffffff66;border-radius:3px;padding:2px 12px}.toolbar{height:48px;flex:none;display:flex;align-items:center;gap:7px;padding:5px 8px;background:#fff;border-bottom:1px solid #cdd5df;font-size:12px}.toolbar label:not(.upload){display:flex;align-items:center;gap:4px}.toolbar input{height:28px;border:1px solid #aeb9c8;border-radius:4px;padding:3px 6px}.toolbar label:first-child input{width:70px}.toolbar label:nth-child(2) input{width:82px}.toolbar button,.upload{height:29px;border:1px solid #9aa9bc;background:#fff;border-radius:4px;padding:5px 11px;cursor:pointer}.toolbar .load,.upload{background:#155bd7;color:#fff;border-color:#155bd7;font-weight:700}.upload input{display:none}.upload.disabled{opacity:.45;cursor:not-allowed}.legend{margin-left:auto;color:#677388}.legend i,.box-badge{font-style:normal;color:#d31616;border:1px solid #e32626;background:#fff6f6;border-radius:3px;font-weight:800}.legend i{padding:1px 4px}.error{flex:none;background:#fff0f0;color:#b00020;padding:5px 10px;font-size:12px;border-bottom:1px solid #efb5bd}main{display:grid;grid-template-columns:minmax(0,1fr) 390px;min-height:0;flex:1;gap:6px;padding:6px}.board-wrap,aside{background:#fff;border:1px solid #cbd3de;border-radius:5px;min-height:0;overflow:auto}.empty{padding:50px;text-align:center;color:#7c8797}.board{border-collapse:separate;border-spacing:0;font-size:11px;min-width:100%}.board th,.board td{border-right:1px solid #dde2e8;border-bottom:1px solid #dde2e8}.board thead th{position:sticky;top:0;z-index:4;background:#e8eef7;height:42px;min-width:92px;max-width:92px;padding:3px}.board thead small{display:block;color:#78869a;font-weight:400}.board .product-head,.board tbody th{position:sticky;left:0;z-index:5;min-width:205px;max-width:205px;background:#f7f9fc;text-align:left}.board tbody th{height:38px;padding:3px 7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.board tbody th small{display:block;color:#6c7890;font-weight:400}.board td{position:relative;width:92px;min-width:92px;max-width:92px;height:38px;min-height:38px;text-align:center;cursor:pointer;background:#fff}.board td:hover{outline:2px solid #276fea;outline-offset:-2px}.board td.active{background:#f8fbff}.board td.boxed{background:#fffaf9}.qty{font-weight:800;color:#153b7a}.box-badges{position:absolute;right:2px;top:2px;display:flex;gap:2px;max-width:58px;overflow:hidden;pointer-events:none}.box-badge{font-size:9px;line-height:13px;height:15px;min-width:18px;padding:0 2px;white-space:nowrap}.box-badge.more{background:#e32626;color:#fff}.aside-title{position:sticky;top:0;z-index:2;background:#172b55;color:#fff;padding:7px 9px;display:flex;justify-content:space-between;font-size:12px}aside>p{font-size:11px;color:#667286;margin:7px 9px}.packing-list{padding:0 7px 8px}.packing-list article{padding:7px;margin-bottom:5px;border:1px solid #d7dde6;border-left:4px solid #239b56;border-radius:4px;font-size:11px}.packing-list article.unmatched{border-left-color:#e24b3b;background:#fff7f5}.packing-list article header{display:flex;justify-content:space-between;color:#56647a}.packing-list article strong{display:block;margin:3px 0}.packing-list article i{font-style:normal;color:#d31616;border:1px solid #ee9b9b;border-radius:3px;padding:1px 3px;margin-left:3px}.packing-list article small{display:block;margin-top:4px;color:#64748b}.aside-empty{text-align:center;color:#8894a5;padding:35px 10px;line-height:1.8}.modal-shade{position:fixed;inset:0;z-index:100;background:#08122688;display:flex;align-items:center;justify-content:center}.cell-modal{width:510px;max-height:85vh;background:#fff;border-radius:7px;box-shadow:0 15px 60px #0006;overflow:auto}.cell-modal>header{height:36px;background:#183b72;color:#fff;display:flex;align-items:center;padding:0 12px}.cell-modal>header button{margin-left:auto;background:transparent;color:#fff;border:0;font-size:22px}.modal-meta{padding:10px 13px;border-bottom:1px solid #e1e6ec}.modal-meta span,.modal-meta small{display:block;margin-top:3px}.modal-meta small{color:#b42318}.qty-field{display:flex;align-items:center;justify-content:space-between;padding:10px 13px;font-weight:700}.qty-field input{width:150px}.cell-modal input{height:29px;border:1px solid #aeb9c8;border-radius:4px;padding:3px 6px}.alloc-title{display:flex;justify-content:space-between;padding:7px 13px;background:#f3f6fa;font-size:12px}.alloc-title span{color:#657187}.alloc-list{padding:8px 13px}.alloc-row{display:grid;grid-template-columns:1fr 1fr 52px;gap:7px;margin-bottom:6px;align-items:end}.alloc-row label{font-size:11px}.alloc-row input{display:block;width:100%;margin-top:2px}.remove{height:29px;border:1px solid #e1a5a5;background:#fff;color:#b42318;border-radius:4px}.add-box{margin:0 13px 8px;border:1px dashed #df5454;background:#fff8f8;color:#c51f1f;border-radius:4px;padding:5px 10px}.allocation-check{margin:2px 13px;padding:7px;border-radius:4px;font-size:12px;font-weight:700}.allocation-check.ok{background:#eaf8ef;color:#176b35}.allocation-check.bad{background:#fff0f0;color:#ad1622}.cell-modal footer{display:flex;justify-content:flex-end;gap:7px;padding:10px 13px;border-top:1px solid #e2e7ed}.cell-modal footer button{padding:6px 17px;border:1px solid #aeb9c8;background:#fff;border-radius:4px}.cell-modal footer .primary{background:#155bd7;color:#fff;border-color:#155bd7}.cell-modal footer .primary:disabled{opacity:.45}
        .board .product-head,.board tbody th{min-width:330px;max-width:330px}.board tbody th{overflow:visible;text-overflow:clip}.board tbody th span{display:block;white-space:nowrap}.qty{position:absolute;left:2px;width:28px;top:12px;text-align:center}.box-badges{left:auto;right:2px;top:2px;bottom:2px;width:58px;max-width:58px;display:flex;align-content:center;justify-content:flex-start;flex-wrap:wrap;gap:2px;overflow:hidden}.box-badge{font-size:10px;padding:0 2px;min-width:0;box-shadow:0 0 0 1px #fff}.box-badge[data-digits="1"]{width:16px}.box-badge[data-digits="2"]{width:20px}.box-badge[data-digits="3"]{width:26px}
        @media(max-width:1200px){main{grid-template-columns:minmax(0,1fr) 320px}.legend{display:none}}
        @media print{.titlebar,.toolbar,aside,.error{display:none!important}body{overflow:visible}.page,main{height:auto;display:block;padding:0}.board-wrap{border:0;overflow:visible}.board thead th,.board tbody th{position:static}.box-badge{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
      `}</style>
    </>
  );
}
