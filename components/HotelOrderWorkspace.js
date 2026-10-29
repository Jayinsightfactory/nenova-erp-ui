import { useEffect, useMemo, useRef, useState } from 'react';
import { apiGet as liveGet, apiPost as livePost } from '../lib/useApi';
import { buildHotelOrderRows, hotelRegistrationPlan, hasHotelDraftContent } from '../lib/hotelOrderWorkspace';
import { hotelMiuMajorWeekOptions } from '../lib/hotelMiuWeeks';
import { commitHotelReview, hotelNextBatchNumber, hotelSavedBatches, hotelBatchMatrix, editHotelBatchQuantity, hotelImageUrl, hotelSourceBox, recoverHotelSourceRows, recoverHotelWorkLocations } from '../lib/hotelOrderReview';

import HotelMatchReview from './HotelMatchReview';
import HotelQuantityMatrix from './HotelQuantityMatrix';
import HotelFinalQuantities from './HotelFinalQuantities';
import {specialHotelLine,rememberHotelSpecial,applyHotelSpecialMappings,hotelFinalQuantities,setHotelFinalQuantity,omitHotelItem,hotelRegistrationSnapshot} from '../lib/hotelOrderEdits';

const STORE = 'hotel-order-workspace-v1';
const fmt = n => Number(n).toLocaleString('ko-KR', { maximumFractionDigits: 6 });
const moveWeekFocus = e => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  const buttons = [...e.currentTarget.querySelectorAll('button')].filter(b => !b.matches(':disabled'));
  const index = buttons.indexOf(e.target);
  if (index < 0) return;
  e.preventDefault();
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next]?.focus();
};
const empty = () => {
  const base = hotelMiuMajorWeekOptions(new Date(), 0)[0];
  return { year: base.year, week: `${base.majorText}-01`, request: [], purchase: [], allocations: {}, pinned: [], raum: '', surplus: '', receipts: [], history: [], frozen: false, texts: { request: '', purchase: '' } };
};

