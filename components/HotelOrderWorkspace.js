import { useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPost } from '../lib/useApi';
import { buildHotelOrderRows, hotelRegistrationPlan } from '../lib/hotelOrderWorkspace';

const STORE = 'hotel-order-workspace-v1';
const fmt = n => Number(n).toLocaleString('ko-KR', { maximumFractionDigits: 6 });
const empty = () => ({ year: String(new Date().getFullYear()), week: '', request: [], purchase: [], allocations: {}, pinned: [], raum: '', surplus: '', receipts: [], history: [], frozen: false, texts: { request: '', purchase: '' } });

export default function HotelOrderWorkspace() {
  const [work, setWork] = useState(empty), [ready, setReady] = useState(false);
  const [customers, setCustomers] = useState([]), [products, setProducts] = useState({});
  const texts = work.texts || { request: '', purchase: '' };
  const setTexts = update => setWork(w => ({ ...w, texts: typeof update === 'function' ? update(w.texts || { request: '', purchase: '' }) : update }));
  const [saved, setSaved] = useState(''), [saving, setSaving] = useState(false), [storageError, setStorageError] = useState('');
  const [records, setRecords] = useState([]), [browseYear, setBrowseYear] = useState(String(new Date().getFullYear())), [browseWeek, setBrowseWeek] = useState('');
  const [legacy, setLegacy] = useState(null);
  const meta = useRef({ id: '', revision: 0 }), savedJson = useRef(''), queue = useRef(Promise.resolve()), failed = useRef(false), epoch = useRef(0);
  const dirty = JSON.stringify(work) !== savedJson.current && !!work.week;
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [info, setInfo] = useState('');
  const [search, setSearch] = useState(''), [picker, setPicker] = useState(null), [hits, setHits] = useState([]);
  const [vendor, setVendor] = useState(''), [preview, setPreview] = useState(null), [sheets, setSheets] = useState(null);
  const lock = useRef(false), focus = useRef(null), lookup = useRef(0), storageKey = useRef('');
  const blocked = !!busy || saving || !!storageError || work.frozen || !ready;
  const model = useMemo(() => buildHotelOrderRows(work.request, work.purchase, products, work.allocations), [work, products]);
  const patch = value => { setPreview(null); setWork(w => ({ ...w, ...value })); };
  function persist(next) {
    const snapshot = JSON.parse(JSON.stringify(next)), generation = epoch.current;
    const run = queue.current.then(async () => {
      if (generation !== epoch.current) return;
      if (failed.current) throw Error('서버 저장 상태를 확인하세요. 현재 내용을 다운로드하고 서버 작업을 다시 불러오세요.');
      if (!snapshot.week) throw Error('먼저 차수를 선택하세요.');
      const json = JSON.stringify(snapshot);
      if (json === savedJson.current) return;
      setSaving(true);
      try {
        if (!meta.current.id) meta.current.id = crypto.randomUUID();
        const d = await apiPost('/api/sales/hotel-order-drafts', { ...meta.current, expectedRevision: meta.current.revision, work: snapshot });
        meta.current = { id: d.record.id, revision: d.record.revision };
        savedJson.current = json; setSaved(d.record.updatedAt); setStorageError('');
      } catch (e) { failed.current = true; setStorageError(e.message); throw e; }
      finally { setSaving(false); }
    });
    queue.current = run.catch(() => {});
    return run;
  }
  const storeNow = async next => { setWork(next); await persist(next); };
  async function refreshList() {
    if (!browseWeek || busy || saving) return;
    setBusy('서버 작업 목록 조회'); setError('');
    try { const d = await apiGet('/api/sales/hotel-order-drafts', { year: browseYear, week: browseWeek }); setRecords(d.records); }
    catch (e) { setError(e.message); } finally { setBusy(''); }
  }
  async function loadDraft(id, year = browseYear, week = browseWeek) {
    if (busy || saving) return;
    if (dirty && !window.confirm('현재 미저장 내용을 서버 저장본으로 바꿀까요? 필요한 내용은 먼저 다운로드하세요.')) return;
    epoch.current++; setBusy('서버 작업 불러오기'); setPreview(null); setError('');
    try {
      await queue.current;
      const d = await apiGet('/api/sales/hotel-order-drafts', { year, week, id });
      meta.current = { id, revision: d.record.revision }; failed.current = false; savedJson.current = JSON.stringify(d.record.work);
      setWork(d.record.work); setSaved(d.record.updatedAt); setStorageError(''); setSheets(null);
      const catalog = await apiGet('/api/products/search'); setProducts(Object.fromEntries((catalog.products || []).map(p => [Number(p.ProdKey), p])));
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  }
  async function retryStorage() {
    if (!meta.current.id || busy || saving) return;
    setBusy('서버 저장 상태 확인'); setError('');
    try {
      await queue.current;
      let record;
      try { record = (await apiGet('/api/sales/hotel-order-drafts', { year: work.year, week: work.week, id: meta.current.id })).record; }
      catch (e) { if (e.status !== 404) throw e; }
      if (record && JSON.stringify(record.work) === JSON.stringify(work)) {
        meta.current.revision = record.revision; savedJson.current = JSON.stringify(work); setSaved(record.updatedAt); failed.current = false; setStorageError('');
      } else {
        if ((record?.revision ?? 0) !== meta.current.revision) throw Error('다른 저장본이 있습니다. 현재 내용을 다운로드한 뒤 서버 작업을 다시 불러오세요.');
        failed.current = false; setStorageError(''); await persist(work);
      }
      setInfo('초안·결과 저장 상태를 확인했습니다. 주문등록을 다시 실행하지 않았습니다.');
    } catch (e) { failed.current = true; setStorageError(e.message); } finally { setBusy(''); }
  }
  async function importLegacy() {
    if (!window.confirm('이 PC의 기존 초안을 서버로 가져올까요? 이미 옮긴 초안이면 최신 서버 작업을 엽니다. 브라우저 원본은 유지됩니다.')) return;
    setBusy('기존 초안 가져오기'); setError(''); epoch.current++;
    try {
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(legacy))))].map(n => n.toString(16).padStart(2, '0')).join('');
      const id = `${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20,32)}`;
      let record;
      try { record = (await apiGet('/api/sales/hotel-order-drafts', { year: legacy.year, week: legacy.week, id })).record; }
      catch (e) { if (e.status !== 404) throw e; }
      meta.current = { id, revision: record?.revision || 0 }; failed.current = false; setStorageError(''); setPreview(null);
      const next = record?.work || { ...empty(), ...legacy };
      savedJson.current = record ? JSON.stringify(next) : ''; setSaved(record?.updatedAt || ''); setWork(next); setLegacy(null);
      const catalog = await apiGet('/api/products/search'); setProducts(Object.fromEntries((catalog.products || []).map(p => [Number(p.ProdKey), p])));
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  }
  function newWork() {
    if (!window.confirm('새 작업을 시작할까요? 서버에 저장된 이전 작업은 목록에서 다시 열 수 있습니다. 미저장 내용은 먼저 다운로드하세요.')) return;
    epoch.current++; meta.current = { id: '', revision: 0 }; savedJson.current = ''; failed.current = false;
    setWork({ ...empty(), pinned: work.pinned, raum: work.raum, surplus: work.surplus }); setSaved(''); setStorageError(''); setError(''); setInfo(''); setPreview(null); setSheets(null);
  }
  useEffect(() => {
    apiGet('/api/auth/me').then(d => {
      if (!d.user?.userId) throw Error('로그인 사용자를 확인하지 못했습니다.');
      storageKey.current = `${STORE}:${d.user.userId}`;
      try { const saved = JSON.parse(localStorage.getItem(storageKey.current) || 'null'); if (saved) setLegacy(saved); } catch { setInfo('기존 브라우저 초안을 읽지 못했습니다. 서버 작업은 정상 사용할 수 있습니다.'); }
      setReady(true);
    }).catch(e => setError(`초안 준비 실패: ${e.message}`));
    apiGet('/api/customers/search').then(d => {
      const list = d.customers || d.rows || []; setCustomers(list);
      const unique = text => { const found = list.filter(c => c.CustName?.includes(text)); return found.length === 1 ? String(found[0].CustKey) : ''; };
      setWork(w => ({ ...w, raum: w.raum || unique('라움'), surplus: w.surplus || unique('호텔여분') }));
    }).catch(e => setError(e.message));
  }, []);
  useEffect(() => {
    if (!ready || !work.week || busy || saving || storageError || !dirty) return;
    const timer = setTimeout(() => { persist(work).catch(() => {}); }, 1500);
    return () => clearTimeout(timer);
  }, [ready, work, busy, saving, storageError, dirty]);
  useEffect(() => {
    let live = true;
    const keys = [...new Set([...work.request, ...work.purchase].map(r => Number(r.prodKey)).filter(Boolean))];
    if (!keys.length) return;
    // Active product search returns canonical factors, without the legacy board box override.
    apiGet('/api/products/search').then(d => { if (live) setProducts(Object.fromEntries((d.products || []).map(p => [Number(p.ProdKey), p]))); }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [ready]); // restored drafts need fresh product factors
  useEffect(() => {
    if (!picker) return;
    const seq = ++lookup.current;
    const timer = setTimeout(() => apiGet('/api/products/search', { q: search }).then(d => { if (seq === lookup.current) setHits((d.products || []).slice(0, 100)); }).catch(e => setError(e.message)), 250);
    return () => { clearTimeout(timer); lookup.current++; };
  }, [search, picker]);
  useEffect(() => { if (picker) focus.current?.focus(); }, [picker]);
  useEffect(() => {
    const handler = e => { if (busy || saving || dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', handler); return () => window.removeEventListener('beforeunload', handler);
  }, [busy, saving, dirty]);

  async function parse(side, file, sheet) {
    if (lock.current || blocked) return;
    if (!work.week) { setError('먼저 연도와 차수를 선택하세요.'); return; }
    lock.current = true; setBusy(`${side === 'request' ? '요청' : '발주'} 자료 매칭 중`); setError('');
    try {
      let d;
      if (file) {
        const fd = new FormData(); fd.append('file', file); if (sheet) fd.append('sheet', sheet);
        const res = await fetch('/api/sales/hotel-miu-parse', { method: 'POST', credentials: 'include', body: fd });
        d = await res.json(); if (!res.ok || !d.success) throw Error(d.error || '파일 분석 실패');
        if (d.sheetNames) { setSheets({ side, file, names: d.sheetNames }); return; }
      } else d = await apiPost('/api/sales/hotel-miu-parse', { text: texts[side] });
      const rows = (d.items || []).filter(r => !r.skip).map(r => ({ ...r, id: crypto.randomUUID(), source: file?.name || '붙여넣기', originalQty: r.qty, originalUnit: r.unit }));
      if (!rows.length) throw Error(`품명·수량 열을 확인하세요. ${(d.logs || []).join(' / ')}`);
      setProducts(p => ({ ...p, ...Object.fromEntries((d.products || []).map(x => [Number(x.ProdKey), x])) }));
      setWork(w => ({ ...w, [side]: [...w[side], ...rows], allocations: {} })); setPreview(null);
      setTexts(t => ({ ...t, [side]: '' })); setSheets(null);
      setInfo(`${rows.length}행을 추가했습니다. 원문·매칭·단위·수량을 확인하세요. ${(d.logs || []).join(' / ')}`);
    } catch (e) { setError(e.message); } finally { lock.current = false; setBusy(''); }
  }
  function editLine(side, id, update) {
    patch({ [side]: work[side].map(r => r.id === id ? { ...r, ...update } : r), allocations: {} });
  }
  async function chooseProduct(p) {
    const selected = picker, line = work[selected.side].find(r => r.id === selected.id);
    editLine(selected.side, selected.id, { prodKey: p.ProdKey, prodName: p.DisplayName || p.ProdName, unit: line.unit || p.OutUnit });
    setProducts(v => ({ ...v, [p.ProdKey]: p })); setPicker(null);
    document.getElementById(`match-${selected.id}`)?.focus();
    try { await apiPost('/api/sales/hotel-miu-intake', { action: 'saveMapping', inputName: line.inputName, prod: { prodKey: p.ProdKey, prodName: p.ProdName, displayName: p.DisplayName, flowerName: p.FlowerName, counName: p.CounName }, unit: line.unit || p.OutUnit }); }
    catch (e) { setError(`이번 선택은 적용됐지만 매칭 기억 저장 실패: ${e.message}`); }
  }
  async function prepare() {
    if (lock.current || work.frozen) return;
    lock.current = true; setBusy('등록 전 현재 주문 조회'); setError('');
    try {
      const catalog = await apiGet('/api/products/search', { refresh: '1' });
      const freshProducts = Object.fromEntries((catalog.products || []).map(p => [Number(p.ProdKey), p]));
      const freshModel = buildHotelOrderRows(work.request, work.purchase, freshProducts, work.allocations);
      setProducts(freshProducts);
      if (JSON.stringify(freshModel) !== JSON.stringify(model)) throw Error('품목 정보가 변경되어 합산·분류표를 갱신했습니다. 다시 확인 후 등록하세요.');
      const groups = hotelRegistrationPlan(freshModel, { ...work, customers });
      for (const g of groups) {
        const data = await apiGet('/api/orders/my-customers', { year: g.year, week: g.week, custKey: g.custKey });
        g.items = g.items.map(it => {
          const p = (data.products || []).find(p => Number(p.ProdKey) === it.prodKey);
          if (Number(p?.CurrentOrderRows) > 1) throw Error(`${g.custName} ${it.prodName}: 중복 주문행을 먼저 확인하세요.`);
          if (p && p.OutUnit !== it.unit) throw Error(`${it.prodName}: 단위가 변경되었습니다. 다시 불러오세요.`);
          if (p && Number(p.CurrentQty) < 0) throw Error(`${it.prodName}: 현재 주문이 음수입니다. 기존 내역을 확인하세요.`);
          return { ...it, expectedCurrentQty: Number(p?.CurrentQty ?? 0) };
        });
      }
      setPreview(groups);
    } catch (e) { setError(e.message); } finally { lock.current = false; setBusy(''); }
  }
  async function register() {
    if (!preview || lock.current || work.frozen) return;
    lock.current = true; setBusy('주문등록 중'); setError('');
    let state = { ...work, frozen: true, receipts: [] };
    try {
      // Persist intent BEFORE the network write: a lost response cannot become a blind retry.
      await storeNow(state);
      for (const g of preview) {
        const receipt = { ...g, status: '결과 확인 필요', time: new Date().toISOString(), results: [] };
        state = { ...state, receipts: [...state.receipts, receipt] }; await storeNow(state);
        const response = await apiPost('/api/orders', { ...g, source: 'my-customer', orderMode: 'ADD' });
        if (!response.success || !response.verified) throw Error('서버 저장 결과 확인이 필요합니다. 재등록하지 말고 현재 주문을 대조하세요.');
        receipt.status = '등록·검증 완료'; receipt.results = response.results || []; receipt.warning = response.warning;
        state = { ...state, receipts: [...state.receipts.slice(0, -1), { ...receipt }] }; await storeNow(state);
      }
      setInfo('모든 업체의 주문등록과 서버 사후검증이 완료됐습니다. 아래 작업 전·후 내역을 확인하세요.');
    } catch (e) { setError(`등록 중단: ${e.message} 성공 업체는 다시 등록하지 마세요. 결과 확인 필요 업체는 주문내역과 대조하세요.`); }
    finally { lock.current = false; setBusy(''); setPreview(null); }
  }
  async function readback() {
    if (lock.current) return;
    lock.current = true; setBusy('현재 주문 대조');
    try {
      const receipts = [];
      for (const r of work.receipts) {
        const d = await apiGet('/api/orders/my-customers', { custKey: r.custKey, year: r.year, week: r.week });
        receipts.push({ ...r, current: Object.fromEntries((d.products || []).map(p => [p.ProdKey, p.CurrentQty])) });
      }
      await storeNow({ ...work, receipts });
    } catch (e) { setError(e.message); } finally { lock.current = false; setBusy(''); }
  }
  const customerOptions = <><option value="">업체 선택</option>{customers.map(c => <option key={c.CustKey} value={c.CustKey}>{c.CustName}</option>)}</>;
  return <section className="hotel-work">
    <h2>호텔 주문등록</h2>
    <p>차수 선택 → 요청·발주 자료 매칭 → 잔량 업체 분류 → 주문등록. 초안과 결과는 서버에 저장됩니다. 같은 계정으로 다른 PC에서도 차수별로 불러와 이어서 작업할 수 있습니다.</p>
    <section aria-label="서버 작업 보관">
      <h3>차수별 서버 작업</h3>
      <p role="status">{saving ? '서버 저장 중…' : storageError ? '서버 저장 실패 · 현재 내용은 화면에 남아 있습니다' : dirty ? '미저장 변경 · 잠시 후 자동 저장' : saved ? `서버 저장 완료 · ${new Date(saved).toLocaleString('ko-KR')} · 버전 ${meta.current.revision}` : '차수를 선택하면 자동 저장합니다.'}</p>
      {storageError && <><p role="alert" className="hotel-error">{storageError}</p><button data-tone="retry" disabled={!!busy || saving} onClick={retryStorage}>저장 상태 확인 · 재시도</button></>}
      <button data-tone="save" disabled={!ready || !work.week || !!busy || saving || !!storageError} onClick={() => persist(work).catch(() => {})}>서버에 지금 저장</button>
      {meta.current.id && <button data-tone="load" disabled={!!busy || saving} onClick={() => loadDraft(meta.current.id, work.year, work.week)}>현재 서버 작업 다시 불러오기</button>}
      <div><label>조회 연도 <input disabled={!!busy || saving} aria-label="서버 조회 연도" type="number" min="2020" max="2100" value={browseYear} onChange={e => { setBrowseYear(e.target.value); setRecords([]); }} /></label>
      <label>조회 차수 <select disabled={!!busy || saving} aria-label="서버 조회 차수" value={browseWeek} onChange={e => { setBrowseWeek(e.target.value); setRecords([]); }}><option value="">차수 선택</option>{Array.from({ length: 53 }, (_, i) => [1, 2, 3, 4].map(j => { const w = `${String(i + 1).padStart(2, '0')}-0${j}`; return <option key={w}>{w}</option>; }))}</select></label>
      <button data-tone="load" disabled={!browseWeek || !!busy || saving} onClick={refreshList}>차수별 작업 조회</button></div>
      <ul>{records.map(r => <li key={r.id}><button data-tone="load" disabled={!!busy || saving} onClick={() => loadDraft(r.id)}>{new Date(r.updatedAt).toLocaleString('ko-KR')} · {r.frozen ? '등록 시작·결과 보관' : '초안'} · 요청 {r.requestCount}행 / 발주 {r.purchaseCount}행 · 불러오기</button></li>)}</ul>
      {legacy && <button data-tone="save" disabled={!!busy || saving || dirty} onClick={importLegacy}>이 PC의 기존 초안 서버로 가져오기</button>}
    </section>
    <fieldset disabled={blocked || !ready || meta.current.revision > 0 || work.request.length > 0 || work.purchase.length > 0}>
      <legend>1. 주문 연도 · 차수</legend>
      <label>연도 <input aria-label="주문 연도" type="number" min="2020" max="2100" value={work.year} onChange={e => patch({ year: e.target.value, week: '' })} /></label>
      <label>차수 <select aria-label="주문 차수" value={work.week} onChange={e => patch({ week: e.target.value })}><option value="">차수 선택</option>{Array.from({ length: 53 }, (_, i) => [1, 2, 3, 4].map(j => { const w = `${String(i + 1).padStart(2, '0')}-0${j}`; return <option key={w}>{w}</option>; }))}</select></label>
    </fieldset>
    <div className="hotel-inputs">
      {['request', 'purchase'].map(side => <fieldset key={side} disabled={blocked || !work.week}>
        <legend>{side === 'request' ? '2. 요청수량 업로드' : '3. 발주수량 업로드'}</legend>
        <p>TXT · Excel · CSV · 이미지 / 텍스트·이미지 붙여넣기</p>
        <input aria-label={`${side === 'request' ? '요청' : '발주'} 파일 업로드`} type="file" accept=".txt,.tsv,.csv,.xlsx,.xls,image/png,image/jpeg,image/webp,image/gif" onChange={e => { parse(side, e.target.files?.[0]); e.target.value = ''; }} />
        <textarea aria-label={`${side === 'request' ? '요청' : '발주'} 텍스트 또는 이미지 붙여넣기`} rows={5} placeholder="품명 · 수량 · 단위가 있는 텍스트를 붙여넣거나 이미지를 붙여넣으세요." value={texts[side]} onChange={e => setTexts(t => ({ ...t, [side]: e.target.value }))} onPaste={e => {
          if (e.clipboardData.getData('text/plain')) return;
          const item = [...e.clipboardData.items].find(i => i.type.startsWith('image/'));
          if (item) { e.preventDefault(); parse(side, item.getAsFile()); }
        }} />
        <button data-tone="match" onClick={() => parse(side)} disabled={!texts[side].trim()}>텍스트 매칭 · 합산</button>
        <span> {work[side].length}행</span>
        <div className="hotel-scroll"><table><thead><tr><th>원문 / 출처</th><th>매칭 품목</th><th>수량</th><th>단위</th><th>삭제</th></tr></thead><tbody>
          {work[side].map(r => <tr key={r.id}><td>{r.inputName}<small>{r.source} · 원본 {r.originalQty} {r.originalUnit}</small></td><td><button data-tone="match" id={`match-${r.id}`} onClick={() => { setPicker({ side, id: r.id }); setSearch(r.inputName || ''); }}>{r.prodName || r.displayName || '품목 선택'}</button>{r.matchWarning && <small>{r.matchWarning}</small>}</td><td><input aria-label={`${r.inputName} 수량`} type="number" min="0" step="any" value={r.qty} onChange={e => editLine(side, r.id, { qty: e.target.value })} /></td><td><select aria-label={`${r.inputName} 단위`} value={r.unit || ''} onChange={e => editLine(side, r.id, { unit: e.target.value })}><option value="">선택</option>{['박스', '단', '송이', '대', '개'].map(u => <option key={u}>{u}</option>)}</select></td><td><button data-tone="danger" aria-label={`${r.inputName} 삭제`} onClick={() => patch({ [side]: work[side].filter(x => x.id !== r.id), allocations: {} })}>삭제</button></td></tr>)}
        </tbody></table></div>
      </fieldset>)}
    </div>
    {sheets && <fieldset disabled={!!busy}><legend>엑셀 시트 선택</legend>{sheets.names.map(name => <button data-tone="match" key={name} onClick={() => parse(sheets.side, sheets.file, name)}>{name}</button>)}<button onClick={() => setSheets(null)}>취소</button></fieldset>}
    <fieldset disabled={blocked}>
      <legend>4. 선택업체 분류</legend>
      <label>발주수량 → 라움 <select value={work.raum} onChange={e => patch({ raum: e.target.value })}>{customerOptions}</select></label>
      <label>완성 박스 잔량 → 호텔여분 <select value={work.surplus} onChange={e => patch({ surplus: e.target.value })}>{customerOptions}</select></label>
      <p>잔량 = 요청 − 발주. 정확히 1박스 이상은 완성 박스만 호텔여분으로 배정하고 나머지는 직접 분류합니다. 예: 잔량 75송이, 박스당 30송이 → 호텔여분 60, 분류필요 15.</p>
      <label>분류 업체 추가 <select value={vendor} onChange={e => setVendor(e.target.value)}>{customerOptions}</select></label><button data-tone="match" disabled={!vendor || work.pinned.includes(vendor)} onClick={() => patch({ pinned: [...work.pinned, vendor] })}>업체 고정 추가</button>
      {work.pinned.map(key => <button data-tone="danger" key={key} onClick={() => { const allocations = Object.fromEntries(Object.entries(work.allocations).map(([pk, row]) => [pk, Object.fromEntries(Object.entries(row).filter(([ck]) => ck !== key))])); patch({ pinned: work.pinned.filter(k => k !== key), allocations }); }}>{customers.find(c => String(c.CustKey) === key)?.CustName || key} 고정 취소</button>)}
      <div className="hotel-scroll"><table><thead><tr><th>품목 / 단위</th><th>요청수량</th><th>발주수량 · 라움</th><th>잔량</th><th>호텔여분</th><th>분류필요</th>{work.pinned.map(key => <th key={key}>{customers.find(c => String(c.CustKey) === key)?.CustName || key}</th>)}</tr></thead><tbody>
        {model.rows.map(r => <tr key={r.prodKey}><td>{r.prodName}<small>{r.unit} / 박스당 {fmt(r.perBox)}</small></td><td>{fmt(r.request)}</td><td>{fmt(r.purchase)}</td><td>{fmt(r.remaining)}</td><td>{fmt(r.surplus)}</td><td className={r.unassigned ? 'hotel-warning' : ''}>{fmt(r.unassigned)}</td>{work.pinned.map(key => <td key={key}><input aria-label={`${r.prodName} ${customers.find(c => String(c.CustKey) === key)?.CustName || key} 분류수량`} type="number" min="0" step="any" value={r.assigned[key] ?? ''} onChange={e => patch({ allocations: { ...work.allocations, [r.prodKey]: { ...r.assigned, [key]: e.target.value } } })} /><button data-tone="match" disabled={r.unassigned <= 0} onClick={() => patch({ allocations: { ...work.allocations, [r.prodKey]: { ...r.assigned, [key]: Number(r.assigned[key] || 0) + r.unassigned } } })}>잔량 배정</button></td>)}</tr>)}
      </tbody></table></div>
    </fieldset>
    {model.errors.length > 0 && <div role="alert" className="hotel-error">{model.errors.map((e, i) => <div key={i}>{e}</div>)}</div>}
    <button data-tone="order" disabled={blocked || !model.rows.length || !!model.errors.length} onClick={prepare}>주문등록 전 내역 확인</button>
    {preview && <section><h3>등록 전 확인 — {work.year} / {work.week}</h3><p>아래 수량을 기존 주문에 더합니다. 업체별로 저장하며, 중간 실패 시 완료된 업체는 유지됩니다.</p><table><thead><tr><th>업체</th><th>품목</th><th>작업 전</th><th>추가</th><th>예상 작업 후</th></tr></thead><tbody>{preview.flatMap(g => g.items.map(it => <tr key={`${g.custKey}-${it.prodKey}`}><td>{g.custName}</td><td>{it.prodName} ({it.unit})</td><td>{fmt(it.expectedCurrentQty)}</td><td>+{fmt(it.qty)}</td><td>{fmt(it.expectedCurrentQty + it.qty)}</td></tr>))}</tbody></table><button data-tone="order" disabled={blocked} onClick={register}>확인 · 주문등록 시작</button><button disabled={!!busy} onClick={() => setPreview(null)}>취소</button></section>}
    {busy && <p role="status">{busy}</p>}{error && <p role="alert" className="hotel-error">{error}</p>}{info && <p role="status">{info}</p>}
    {(work.frozen || work.history?.length > 0) && <section><h3>작업 전 · 작업 후 등록내역</h3><p>등록을 시작한 초안은 잠겨 있습니다. 결과가 불명확한 업체는 현재 주문을 대조한 뒤 별도 작업으로 처리하세요.</p><button data-tone="load" disabled={!!busy || saving || !!storageError} onClick={readback}>현재 주문 다시 조회</button>{[...(work.history || []), ...work.receipts].map((r, i) => <section key={i}><h4>{r.custName} · {r.year}/{r.week} · {r.status}</h4><p>{new Date(r.time).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} {r.warning}</p><table><thead><tr><th>품목</th><th>작업 전</th><th>등록량</th><th>작업 후 (서버 확인)</th><th>현재 조회</th></tr></thead><tbody>{r.items.map(it => { const result = r.results.find(x => Number(x.prodKey) === it.prodKey); return <tr key={it.prodKey}><td>{it.prodName} ({it.unit})</td><td>{fmt(result?.previousQty ?? it.expectedCurrentQty)}</td><td>{fmt(it.qty)}</td><td>{result ? fmt(result.finalQty) : '확인 필요'}</td><td>{r.current ? fmt(r.current[it.prodKey] ?? 0) : '미조회'}</td></tr>; })}</tbody></table></section>)}</section>}
    <button data-tone="load" disabled={!!busy || saving} onClick={newWork}>새 작업</button>
    <button disabled={!work.week} onClick={() => {
      const a = document.createElement('a'), url = URL.createObjectURL(new Blob([JSON.stringify(work, null, 2)], { type: 'application/json' })); a.href = url; a.download = `호텔주문-${work.year}-${work.week}.json`; a.click(); URL.revokeObjectURL(url);
    }}>초안 · 결과 다운로드</button>
    {picker && <div className="hotel-picker" role="dialog" aria-modal="true" aria-label="품목 매칭" onKeyDown={e => {
      if (e.key === 'Escape') { const id = picker.id; setPicker(null); document.getElementById(`match-${id}`)?.focus(); }
      if (e.key === 'Tab') { const all = [...e.currentTarget.querySelectorAll('button,input,select')]; const first = all[0], last = all[all.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }
    }}><h3>품목 선택</h3><input ref={focus} aria-label="품목 검색" value={search} onChange={e => setSearch(e.target.value)} /><select size={12} aria-label="품목 검색 결과" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); const p = hits.find(p => String(p.ProdKey) === e.currentTarget.value); if (p) chooseProduct(p); } }} id="hotel-product-choice"><option value="">품목 선택 후 아래 적용</option>{hits.map(p => <option key={p.ProdKey} value={p.ProdKey}>{p.DisplayName} / {p.ProdName} ({p.ProdKey})</option>)}</select><button data-tone="match" onClick={() => { const p = hits.find(p => String(p.ProdKey) === document.getElementById('hotel-product-choice').value); if (p) chooseProduct(p); }}>선택 적용</button><button onClick={() => { const id = picker.id; setPicker(null); document.getElementById(`match-${id}`)?.focus(); }}>닫기</button></div>}
    <style jsx>{`
      .hotel-work {padding:20px; color:#17243c; font-size:15px} h2 {margin-top:0} fieldset {border:1px solid #ccd7e5;border-radius:10px;padding:16px;margin:16px 0;min-width:0} legend {font-weight:700} label {display:inline-flex;gap:8px;align-items:center;margin:6px 12px 6px 0} input,select,textarea {font:inherit;border:1px solid #bac8db;border-radius:6px;padding:8px;background:white;color:#17243c} button {margin:4px} :focus-visible {outline:3px solid #2871dd;outline-offset:2px} input[type=number] {width:100px} textarea {width:100%;box-sizing:border-box;display:block;margin:10px 0} small {display:block;color:#586982;margin-top:5px} .hotel-inputs {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px} .hotel-scroll {overflow-x:auto} table {border-collapse:collapse;width:100%;margin:12px 0} td,th {padding:10px;border-bottom:1px solid #dfe5ed;text-align:left;vertical-align:top} th {background:#edf3fa;white-space:nowrap} .hotel-warning,.hotel-error {color:#a32b19;background:#fff1ec;padding:12px} .hotel-picker {position:fixed;z-index:2000;inset:10% 15%;background:white;box-shadow:0 0 0 100vmax #0007;padding:24px;overflow:auto;border-radius:12px} .hotel-picker select {display:block;width:100%;margin-top:12px} @media(max-width:1000px) {.hotel-inputs {grid-template-columns:1fr}.hotel-picker {inset:5%}.hotel-work {padding:10px}}
    `}</style>
  </section>;
}
