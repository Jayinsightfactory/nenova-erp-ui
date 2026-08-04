// 도착원가 — 차수별 원가자료 업로드·매칭·배분기준 관리

import { useCallback, useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Layout from '../components/Layout';

const BASIS = [
  ['SOURCE', '엑셀 원식'],
  ['WEIGHT', '중량 기준'],
  ['VOLUME', '부피·용적 기준'],
  ['VALUE', 'FOB 금액비례'],
  ['EQUAL', '균등배분'],
];

const fmt = (value, digits = 0) => value == null || value === ''
  ? '-'
  : Number(value).toLocaleString('ko-KR', { maximumFractionDigits: digits });

function basisLabel(value) {
  return BASIS.find(([key]) => key === value)?.[1] || value || '-';
}

function productOptionLabel(product) {
  return `${product.CounName || ''} · ${product.FlowerName || ''} · ${product.DisplayName || product.ProdName} (#${product.ProdKey})`;
}

function farmOptionLabel(farm) {
  return `${farm.FarmName} (#${farm.FarmKey})`;
}

export default function ArrivalCostPage() {
  const [filters, setFilters] = useState({
    orderYear: String(new Date().getFullYear()), orderWeek: '', country: '', flower: '', product: '', farm: '',
  });
  const [data, setData] = useState({ rows: [], imports: [], products: [], farms: [] });
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState({});
  const [history, setHistory] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== ''));
      const res = await fetch(`/api/arrival-cost?${qs}`, { credentials: 'same-origin' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || '도착원가 조회 실패');
      setData(json);
      const next = {};
      for (const row of json.rows || []) {
        next[row.arrivalLineKey] = {
        prodKey: row.prodKey || '', farmKey: row.farmKey || '', allocationBasis: row.allocationBasis || 'SOURCE', notes: row.notes || '',
        prodInput: row.prodKey ? productOptionLabel(json.products.find(p => Number(p.ProdKey) === Number(row.prodKey)) || { ProdKey: row.prodKey, ProdName: row.prodName || '' }) : '',
        farmInput: row.farmKey ? farmOptionLabel(json.farms.find(f => Number(f.FarmKey) === Number(row.farmKey)) || { FarmKey: row.farmKey, FarmName: row.farmName || '' }) : '',
      };
      }
      setDrafts(next);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const updateFilter = (key, value) => setFilters(prev => ({ ...prev, [key]: value }));
  const updateDraft = (id, key, value) => setDrafts(prev => ({ ...prev, [id]: { ...prev[id], [key]: value } }));
  const updateProductInput = (row, value) => {
    const match = data.products.find(p => productOptionLabel(p) === value || String(p.ProdKey) === value);
    setDrafts(prev => ({ ...prev, [row.arrivalLineKey]: { ...prev[row.arrivalLineKey], prodInput: value, prodKey: match?.ProdKey || '' } }));
  };
  const updateFarmInput = (row, value) => {
    const match = data.farms.find(f => farmOptionLabel(f) === value || String(f.FarmKey) === value);
    setDrafts(prev => ({ ...prev, [row.arrivalLineKey]: { ...prev[row.arrivalLineKey], farmInput: value, farmKey: match?.FarmKey || '' } }));
  };

  const upload = async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const file = formElement.elements.namedItem('file')?.files?.[0];
    if (!file) { setError('업로드할 엑셀 파일을 선택하세요.'); return; }
    setUploading(true); setError(''); setMessage('');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('orderYear', filters.orderYear);
      if (filters.orderWeek) form.append('orderWeek', filters.orderWeek);
      const res = await fetch('/api/arrival-cost/upload', { method: 'POST', body: form, credentials: 'same-origin' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || '업로드 실패');
      formElement.reset();
      setMessage(`${json.message} · 매칭 ${json.matchedCount}건 / 수동확인 ${json.unmatchedCount}건`);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  };

  const save = async (row) => {
    const draft = drafts[row.arrivalLineKey] || {};
    setError(''); setMessage('');
    try {
      const res = await fetch('/api/arrival-cost', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arrivalLineKey: row.arrivalLineKey, prodKey: draft.prodKey || null, farmKey: draft.farmKey || null, allocationBasis: draft.allocationBasis || 'SOURCE', notes: draft.notes || '' }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || '저장 실패');
      setMessage(`${row.orderWeek || '차수'} / ${row.productNameRaw} 저장 완료`);
      await load();
    } catch (e) { setError(e.message); }
  };

  const showHistory = async (row) => {
    try {
      const res = await fetch(`/api/arrival-cost/history?arrivalLineKey=${row.arrivalLineKey}`, { credentials: 'same-origin' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || '이력 조회 실패');
      setHistory({ row, rows: json.rows || [] });
    } catch (e) { setError(e.message); }
  };

  const weeks = useMemo(() => [...new Set(data.rows.map(row => row.orderWeek).filter(Boolean))], [data.rows]);
  const unmatched = data.rows.filter(row => row.matchStatus !== 'MATCHED').length;

  return (
    <Layout title="도착원가">
      <Head><title>도착원가 · NENOVA</title></Head>
      <div className="arrival-page">
        <div className="arrival-title-row">
          <div>
            <h2>도착원가</h2>
            <p>차수별 원가자료를 웹 전용 원장으로 관리합니다. 기존 입고·주문·출고·재고·손익 원장에는 자동 반영하지 않습니다.</p>
          </div>
          <span className="read-only-badge">웹 원장 전용</span>
        </div>

        <section className="arrival-card">
          <div className="section-title">엑셀 업로드</div>
          <form className="upload-row" onSubmit={upload}>
            <label>연도 <input value={filters.orderYear} onChange={e => updateFilter('orderYear', e.target.value)} /></label>
            <label>기본 차수 <input placeholder="파일에 차수가 있으면 비워두세요" value={filters.orderWeek} onChange={e => updateFilter('orderWeek', e.target.value)} /></label>
            <input name="file" type="file" accept=".xlsx,.xls" />
            <button className="primary" disabled={uploading}>{uploading ? '업로드 중…' : '엑셀 업로드'}</button>
          </form>
          <div className="hint">같은 연도·차수·국가를 다시 올리면 새 revision이 현재본이 되고, 기존 revision은 이력으로 남습니다.</div>
        </section>

        <section className="arrival-card">
          <div className="section-title">검색</div>
          <div className="filter-grid">
            <label>차수 <input value={filters.orderWeek} onChange={e => updateFilter('orderWeek', e.target.value)} placeholder="예: 29-1" onKeyDown={e => e.key === 'Enter' && load()} /></label>
            <label>국가 <input value={filters.country} onChange={e => updateFilter('country', e.target.value)} /></label>
            <label>품종 <input value={filters.flower} onChange={e => updateFilter('flower', e.target.value)} placeholder="장미·수국" /></label>
            <label>품목/색상 <input value={filters.product} onChange={e => updateFilter('product', e.target.value)} /></label>
            <label>농장 <input value={filters.farm} onChange={e => updateFilter('farm', e.target.value)} /></label>
            <button className="primary" onClick={load} disabled={loading}>{loading ? '조회 중…' : '조회'}</button>
          </div>
          <div className="summary-row">
            <span>현재본 {data.rows.length.toLocaleString()}행</span>
            <span>매칭확인 필요 {unmatched.toLocaleString()}행</span>
            <span>차수 {weeks.join(', ') || '-'}</span>
          </div>
        </section>

        {message && <div className="notice success">{message}</div>}
        {error && <div className="notice error">{error}</div>}

        <section className="arrival-card table-card">
          <div className="section-title">도착원가 내역 <span className="muted">(현재 revision)</span></div>
          {loading ? <div className="empty">조회 중입니다.</div> : data.rows.length === 0 ? <div className="empty">업로드된 도착원가 자료가 없습니다.</div> : (
            <div className="table-wrap">
              <table>
                <thead><tr>
                  <th>차수</th><th>국가</th><th>품종</th><th>원본 품목명</th><th>전산 품목 매칭</th><th>원본 농장</th><th>전산 농장 선택</th>
                  <th>수량</th><th>원가(엑셀)</th><th>기준</th><th>선택 원가</th><th>메모</th><th>저장</th>
                </tr></thead>
                <tbody>{data.rows.map(row => {
                  const draft = drafts[row.arrivalLineKey] || {};
                  return <tr key={row.arrivalLineKey} className={row.matchStatus === 'MATCHED' ? '' : 'needs-match'}>
                    <td>{row.orderWeek || '-'}</td>
                    <td>{row.countryName || row.dbCountryName || '-'}</td>
                    <td>{row.flowerNameRaw || row.dbFlowerName || '-'}</td>
                    <td className="raw-name" title={row.productNameRaw}>{row.productNameRaw}</td>
                    <td><input list="arrival-product-options" value={draft.prodInput || ''} onChange={e => updateProductInput(row, e.target.value)} placeholder="품목 검색·선택" /></td>
                    <td>{row.farmNameRaw || '-'}</td>
                    <td><input list="arrival-farm-options" value={draft.farmInput || ''} onChange={e => updateFarmInput(row, e.target.value)} placeholder="농장 검색·선택" /></td>
                    <td className="num">{fmt(row.quantity, 2)} {row.unit}</td>
                    <td className="num">{fmt(row.sourceArrivalCostKRW)}원</td>
                    <td><select value={draft.allocationBasis || 'SOURCE'} onChange={e => updateDraft(row.arrivalLineKey, 'allocationBasis', e.target.value)}>
                      {BASIS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                    </select></td>
                    <td className="num selected-cost">{fmt(row.selectedArrivalCostKRW)}원</td>
                    <td><input value={draft.notes || ''} onChange={e => updateDraft(row.arrivalLineKey, 'notes', e.target.value)} placeholder="메모" /></td>
                    <td className="actions"><button onClick={() => save(row)}>저장</button><button onClick={() => showHistory(row)}>이력</button></td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
          )}
        </section>

        <section className="arrival-card">
          <div className="section-title">업로드 이력</div>
          <div className="import-list">{data.imports.length === 0 ? <span className="muted">아직 업로드 이력이 없습니다.</span> : data.imports.map(item => <div key={item.ImportKey}><strong>revision {item.RevisionNo}</strong> · {item.UploadFileName} · {item.UploadedAt ? new Date(item.UploadedAt).toLocaleString('ko-KR') : '-'} · {item.UploadedByName || '-'}</div>)}</div>
        </section>
      </div>

      <datalist id="arrival-product-options">{data.products.map(p => <option key={p.ProdKey} value={productOptionLabel(p)} />)}</datalist>
      <datalist id="arrival-farm-options">{data.farms.map(f => <option key={f.FarmKey} value={farmOptionLabel(f)} />)}</datalist>

      {history && <div className="modal-backdrop" onClick={() => setHistory(null)}><div className="history-modal" onClick={e => e.stopPropagation()}><div className="modal-title">변경 이력 — {history.row.productNameRaw}<button onClick={() => setHistory(null)}>닫기</button></div>{history.rows.length === 0 ? <div className="empty">이력이 없습니다.</div> : history.rows.map(item => <div className="history-item" key={item.HistoryKey}><strong>{item.ActionType}</strong> · {item.ChangedByName || item.ChangedBy} · {item.ChangedAt ? new Date(item.ChangedAt).toLocaleString('ko-KR') : ''}</div>)}</div></div>}

      <style jsx>{`
        .arrival-page { min-height:100vh; padding:14px; background:#f4f6f9; color:#172033; }
        .arrival-title-row { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:12px; }
        h2 { margin:0 0 5px; font-size:21px; } p { margin:0; color:#657080; font-size:12px; }
        .read-only-badge { padding:5px 10px; color:#0b5d42; background:#e7f7ef; border:1px solid #b6e6cc; border-radius:4px; font-size:12px; font-weight:700; white-space:nowrap; }
        .arrival-card { background:#fff; border:1px solid #d7dee8; border-radius:6px; margin-bottom:10px; padding:12px; box-shadow:0 1px 2px #13213b0a; }
        .section-title { font-weight:700; font-size:14px; margin-bottom:9px; color:#163d76; } .muted,.hint { color:#7a8797; font-size:11px; font-weight:400; }
        .upload-row,.filter-grid { display:flex; flex-wrap:wrap; gap:8px; align-items:center; } label { display:flex; align-items:center; gap:5px; font-size:12px; } input,select { border:1px solid #b9c4d1; border-radius:3px; background:#fff; min-height:28px; padding:3px 6px; font:inherit; font-size:12px; } input:focus,select:focus { outline:2px solid #b9d9ff; border-color:#4b91dd; }
        .upload-row input[type=file] { min-width:260px; } .filter-grid label input { width:130px; } .filter-grid label:nth-child(4) input { width:230px; }
        button { border:1px solid #aab7c7; background:#f5f7fa; border-radius:3px; padding:5px 9px; cursor:pointer; font:inherit; font-size:12px; } button:hover { background:#eaf2fb; } button.primary { background:#1565c0; color:#fff; border-color:#1565c0; font-weight:700; } button:disabled { opacity:.55; cursor:wait; }
        .hint { margin-top:8px; } .summary-row { display:flex; flex-wrap:wrap; gap:18px; margin-top:10px; font-size:12px; color:#506074; }
        .notice { padding:9px 12px; margin:8px 0; border-radius:4px; font-size:12px; } .notice.success { color:#0b5d42; background:#e7f7ef; border:1px solid #b6e6cc; } .notice.error { color:#a12d2d; background:#fff0f0; border:1px solid #f0b7b7; }
        .table-card { padding:0; overflow:hidden; } .table-card .section-title { padding:12px 12px 0; } .table-wrap { overflow:auto; max-height:calc(100vh - 360px); border-top:1px solid #d7dee8; } table { border-collapse:collapse; width:max-content; min-width:1600px; font-size:11px; } th { position:sticky; top:0; z-index:2; background:#edf2f8; color:#32445d; } th,td { border-bottom:1px solid #e1e6ed; padding:6px 7px; vertical-align:middle; white-space:nowrap; } tr.needs-match { background:#fff9e9; } td.raw-name { max-width:260px; overflow:hidden; text-overflow:ellipsis; } td input { width:130px; } td:nth-child(5) input,td:nth-child(7) input { width:310px; } .num { text-align:right; font-variant-numeric:tabular-nums; } .selected-cost { color:#0b5d42; font-weight:700; } .actions { display:flex; gap:4px; } .empty { padding:28px; text-align:center; color:#8491a3; font-size:13px; } .import-list { font-size:12px; line-height:1.9; color:#506074; }
        .modal-backdrop { position:fixed; inset:0; z-index:20; display:flex; align-items:center; justify-content:center; background:#0006; } .history-modal { width:min(720px,92vw); max-height:80vh; overflow:auto; background:#fff; border-radius:6px; padding:14px; box-shadow:0 10px 40px #0005; } .modal-title { display:flex; justify-content:space-between; font-weight:700; margin-bottom:10px; color:#163d76; } .history-item { padding:8px 2px; border-bottom:1px solid #e4e8ee; font-size:12px; }
        @media (max-width:800px) { .arrival-page { padding:8px; } .arrival-title-row { display:block; } .read-only-badge { display:inline-block; margin-top:8px; } .table-wrap { max-height:none; } }
      `}</style>
    </Layout>
  );
}