export default function HotelOrderWorkspace({apiGet=liveGet,apiPost=livePost}={}) {
  const [work, setWork] = useState(empty), [ready, setReady] = useState(false);
  const [quickWeeks] = useState(() => hotelMiuMajorWeekOptions(new Date(), 5, 5));
  const [customers, setCustomers] = useState([]), [products, setProducts] = useState({});
  const texts = work.texts || { request: '', purchase: '' };
  const setTexts = update => { setPreview(null); setWork(w => ({ ...w, texts: typeof update === 'function' ? update(w.texts || { request: '', purchase: '' }) : update })); };
  const [saved, setSaved] = useState(''), [saving, setSaving] = useState(false), [storageError, setStorageError] = useState('');
  const [records, setRecords] = useState([]), [browseYear, setBrowseYear] = useState(work.year), [browseWeek, setBrowseWeek] = useState(work.week);
  const [legacy, setLegacy] = useState(null);
  const meta = useRef({ id: '', revision: 0 }), savedJson = useRef(''), queue = useRef(Promise.resolve()), failed = useRef(false), epoch = useRef(0);
  const dirty = JSON.stringify(work) !== savedJson.current && (meta.current.revision > 0 || hasHotelDraftContent(work));
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [info, setInfo] = useState('');
  const [search, setSearch] = useState(''), [picker, setPicker] = useState(null), [hits, setHits] = useState([]);
  const [vendor, setVendor] = useState(''), [preview, setPreview] = useState(null), [sheets, setSheets] = useState(null);
  const [uploadPreview, setUploadPreview] = useState(null), [editingBatch,setEditingBatch]=useState(null);
  const lock = useRef(false), focus = useRef(null), lookup = useRef(0), storageKey = useRef('');
  const blocked = !!busy || saving || !!storageError || work.frozen || !ready;
  // Background autosave must never steal focus or block the next paste/keystroke.
  const inputBlocked = !!busy || work.frozen || !ready;
  const model = useMemo(() => buildHotelOrderRows(work.request, work.purchase, products, work.allocations, work), [work, products]);
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
    epoch.current++; setEditingBatch(null); setBusy('서버 작업 불러오기'); setPreview(null); setError(''); setInfo('');
    try {
      await queue.current;
      const d = await apiGet('/api/sales/hotel-order-drafts', { year, week, id });
      meta.current = { id, revision: d.record.revision }; failed.current = false; savedJson.current = JSON.stringify(d.record.work);
      let restored=d.record.work;
      const needsLocations=['request','purchase'].some(side=>[...(restored.pending?.[side]?[restored.pending[side]]:[]),...hotelSavedBatches(restored,side)].some(b=>b.imageId && b.rows.some(r=>!hotelSourceBox(r.sourceBox))));
      if(needsLocations && !restored.frozen){
        try {
          const list=await apiGet('/api/sales/hotel-order-drafts',{year,week}),peers=[];
          for(const record of list.records || [])if(record.id!==id){try{peers.push((await apiGet('/api/sales/hotel-order-drafts',{year,week,id:record.id})).record.work);}catch{/* Optional recovery never blocks loading. */}}
          restored=recoverHotelWorkLocations(restored,peers);
          if(restored!==d.record.work)setInfo('같은 원본의 저장 위치를 복구했습니다. 기존 품목·수량은 유지됩니다.');
        }catch{setInfo('저장 자료는 불러왔습니다. 원본 위치 다시 읽기로 정렬을 복구할 수 있습니다.');}
      }
      setWork(restored); setSaved(d.record.updatedAt); setStorageError(''); setSheets(null);
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
    setEditingBatch(null); setWork({ ...empty(), pinned: work.pinned, raum: work.raum, surplus: work.surplus }); setSaved(''); setStorageError(''); setError(''); setInfo(''); setPreview(null); setSheets(null);
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
    if (!picker || picker.special) return;
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
    if (work.pending?.[side]) { setError('검토 중인 자료를 먼저 저장하거나 검토 취소한 뒤 다음 자료를 넣으세요.'); return; }
    lock.current = true; setBusy(`${side === 'request' ? '요청' : '발주'} 자료 매칭 중`); setError('');
    let localUrl;
    try {
      let d, imageId;
      if (file) {
        if (file.type.startsWith('image/')) {
          localUrl = URL.createObjectURL(file); setUploadPreview({ side, url: localUrl });
          const uploaded = await fetch('/api/sales/hotel-order-images', { method: 'POST', credentials: 'include', body: file });
          const image = await uploaded.json(); if (!uploaded.ok || !image.success) throw Error(image.error || '이미지 보관 실패');
          imageId = image.id;
        }
        const fd = new FormData(); fd.append('file', file); if (sheet) fd.append('sheet', sheet);
        const res = await fetch('/api/sales/hotel-miu-parse', { method: 'POST', credentials: 'include', body: fd });
        d = await res.json(); if (!res.ok || !d.success) throw Error(d.error || '파일 분석 실패');
        if (d.sheetNames) { setSheets({ side, file, names: d.sheetNames }); return; }
      } else d = await apiPost('/api/sales/hotel-miu-parse', { text: texts[side] });
      const rows = applyHotelSpecialMappings((d.items || []).filter(r => !r.skip).map((r, sourceRowIndex) => ({ ...r, sourceRowIndex, id: crypto.randomUUID(), source: file?.name || '붙여넣기', originalQty: r.qty, originalUnit: r.unit })), work.specialMappings);
      if (!rows.length) throw Error(`품명·수량 열을 확인하세요. ${(d.logs || []).join(' / ')}`);
      setProducts(p => ({ ...p, ...Object.fromEntries((d.products || []).map(x => [Number(x.ProdKey), x])) }));
      setWork(w => ({ ...w, pending: { ...w.pending, [side]: { id: crypto.randomUUID(), source: file?.name || '붙여넣기', imageId, text: file ? '' : texts[side], sourceRowCount: rows.length, rows } } })); setPreview(null);
      setTexts(t => ({ ...t, [side]: '' })); setSheets(null);
      setInfo(`${rows.length}행을 매칭했습니다. 원본 옆 결과를 확인하고 저장 버튼을 눌러 수량에 반영하세요. ${(d.logs || []).join(' / ')}`);
    } catch (e) { setError(e.message); } finally { if (localUrl) URL.revokeObjectURL(localUrl); setUploadPreview(null); lock.current = false; setBusy(''); }
  }
  async function locateSource(side,batch) {
    if(lock.current || blocked)return;
    lock.current=true;setBusy('원본 품목 위치 확인 중');setError('');
    try {
      const image=await fetch(hotelImageUrl(batch.imageId),{credentials:'include'});if(!image.ok)throw Error('원본 이미지를 불러오지 못했습니다.');
      const fd=new FormData();fd.append('file',await image.blob(),batch.imageId);
      const response=await fetch('/api/sales/hotel-miu-parse',{method:'POST',credentials:'include',body:fd});
      const parsed=await response.json();if(!response.ok||!parsed.success)throw Error(parsed.error||'위치 분석 실패');
      const rows=recoverHotelSourceRows(batch.rows,(parsed.items||[]).filter(r=>!r.skip));
      if(!rows)throw Error('원본 품목명·수량이 모두 일치하지 않아 위치를 적용하지 않았습니다. 기존 값은 유지됩니다.');
      let next;
      if(work.pending?.[side]?.id===batch.id)next={...work,pending:{...work.pending,[side]:{...work.pending[side],rows}}};
      else {const byId=new Map(rows.map(r=>[r.id,r]));next={...work,[side]:work[side].map(r=>byId.get(r.id)||r)};}
      await storeNow(next);setInfo('원본 위치를 서버에 저장했습니다. 기존 품목·수량·단위는 유지됩니다.');
    }catch(e){setError(e.message);}finally{lock.current=false;setBusy('');}
  }
  function editLine(side, id, update) {
    if (work.pending?.[side]?.rows.some(r => r.id === id)) {
      patch({ pending: { ...work.pending, [side]: { ...work.pending[side], rows: work.pending[side].rows.map(r => r.id === id ? { ...r, ...update } : r) } } }); return;
    }
    patch({ [side]: work[side].map(r => r.id === id ? { ...r, ...update } : r), allocations: {}, orderTotals: {} });
  }
  function deleteLine(side, id) {
    const pending=work.pending?.[side];
    const retain=rows=>rows.map((r,i)=>({...r,sourceRowIndex:r.sourceRowIndex??i})).filter(r=>r.id!==id);
    if (pending?.rows.some(r => r.id === id)) patch({ pending: { ...work.pending, [side]: { ...pending, sourceRowCount:pending.sourceRowCount??pending.rows.length, rows:retain(pending.rows) } } });
    else {
      const batch=hotelSavedBatches(work,side).find(b=>b.rows.some(r=>r.id===id));
      if(!batch)return;
      const rows=new Map(retain(batch.rows).map(r=>[r.id,r]));
      patch({[side]:work[side].filter(r=>r.id!==id).map(r=>rows.get(r.id)||r),allocations:{},orderTotals:{},batches:{...work.batches,[side]:(work.batches?.[side]||[]).map(b=>b.id===batch.id?{...b,sourceRowCount:b.sourceRowCount??batch.rows.length}:b)}});
    }
  }
  async function saveReview(side) {
    if (blocked || lock.current) return;
    lock.current = true; setBusy('매칭 수량 서버 저장'); setError('');
    try {
      const number = hotelNextBatchNumber(work, side), next = commitHotelReview(work, side, new Date().toISOString());
      // Do not remove the review or include its quantity until the server acknowledges it.
      await persist(next); setWork(next); setPreview(null);
      setInfo(`${side === 'request' ? '요청' : '발주'}수량${number}에 저장했습니다. 아래 합산표에 반영했습니다.`);
    } catch (e) { setError(`수량 저장 실패: ${e.message} 검토 내용은 유지됩니다.`); }
    finally { lock.current = false; setBusy(''); }
  }
  async function chooseProduct(p) {
    const selected = picker, line = [...work[selected.side], ...(work.pending?.[selected.side]?.rows || [])].find(r => r.id === selected.id);
    editLine(selected.side, selected.id, { specialName: '', prodKey: p.ProdKey, prodName: p.DisplayName || p.ProdName, displayName:p.DisplayName || p.ProdName, matchWarning:'', unit: line.unit || p.OutUnit });
    setWork(w=>({...w,specialMappings:rememberHotelSpecial(w,line,null)}));
    setProducts(v => ({ ...v, [p.ProdKey]: p })); setPicker(null);
    document.getElementById(`match-${selected.id}`)?.focus();
    try { await apiPost('/api/sales/hotel-miu-intake', { action: 'saveMapping', inputName: line.inputName, prod: { prodKey: p.ProdKey, prodName: p.ProdName, displayName: p.DisplayName, flowerName: p.FlowerName, counName: p.CounName }, unit: line.unit || p.OutUnit }); }
    catch (e) { setError(`이번 선택은 적용됐지만 매칭 기억 저장 실패: ${e.message}`); }
  }
  function chooseSpecial() {
    if(blocked || !picker)return;
    const selected=picker,line=[...work[selected.side],...(work.pending?.[selected.side]?.rows||[])].find(r=>r.id===selected.id);
    try {const special=specialHotelLine(line,search);editLine(selected.side,selected.id,special);setWork(w=>({...w,specialMappings:rememberHotelSpecial(w,line,search)}));setPicker(null);document.getElementById(`match-${selected.id}`)?.focus();setInfo('특수매칭을 저장했습니다. 같은 이름·단위는 차수별로 합산하며 ERP 주문에는 포함하지 않습니다.');}catch(e){setError(e.message);}
  }
  async function finishBatchEdit() {
    if(blocked)return;
    try {await persist(work);setEditingBatch(null);setInfo('차수의 품목·수량 수정을 서버에 저장했습니다.');}catch(e){setError(e.message);}
  }
  async function prepare() {
    if (lock.current || work.frozen) return;
    if (work.pending?.request || work.pending?.purchase) { setError('검토 중인 자료를 먼저 수량에 저장하거나 검토 취소하세요.'); return; }
    lock.current = true; setBusy('등록 전 현재 주문 조회'); setError('');
    try {
      const catalog = await apiGet('/api/products/search', { refresh: '1' });
      const freshProducts = Object.fromEntries((catalog.products || []).map(p => [Number(p.ProdKey), p]));
      const freshModel = buildHotelOrderRows(work.request, work.purchase, freshProducts, work.allocations, work);
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
    let state = { ...work, frozen: true, receipts: [], registrationSnapshot:hotelRegistrationSnapshot(work,products,preview,new Date().toISOString()) };
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
  function reviewView(side, batch, editable=true) {
    return <HotelMatchReview key={batch.id} batch={batch} side={side} blocked={blocked || !editable} onLocate={()=>locateSource(side,batch)}
      onEdit={(id,update)=>editLine(side,id,update)} onDelete={id=>deleteLine(side,id)}
      onPick={r=>{setPicker({side,id:r.id,special:!!r.specialName});setSearch(r.specialName || r.inputName || '');}}
      onAlign={alignment=>{if(work.pending?.[side]?.id===batch.id)patch({pending:{...work.pending,[side]:{...work.pending[side],alignment}}});else patch({batches:{...work.batches,[side]:work.batches[side].map(b=>b.id===batch.id?{...b,alignment}:b)}});}}/>;
  }
  return <section className="hotel-work">
    <h2>호텔 주문등록</h2>
    <p>차수 선택 → 요청·발주 자료 매칭 → 잔량 업체 분류 → 주문등록. 초안과 결과는 서버에 저장됩니다. 같은 계정으로 다른 PC에서도 차수별로 불러와 이어서 작업할 수 있습니다.</p>
    <section aria-label="서버 작업 보관">
      <h3>차수별 서버 작업</h3>
      <p role="status">{saving ? '서버 저장 중… 입력은 계속할 수 있습니다.' : storageError ? '서버 저장 실패 · 현재 내용은 화면에 남아 있습니다' : dirty ? (work.week ? '미저장 변경 · 잠시 후 자동 저장' : '미저장 변경 · 주문 차수를 선택하세요.') : saved ? `서버 저장 완료 · ${new Date(saved).toLocaleString('ko-KR')} · 버전 ${meta.current.revision}` : '선택한 차수에 내용을 입력하면 자동 저장합니다.'}</p>
      {storageError && <><p role="alert" className="hotel-error">{storageError}</p><button data-tone="retry" disabled={!!busy || saving} onClick={retryStorage}>저장 상태 확인 · 재시도</button></>}
      <button data-tone="save" disabled={!ready || !work.week || !!busy || saving || !!storageError} onClick={() => persist(work).catch(() => {})}>서버에 지금 저장</button>
      {meta.current.id && <button data-tone="load" disabled={!!busy || saving} onClick={() => loadDraft(meta.current.id, work.year, work.week)}>현재 서버 작업 다시 불러오기</button>}
      <div><label>조회 연도 <input disabled={!!busy || saving} aria-label="서버 조회 연도" type="number" min="2020" max="2100" value={browseYear} onChange={e => { setBrowseYear(e.target.value); setRecords([]); }} /></label>
      <label>조회 차수 <select disabled={!!busy || saving} aria-label="서버 조회 차수" value={browseWeek} onChange={e => { setBrowseWeek(e.target.value); setRecords([]); }}><option value="">차수 선택</option>{Array.from({ length: 53 }, (_, i) => [1, 2, 3, 4].map(j => { const w = `${String(i + 1).padStart(2, '0')}-0${j}`; return <option key={w}>{w}</option>; }))}</select></label>
      <button data-tone="load" disabled={!browseWeek || !!busy || saving} onClick={refreshList}>차수별 작업 조회</button></div>
      <ul>{records.map(r => <li key={r.id}><button data-tone="load" disabled={!!busy || saving} onClick={() => loadDraft(r.id)}>{new Date(r.updatedAt).toLocaleString('ko-KR')} · {r.frozen ? '등록 시작·결과 보관' : '초안'} · 요청 {r.requestCount}행 / 발주 {r.purchaseCount}행 · 불러오기</button></li>)}</ul>
      {legacy && <button data-tone="save" disabled={!!busy || saving || dirty} onClick={importLegacy}>이 PC의 기존 초안 서버로 가져오기</button>}
    </section>
    <fieldset disabled={blocked || !ready || meta.current.revision > 0 || work.request.length > 0 || work.purchase.length > 0 || !!work.pending?.request || !!work.pending?.purchase}>
      <legend>1. 주문 연도 · 차수</legend>
      <p>기본 차수 앞뒤 5차수 · 세부차수 01~04</p>
      <div className="hotel-weeks" role="group" aria-label="주문 대차수 빠른 선택" onKeyDown={moveWeekFocus}>{quickWeeks.map(opt => <button type="button" key={`${opt.year}-${opt.major}`} aria-pressed={work.year === opt.year && Number(work.week.split('-')[0]) === opt.major} onClick={() => patch({ year: opt.year, week: `${opt.majorText}-${work.week.split('-')[1] || '01'}` })}>{opt.label}</button>)}</div>
      <div className="hotel-weeks" role="group" aria-label="주문 세부차수 선택" onKeyDown={moveWeekFocus}>{['01', '02', '03', '04'].map(sub => <button type="button" key={sub} aria-pressed={work.week.split('-')[1] === sub} disabled={!work.week} onClick={() => patch({ week: `${work.week.split('-')[0]}-${sub}` })}>{sub}</button>)}</div>
      <label>연도 <input aria-label="주문 연도" type="number" min="2020" max="2100" value={work.year} onChange={e => patch({ year: e.target.value, week: '' })} /></label>
      <label>차수 <select aria-label="주문 차수" value={work.week} onChange={e => patch({ week: e.target.value })}><option value="">차수 선택</option>{Array.from({ length: 53 }, (_, i) => [1, 2, 3, 4].map(j => { const w = `${String(i + 1).padStart(2, '0')}-0${j}`; return <option key={w}>{w}</option>; }))}</select></label>
    </fieldset>
    {meta.current.revision > 0 && <p>서버에 저장된 작업의 차수는 고정됩니다. 다른 차수는 아래 ‘새 작업’에서 시작하세요.</p>}
    <div className="hotel-inputs">
      {['request', 'purchase'].map(side => <fieldset key={side}>
        <legend>{side === 'request' ? '2. 요청수량 업로드' : '3. 발주수량 업로드'}</legend>
        <div className="hotel-entry-columns"><div>
        <p>TXT · Excel · CSV · 이미지 / 텍스트·이미지 붙여넣기</p>
        <input disabled={blocked || !work.week || !!work.pending?.[side]} aria-label={`${side === 'request' ? '요청' : '발주'} 파일 업로드`} type="file" accept=".txt,.tsv,.csv,.xlsx,.xls,image/png,image/jpeg,image/webp,image/gif" onChange={e => { if(e.target.files?.[0]) parse(side, e.target.files[0]); e.target.value = ''; }} />
        <textarea disabled={inputBlocked} aria-label={`${side === 'request' ? '요청' : '발주'} 텍스트 또는 이미지 붙여넣기`} rows={5} placeholder="품명 · 수량 · 단위가 있는 텍스트를 붙여넣거나 이미지를 붙여넣으세요." value={texts[side]} onChange={e => setTexts(t => ({ ...t, [side]: e.target.value }))} onPaste={e => {
          if (e.clipboardData.getData('text/plain')) return;
          const item = [...e.clipboardData.items].find(i => i.type.startsWith('image/'));
          if (item) { e.preventDefault(); if (blocked) { setError('이미지 매칭은 서버 저장 완료·오류 해결 후 다시 붙여넣어 주세요. 텍스트 입력은 계속할 수 있습니다.'); return; } parse(side, item.getAsFile()); }
        }} />
        {!work.week && <p>텍스트는 먼저 입력할 수 있습니다. 매칭·서버 저장 전에 주문 차수를 선택하세요.</p>}
        <button data-tone="match" onClick={() => parse(side)} disabled={blocked || !work.week || !texts[side].trim() || !!work.pending?.[side]}>텍스트 매칭</button>
        <span> 저장된 수량 {work[side].length}행</span>
        </div><HotelQuantityMatrix matrix={hotelBatchMatrix(work,side,products)} side={side} blocked={blocked} editingId={editingBatch?.side===side?editingBatch.id:null} onEditBatch={id=>setEditingBatch({side,id})} renderSource={batch=>reviewView(side,batch,false)} onEdit={(batchId,key,value)=>{try {setWork(editHotelBatchQuantity(work,side,batchId,key,value,products));setPreview(null);}catch(e){setError(e.message);}}}/></div>
        {editingBatch?.side===side && hotelSavedBatches(work,side).filter(b=>b.id===editingBatch.id).map(b=><section key={b.id} aria-label={`${side==='request'?'요청':'발주'} ${b.number}차 수정`}><h3>{b.number}차 수정</h3><p>수정은 서버에 자동 보관됩니다. 품목·수량 변경 시 최종수량 조절과 업체 분류를 초기화합니다.</p>{reviewView(side,b)}<button data-tone="save" disabled={blocked} onClick={finishBatchEdit}>{b.number}차 수정 완료 · 저장</button></section>)}
        {uploadPreview?.side === side && <div className="hotel-review"><div className="hotel-source"><img src={uploadPreview.url} alt="매칭 중인 업로드 원본" /></div><p role="status">품목 · 수량을 매칭하고 있습니다…</p></div>}
        {work.pending?.[side] && <section className="hotel-pending" aria-label={`${side === 'request' ? '요청' : '발주'} 저장 전 검토`}>
          <h3>저장 전 검토 · {work.pending[side].rows.length}행</h3><p>이미지·원문 옆에서 품목과 수량을 확인하세요. 아직 아래 합산수량에는 포함되지 않았습니다. 검토 내용도 서버에 자동 보관됩니다.</p>
          {reviewView(side, work.pending[side])}
          <button data-tone="save" disabled={blocked || !work.pending[side].rows.length} onClick={() => saveReview(side)}>{side === 'request' ? '요청' : '발주'}수량{hotelNextBatchNumber(work,side)}에 저장</button>
          <button data-tone="danger" disabled={blocked} onClick={() => { if(window.confirm('현재 검토 자료를 취소할까요? 저장된 수량은 유지됩니다.')) patch({pending:{...work.pending,[side]:null}}); }}>검토 취소</button>
        </section>}
      </fieldset>)}
    </div>
    {sheets && <fieldset disabled={!!busy}><legend>엑셀 시트 선택</legend>{sheets.names.map(name => <button data-tone="match" key={name} onClick={() => parse(sheets.side, sheets.file, name)}>{name}</button>)}<button onClick={() => setSheets(null)}>취소</button></fieldset>}
    <HotelFinalQuantities rows={hotelFinalQuantities(work,products)} blocked={blocked} onEdit={(row,value)=>{try{setWork(setHotelFinalQuantity(work,row,value));setPreview(null);}catch(e){setError(e.message);}}} onOmit={(key,excluded)=>{setWork(omitHotelItem(work,key,excluded));setPreview(null);}} onReset={key=>{const orderTotals={...work.orderTotals};delete orderTotals[key];patch({orderTotals,allocations:{}});}}/>
    <fieldset disabled={blocked}>
      <legend>4. 선택업체 분류</legend>
      <label>발주수량 → 라움 <select value={work.raum} onChange={e => patch({ raum: e.target.value })}>{customerOptions}</select></label>
      <label>완성 박스 잔량 → 호텔여분 <select value={work.surplus} onChange={e => patch({ surplus: e.target.value })}>{customerOptions}</select></label>
      <p>잔량 = 요청 − 발주. 정확히 1박스 이상은 완성 박스만 호텔여분으로 배정하고 나머지는 직접 분류합니다. 예: 잔량 75송이, 박스당 30송이 → 호텔여분 60, 분류필요 15. 박스 기준이 없는 품목은 잔량을 직접 업체에 배정하면 환산 없이 등록할 수 있습니다.</p>
      <label>분류 업체 추가 <select value={vendor} onChange={e => setVendor(e.target.value)}>{customerOptions}</select></label><button data-tone="match" disabled={!vendor || work.pinned.includes(vendor)} onClick={() => patch({ pinned: [...work.pinned, vendor] })}>업체 고정 추가</button>
      {work.pinned.map(key => <button data-tone="danger" key={key} onClick={() => { const allocations = Object.fromEntries(Object.entries(work.allocations).map(([pk, row]) => [pk, Object.fromEntries(Object.entries(row).filter(([ck]) => ck !== key))])); patch({ pinned: work.pinned.filter(k => k !== key), allocations }); }}>{customers.find(c => String(c.CustKey) === key)?.CustName || key} 고정 취소</button>)}
      <div className="hotel-scroll"><table><thead><tr><th>품목 / 단위</th><th>요청수량</th><th>발주수량 · 라움</th><th>잔량</th><th>호텔여분</th><th>분류필요</th>{work.pinned.map(key => <th key={key}>{customers.find(c => String(c.CustKey) === key)?.CustName || key}</th>)}</tr></thead><tbody>
        {model.rows.map(r => <tr key={r.prodKey}><td>{r.prodName}<small>{r.unit} / 박스당 {fmt(r.perBox)}</small></td><td>{fmt(r.request)}</td><td>{fmt(r.purchase)}</td><td>{fmt(r.remaining)}</td><td>{fmt(r.surplus)}</td><td className={r.unassigned ? 'hotel-warning' : ''}>{fmt(r.unassigned)}</td>{work.pinned.map(key => <td key={key}><input aria-label={`${r.prodName} ${customers.find(c => String(c.CustKey) === key)?.CustName || key} 분류수량`} type="number" min="0" step="any" value={r.assigned[key] ?? ''} onChange={e => patch({ allocations: { ...work.allocations, [r.prodKey]: { ...r.assigned, [key]: e.target.value } } })} /><button data-tone="match" disabled={r.unassigned <= 0} onClick={() => patch({ allocations: { ...work.allocations, [r.prodKey]: { ...r.assigned, [key]: Number(r.assigned[key] || 0) + r.unassigned } } })}>잔량 배정</button></td>)}</tr>)}
      </tbody></table></div>
    </fieldset>
    {model.errors.length > 0 && <div role="alert" className="hotel-error">{model.errors.map((e, i) => <div key={i}>{e}</div>)}</div>}
    {(work.pending?.request || work.pending?.purchase) && <p className="hotel-warning">검토 중인 자료를 수량에 저장하거나 검토 취소한 뒤 주문등록을 진행하세요.</p>}
    <button data-tone="order" disabled={blocked || !model.rows.length || !!model.errors.length || !!work.pending?.request || !!work.pending?.purchase} onClick={prepare}>최종 주문등록 · 합계 확인</button>
    {preview && <section><h3>등록 전 확인 — {work.year} / {work.week}</h3><p>아래 수량을 기존 주문에 더합니다. 업체별로 저장하며, 중간 실패 시 완료된 업체는 유지됩니다.</p><div className="hotel-scroll"><table><thead><tr><th>업체</th><th>품목</th><th>작업 전</th><th>추가</th><th>예상 작업 후</th></tr></thead><tbody>{preview.flatMap(g => g.items.map(it => <tr key={`${g.custKey}-${it.prodKey}`}><td>{g.custName}</td><td>{it.prodName} ({it.unit})</td><td>{fmt(it.expectedCurrentQty)}</td><td>+{fmt(it.qty)}</td><td>{fmt(it.expectedCurrentQty + it.qty)}</td></tr>))}</tbody></table></div><button data-tone="order" disabled={blocked} onClick={register}>확인 · 합계수량 주문등록</button><button disabled={!!busy} onClick={() => setPreview(null)}>취소</button></section>}
    {busy && <p role="status">{busy}</p>}{error && <p role="alert" className="hotel-error">{error}</p>}{info && <p role="status">{info}</p>}
    {work.registrationSnapshot && <section aria-label="등록 시점 합계와 누락 이력"><h3>등록 시점 합계 · 누락 이력</h3><p>{new Date(work.registrationSnapshot.time).toLocaleString('ko-KR')} · {work.registrationSnapshot.year}/{work.registrationSnapshot.week}</p><div className="hotel-scroll"><table><thead><tr><th>품목</th><th>원본 요청 합계</th><th>최종 요청수량</th><th>처리</th></tr></thead><tbody>{work.registrationSnapshot.rows.map(r=><tr key={r.key}><td>{r.name} ({r.unit})</td><td>{fmt(r.sourceQty)}</td><td>{r.excluded?0:fmt(r.finalQty)}</td><td>{r.excluded?'누락':r.special?'특수매칭 · 합산 전용':r.registration?'주문 대상':'수량 0 · 제외'}</td></tr>)}</tbody></table></div></section>}
    {(work.frozen || work.history?.length > 0) && <section><h3>등록 히스토리 · 작업 전 / 작업 후</h3><p>등록을 시작한 초안은 잠겨 있습니다. 결과가 불명확한 업체는 현재 주문을 대조한 뒤 별도 작업으로 처리하세요.</p><button data-tone="load" disabled={!!busy || saving || !!storageError} onClick={readback}>현재 주문 다시 조회</button>{[...(work.history || []), ...work.receipts].map((r, i) => <section key={i}><h4>{r.custName} · {r.year}/{r.week} · {r.status}</h4><p>{new Date(r.time).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} {r.warning}</p><div className="hotel-scroll"><table><thead><tr><th>품목</th><th>작업 전</th><th>등록량</th><th>작업 후 (서버 확인)</th><th>현재 조회</th></tr></thead><tbody>{r.items.map(it => { const result = r.results.find(x => Number(x.prodKey) === it.prodKey); return <tr key={it.prodKey}><td>{it.prodName} ({it.unit})</td><td>{fmt(result?.previousQty ?? it.expectedCurrentQty)}</td><td>{fmt(it.qty)}</td><td>{result ? fmt(result.finalQty) : '확인 필요'}</td><td>{r.current ? fmt(r.current[it.prodKey] ?? 0) : '미조회'}</td></tr>; })}</tbody></table></div></section>)}</section>}
    <button data-tone="load" disabled={!!busy || saving} onClick={newWork}>새 작업</button>
    <button disabled={!work.week} onClick={() => {
      const a = document.createElement('a'), url = URL.createObjectURL(new Blob([JSON.stringify(work, null, 2)], { type: 'application/json' })); a.href = url; a.download = `호텔주문-${work.year}-${work.week}.json`; a.click(); URL.revokeObjectURL(url);
    }}>초안 · 결과 다운로드</button>
    {picker && <div className="hotel-picker" role="dialog" aria-modal="true" aria-label="품목 매칭" onKeyDown={e => {
      if (e.key === 'Escape') { const id = picker.id; setPicker(null); document.getElementById(`match-${id}`)?.focus(); }
      if (e.key === 'Tab') { const all = [...e.currentTarget.querySelectorAll('button,input,select')]; const first = all[0], last = all[all.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }
    }}><h3>{picker.special?'특수매칭 직접입력':'품목 선택'}</h3><button data-tone="match" onClick={()=>setPicker({...picker,special:!picker.special})}>{picker.special?'DB 품목 선택':'특수매칭'}</button>{picker.special&&<p>DB에 없는 합산용 품목입니다. 같은 이름·단위는 1차·2차·3차에 합산되며 ERP 주문에는 포함되지 않습니다.</p>}<input ref={focus} aria-label={picker.special?'특수매칭 이름':'품목 검색'} maxLength={picker.special?100:undefined} value={search} onChange={e => setSearch(e.target.value)} />{picker.special?<button data-tone="save" disabled={blocked||!search.trim()} onClick={chooseSpecial}>특수매칭 저장</button>:<><select size={12} aria-label="품목 검색 결과" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); const p = hits.find(p => String(p.ProdKey) === e.currentTarget.value); if (p) chooseProduct(p); } }} id="hotel-product-choice"><option value="">품목 선택 후 아래 적용</option>{hits.map(p => <option key={p.ProdKey} value={p.ProdKey}>{p.DisplayName} / {p.ProdName} ({p.ProdKey})</option>)}</select><button data-tone="match" onClick={() => { const p = hits.find(p => String(p.ProdKey) === document.getElementById('hotel-product-choice').value); if (p) chooseProduct(p); }}>선택 적용</button></>}<button onClick={() => { const id = picker.id; setPicker(null); document.getElementById(`match-${id}`)?.focus(); }}>닫기</button></div>}
    <style jsx>{`
      .hotel-entry-columns {display:grid;grid-template-columns:minmax(250px,32%) minmax(0,1fr);gap:20px;align-items:start} @media(max-width:900px){.hotel-entry-columns {grid-template-columns:minmax(0,1fr)}}
      .hotel-review {display:grid;grid-template-columns:minmax(260px,35%) minmax(0,1fr);gap:20px;align-items:start} .hotel-source {min-width:0;background:#f5f7fa;border:1px solid #dfe5ed;border-radius:8px;padding:12px} .hotel-source h4 {margin:0 0 12px} .hotel-source img {display:block;width:100%;height:auto;margin-top:10px} .hotel-source pre {white-space:pre-wrap;overflow-wrap:anywhere;font:inherit} .hotel-pending {margin-top:8px;border-top:2px solid #237e83;padding-top:4px} .hotel-pending p {margin:3px 0;font-size:13px} .hotel-pending h3 {margin-top:0} .hotel-batch {margin-top:16px;border:1px solid #bbd4d0;border-radius:8px;padding:12px} .hotel-batch summary {cursor:pointer;padding:8px;background:#eef8f5;color:#195e56;margin-bottom:12px} .hotel-review .hotel-line-edit {margin:0} @media(max-width:760px) {.hotel-review {grid-template-columns:minmax(0,1fr)}}
      .hotel-weeks {display:flex;flex-wrap:wrap;gap:4px} .hotel-weeks button[aria-pressed=true] {background:#1d4fa5;color:white;border-color:#1d4fa5} .hotel-line-edit {border:0;padding:0;margin:12px 0}
      .hotel-work {padding:20px; color:#17243c; font-size:15px} h2 {margin-top:0} fieldset {border:1px solid #ccd7e5;border-radius:10px;padding:16px;margin:16px 0;min-width:0} legend {font-weight:700} label {display:inline-flex;gap:8px;align-items:center;margin:6px 12px 6px 0} input,select,textarea {font:inherit;border:1px solid #bac8db;border-radius:6px;padding:8px;background:white;color:#17243c} button {margin:4px} :focus-visible {outline:3px solid #2871dd;outline-offset:2px} input[type=number] {width:100px} textarea {width:100%;box-sizing:border-box;display:block;margin:10px 0} small {display:block;color:#586982;margin-top:5px} .hotel-inputs {display:grid;grid-template-columns:minmax(0,1fr);gap:8px} .hotel-scroll {overflow-x:auto} table {border-collapse:collapse;width:100%;margin:12px 0} td,th {padding:10px;border-bottom:1px solid #dfe5ed;text-align:left;vertical-align:top} th {background:#edf3fa;white-space:nowrap} .hotel-warning,.hotel-error {color:#a32b19;background:#fff1ec;padding:12px} .hotel-picker {position:fixed;z-index:2000;inset:10% 15%;background:white;box-shadow:0 0 0 100vmax #0007;padding:24px;overflow:auto;border-radius:12px} .hotel-picker select {display:block;width:100%;margin-top:12px} @media(max-width:1000px) {.hotel-inputs {grid-template-columns:1fr}.hotel-picker {inset:5%}.hotel-work {padding:10px}}
    `}</style>
  </section>;
}
