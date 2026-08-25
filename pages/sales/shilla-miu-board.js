// 호텔+미우 통합게시판 홈 — 업체에 합산을 쌓은 뒤 주문만 가산 등록
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPost } from '../../lib/useApi';
import { getCurrentWeek } from '../../lib/useWeekInput';
import { getClipboardImage } from '../../lib/raumPnlImage';
import {
  HOTEL_MIU_BATCH_DRAFT,
  HOTEL_MIU_FAVORITE_PAGE,
  batchLineTotal,
  orderDeltaForRegisteredBatch,
  isHotelMiuCancelOverflowError,
  hotelMiuWeekOptions,
  HOTEL_MIU_WEEK_UNTIL,
  clipboardLooksLikeOrderText,
  isDraftBatch,
  mergeAllBatchLines,
  mergeDraftLines,
  nextBatchNo,
  overlayMappingRecord,
  applyBoardOverlay,
  registerPreviewTable,
  boxRoundHint,
  boxFactorForUnit,
  applyPerBoxOverride,
  roundChoiceLabel,
  buildRegisterItems,
  buildRegisterHistory,
  registeredHistoryView,
  registeredLineHistory,
  formatSplitQtyLabel,
  reapplyItemsFromSnaps,
  resolveHotelMiuDefaultVendors,
  attachVarietyToRows,
  historyVarietyButtons,
  toggleVarietyFilter,
  filterRowsByVarieties,
  groupRowsByVariety,
  readVarietyFilter,
  writeVarietyFilter,
} from '../../lib/hotelMiuIntake';

function defaultScope() {
  const opts = hotelMiuWeekOptions(getCurrentWeek(), HOTEL_MIU_WEEK_UNTIL);
  return { year: opts[0].year, week: opts[0].week, weeks: opts };
}

const fmt = (n) => Number(n || 0).toLocaleString();
let lineSeq = 1;

function VarietyChipBar({ rows, selectedVarieties, onToggle, onClear }) {
  const buttons = historyVarietyButtons(rows);
  if (!buttons.length) return null;
  const allOn = !selectedVarieties?.length;
  return (
    <div style={st.varRow}>
      <button type="button" style={allOn ? st.chipOn : st.chip} onClick={onClear}>전체</button>
      {buttons.map(({ variety, count }) => {
        const on = (selectedVarieties || []).includes(variety);
        return (
          <button key={variety} type="button" style={on ? st.chipOn : st.chip} onClick={() => onToggle(variety)}>
            {variety} {count}
          </button>
        );
      })}
    </div>
  );
}

function HistoryQtyTable({ view, exeQty, products, selectedVarieties = [], onToggleVariety, onClearVarieties }) {
  const rows = view?.rows || [];
  const batchNos = view?.batchNos?.length ? view.batchNos : [1, 2, 3];
  if (!rows.length) return <p style={st.muted}>이 업체·차수에 주문등록된 내역이 없습니다.</p>;
  const groups = groupRowsByVariety(filterRowsByVarieties(rows, selectedVarieties));
  const colSpan = 1 + batchNos.length + 4;
  return (
    <>
      <VarietyChipBar rows={rows} selectedVarieties={selectedVarieties} onToggle={onToggleVariety} onClear={onClearVarieties} />
      <table style={st.tbl}>
        <thead>
          <tr>
            <th style={st.th}>품목</th>
            {batchNos.map((no) => (
              <th key={no} style={st.thRight}>{no}차</th>
            ))}
            <th style={st.thRight}>반올림 전</th>
            <th style={st.thRight}>반올림 후</th>
            <th style={st.thRight}>전산 현재</th>
            <th style={st.th}>맞춤</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g.variety}>
              <tr>
                <td colSpan={colSpan} style={st.varHead}>{g.variety}</td>
              </tr>
              {g.rows.map((row) => {
                const exe = exeQty?.[row.prodKey];
                const product = products?.[row.prodKey] || products?.[Number(row.prodKey)] || {};
                const exeLabel = exe
                  ? formatSplitQtyLabel(exe.outQty ?? exe.qty, exe.unit, product, { sourceUnit: row.unit })
                  : '-';
                return (
                  <tr key={row.prodKey}>
                    <td style={st.td}>{row.prodName}</td>
                    {batchNos.map((no) => (
                      <td key={no} style={st.tdRight}>{row.byRound?.[no] || '-'}</td>
                    ))}
                    <td style={st.tdRight}>{row.beforeLabel}</td>
                    <td style={st.tdRight}><b>{row.afterLabel}</b></td>
                    <td style={st.tdRight}>{exeLabel}</td>
                    <td style={st.td}>{row.roundLabel}</td>
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </>
  );
}

export default function HotelMiuIntakePage() {
  const initial = useMemo(() => defaultScope(), []);
  const weekOptions = initial.weeks;
  const [year, setYear] = useState(initial.year);
  const [week, setWeek] = useState(initial.week);
  const [defaults, setDefaults] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [cust, setCust] = useState(null);
  const [custQ, setCustQ] = useState('');
  const [custHits, setCustHits] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [needCust, setNeedCust] = useState(true);
  const [text, setText] = useState('');
  const [draft, setDraft] = useState([]);
  const [batches, setBatches] = useState([]);
  const [editing, setEditing] = useState(null);
  const [picker, setPicker] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [boxRounds, setBoxRounds] = useState({});
  const [boxFactors, setBoxFactors] = useState({});
  const [registerSnaps, setRegisterSnaps] = useState([]);
  const [historyFactors, setHistoryFactors] = useState({});
  const [historyOpen, setHistoryOpen] = useState(false);
  const [exeQty, setExeQty] = useState({});
  const [selectedVarieties, setSelectedVarieties] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const pasteLock = useRef(0);
  const boardMapRef = useRef({});
  const writeLock = useRef(false);
  const dirtyBoxKeys = useRef(new Set());

  const loadFavorites = async () => {
    const d = await apiGet('/api/favorites', { page: HOTEL_MIU_FAVORITE_PAGE });
    const list = (d.favorites || []).map((f) => {
      let data = {};
      try { data = JSON.parse(f.FilterData || '{}'); } catch { data = {}; }
      return {
        favoriteKey: f.FavoriteKey,
        name: f.FavName,
        custKey: Number(data.custKey),
        custName: data.custName || f.FavName,
        week: data.week || '',
        year: data.year || '',
      };
    }).filter((f) => f.custKey);
    setFavorites(list);
    return list;
  };

  const loadHistoryFactors = async (batchList) => {
    const keys = [...new Set((batchList || []).flatMap((b) => (b.lines || []).map((l) => Number(l.prodKey)).filter(Boolean)))];
    if (!keys.length) { setHistoryFactors({}); return; }
    const d = await apiGet('/api/sales/hotel-miu-intake', { prodKeys: keys.join(',') });
    const map = {};
    (d.products || []).forEach((p) => { map[Number(p.ProdKey)] = p; });
    setHistoryFactors(map);
  };

  const loadBatches = async (nextCust = cust, nextYear = year, nextWeek = week) => {
    if (!nextCust?.custKey || !nextYear || !nextWeek) { setBatches([]); setRegisterSnaps([]); setHistoryFactors({}); return; }
    const d = await apiGet('/api/sales/hotel-miu-intake', {
      year: nextYear, week: nextWeek, custKey: nextCust.custKey,
    });
    setBatches(d.batches || []);
    setRegisterSnaps(d.registerSnaps || []);
    await loadHistoryFactors(d.batches || []);
  };

  const loadExeQty = async (nextCust = cust, nextYear = year, nextWeek = week) => {
    if (!nextCust?.custKey || !nextYear || !nextWeek) { setExeQty({}); return {}; }
    const d = await apiGet('/api/orders', { year: nextYear, week: nextWeek, custName: nextCust.custName });
    const map = {};
    for (const order of d.orders || []) {
      if (Number(order.custKey) !== Number(nextCust.custKey)) continue;
      for (const it of order.items || []) {
        map[Number(it.prodKey)] = it;
      }
    }
    setExeQty(map);
    return map;
  };

  useEffect(() => {
    (async () => {
      try {
        const [, all] = await Promise.all([
          loadFavorites(),
          apiGet('/api/customers/search'),
        ]);
        setDefaults(resolveHotelMiuDefaultVendors(all.customers || all.rows || []));
      } catch (e) { setError(e.message); }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadBatches().catch((e) => setError(e.message)); }, [cust?.custKey, year, week]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setSelectedVarieties(readVarietyFilter(cust?.custKey));
  }, [cust?.custKey]);

  const extraVendors = favorites.filter((f) => !defaults.some((d) => d.custKey && d.custKey === f.custKey));

  const selectCust = (next) => {
    if (!next?.custKey) {
      setNeedCust(true);
      setError(`${next?.label || next?.custName || '업체'} 거래처를 찾지 못했습니다.`);
      return;
    }
    setCust({ custKey: next.custKey, custName: next.custName || next.label });
    setNeedCust(false);
    setError('');
    setShowAdd(false);
    setCustHits([]);
  };

  const selectWeek = async (opt) => {
    setYear(opt.year);
    setWeek(opt.week);
    if (!cust?.custKey) {
      setError('업체를 먼저 고른 뒤 차수를 누르면 주문등록 내역(반올림 전·후)을 봅니다.');
      return;
    }
    setBusy('history');
    setError('');
    try {
      const d = await apiGet('/api/sales/hotel-miu-intake', {
        year: opt.year, week: opt.week, custKey: cust.custKey,
      });
      setBatches(d.batches || []);
      setRegisterSnaps(d.registerSnaps || []);
      await loadHistoryFactors(d.batches || []);
      await loadExeQty(cust, opt.year, opt.week);
      setHistoryOpen(true);
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  };

  const addFavorite = async (hit) => {
    const name = hit.CustName || hit.custName;
    const key = Number(hit.CustKey || hit.custKey);
    await apiPost('/api/favorites', {
      page: HOTEL_MIU_FAVORITE_PAGE,
      name,
      filterData: JSON.stringify({ custKey: key, custName: name, year, week }),
    });
    const list = await loadFavorites();
    const f = list.find((x) => x.custKey === key);
    selectCust(f || { custKey: key, custName: name });
    setCustHits([]);
    setCustQ('');
    setShowAdd(false);
  };

  const removeFavorite = async (f) => {
    await fetch('/api/favorites', {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favoriteKey: f.favoriteKey }),
    });
    if (cust?.custKey === f.custKey) setCust(null);
    await loadFavorites();
  };

  const searchCust = async () => {
    if (!custQ.trim()) return;
    const d = await apiGet('/api/customers/search', { q: custQ.trim() });
    setCustHits(d.customers || d.rows || []);
    setNeedCust(true);
  };

  const requireCust = () => {
    if (cust?.custKey) return true;
    setNeedCust(true);
    setError('라움·신라·쵸이문·미우 중에서 업체를 고르세요.');
    return false;
  };

  const rememberMatch = (inputName, prod, unit) => {
    const rec = overlayMappingRecord(inputName, prod, unit);
    if (!rec) return null;
    boardMapRef.current = { ...boardMapRef.current, [rec.token]: rec.value };
    return rec;
  };

  const appendItems = (items, sourceType) => {
    const next = applyBoardOverlay(
      (items || []).filter((it) => !it.skip && Number(it.qty) > 0).map((it) => ({
        id: lineSeq++,
        inputName: it.inputName,
        qty: Number(it.qty),
        unit: it.unit || '',
        prodKey: it.prodKey || null,
        prodName: it.prodName || it.displayName || '',
        displayName: it.displayName || it.prodName || '',
        sourceType,
        suggestedProducts: it.suggestedProducts || [],
      })),
      boardMapRef.current,
      null,
    );
    setDraft((prev) => [...prev, ...next]);
  };

  const parseTextValue = async (raw) => {
    const body = String(raw || '').trim();
    if (!body) return;
    if (!requireCust()) return;
    setBusy('parse'); setError(''); setMessage('');
    try {
      const d = await apiPost('/api/sales/hotel-miu-parse', { text: body });
      appendItems(d.items, 'text');
      setText('');
      setMessage(`텍스트 ${d.summary?.matched || 0}/${d.summary?.active || 0}건 (이미지 OCR 아님). 아래 저장으로 ${cust.custName}에 합산을 남기세요.`);
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  };

  const parseText = async () => parseTextValue(text);

  const parseImage = async (file) => {
    if (!file) return;
    if (!requireCust()) return;
    if (busy === 'parse') return;
    setBusy('parse'); setError(''); setMessage('');
    try {
      const fd = new FormData();
      fd.append('file', file, file.name || `paste-${Date.now()}.png`);
      const res = await fetch('/api/sales/hotel-miu-parse', { method: 'POST', credentials: 'include', body: fd });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || '이미지 분석 실패');
      appendItems(d.items, 'image');
      setMessage(`이미지 OCR ${d.summary?.matched || 0}/${d.summary?.active || 0}건 매칭. 엑셀 칸 복사는 텍스트로 들어갑니다.`);
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  };

  const onPaste = useCallback((e) => {
    const raw = e.clipboardData?.getData('text/plain') || '';
    if (clipboardLooksLikeOrderText(raw)) {
      e.preventDefault();
      e.stopPropagation();
      const now = Date.now();
      if (now - pasteLock.current < 1500) return;
      pasteLock.current = now;
      parseTextValue(raw);
      return;
    }
    const inField = e.target && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT');
    if (inField) return;
    const file = getClipboardImage(e.clipboardData?.items);
    if (!file) return;
    e.preventDefault();
    e.stopPropagation();
    const now = Date.now();
    if (now - pasteLock.current < 1500) return;
    pasteLock.current = now;
    parseImage(file);
  }, [cust, busy, year, week]); // eslint-disable-line react-hooks/exhaustive-deps

  const merged = useMemo(() => mergeDraftLines(draft), [draft]);
  const unmatched = draft.filter((l) => !l.prodKey);
  const draftBatches = batches.filter(isDraftBatch);
  const registeredBatches = batches.filter((b) => !isDraftBatch(b));
  const nextSumNo = nextBatchNo(batches);
  const orderItems = useMemo(() => mergeAllBatchLines(draftBatches), [draftBatches]);
  const registerPreview = useMemo(() => registerPreviewTable(draftBatches), [draftBatches]);
  const registerItems = useMemo(
    () => buildRegisterItems(registerPreview, boxRounds, boxFactors),
    [registerPreview, boxRounds, boxFactors],
  );
  const historyView = useMemo(() => registeredHistoryView({
    batches: registeredBatches,
    snaps: registerSnaps,
    productsByKey: historyFactors,
  }), [registeredBatches, registerSnaps, historyFactors]);
  const confirmRows = useMemo(
    () => attachVarietyToRows(registerPreview.rows, boxFactors),
    [registerPreview, boxFactors],
  );

  const toggleVariety = (variety) => {
    setSelectedVarieties((prev) => {
      const next = toggleVarietyFilter(prev, variety);
      writeVarietyFilter(cust?.custKey, next);
      return next;
    });
  };
  const clearVarieties = () => {
    setSelectedVarieties([]);
    writeVarietyFilter(cust?.custKey, []);
  };

  const pickProduct = async (line, prod) => {
    const p = {
      prodKey: Number(prod.ProdKey || prod.prodKey),
      ProdKey: Number(prod.ProdKey || prod.prodKey),
      prodName: prod.ProdName || prod.prodName,
      ProdName: prod.ProdName || prod.prodName,
      displayName: prod.DisplayName || prod.displayName,
      DisplayName: prod.DisplayName || prod.displayName,
      FlowerName: prod.FlowerName || prod.flowerName,
      CounName: prod.CounName || prod.counName,
    };
    const apply = (row) => ({
      ...row,
      prodKey: p.prodKey,
      prodName: p.prodName,
      displayName: p.displayName || p.prodName,
    });
    if (Number.isInteger(line?.editIndex)) {
      setEditing((cur) => (cur
        ? { ...cur, lines: cur.lines.map((l, i) => (i === line.editIndex ? apply(l) : l)) }
        : cur));
    } else {
      setDraft((prev) => prev.map((l) => (l.inputName === line.inputName ? apply(l) : l)));
    }
    rememberMatch(line.inputName || line.prodName, p, line.unit);
    try {
      await apiPost('/api/sales/hotel-miu-intake', {
        action: 'saveMapping', inputName: line.inputName || line.prodName, prod: p, unit: line.unit,
      });
    } catch (e) {
      setError(`품목은 골랐지만 매칭 저장에 실패했습니다: ${e.message}`);
    }
    setPicker(null);
  };

  const saveToVendor = async () => {
    if (!requireCust()) return;
    if (unmatched.length) { setError(`미매칭 ${unmatched.length}건을 먼저 고르세요.`); return; }
    if (!merged.length) { setError('저장할 품목이 없습니다.'); return; }
    setBusy('save'); setError(''); setMessage('');
    try {
      const rec = await apiPost('/api/sales/hotel-miu-intake', {
        action: 'recordBatch',
        year, week, custKey: cust.custKey,
        status: HOTEL_MIU_BATCH_DRAFT,
        sourceNote: `${nextSumNo}합산`,
        lines: draft,
      });
      setDraft([]);
      setBatches(rec.batches || []);
      setMessage(`${cust.custName} ${nextSumNo}합산에 저장했습니다. 더 넣을 수 있고, 다 넣은 뒤 주문등록하세요.`);
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  };

  const openRegisterConfirm = async () => {
    if (!requireCust()) return;
    if (draft.length) { setError('이번 입력을 먼저 이 업체 합산으로 저장하세요.'); return; }
    if (!draftBatches.length) { setError('저장된 합산이 없습니다. 품목을 넣은 뒤 업체에 저장하세요.'); return; }
    const unmatchedSaved = draftBatches.flatMap((b) => (b.lines || [])).filter((l) => !l.prodKey);
    if (unmatchedSaved.length) { setError('저장된 합산에 미매칭 품목이 있습니다.'); return; }
    if (!orderItems.length) { setError('주문등록할 품목이 없습니다.'); return; }
    setError('');
    setBusy('confirm');
    try {
      const keys = [...new Set(orderItems.map((it) => Number(it.prodKey)).filter(Boolean))];
      const d = keys.length
        ? await apiGet('/api/sales/hotel-miu-intake', { prodKeys: keys.join(',') })
        : { products: [] };
      const map = {};
      (d.products || []).forEach((p) => { map[Number(p.ProdKey)] = p; });
      setBoxFactors(map);
      setBoxRounds({});
      dirtyBoxKeys.current = new Set();
      setConfirming(true);
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  };

  const persistBoxFactor = async (row, raw) => {
    const n = Number(raw);
    if (!row?.prodKey || !(n > 0)) return;
    await apiPost('/api/sales/hotel-miu-intake', {
      action: 'saveBoxFactor',
      prod: { prodKey: row.prodKey, prodName: row.prodName, displayName: row.prodName },
      unit: row.unit,
      perBox: n,
    });
  };

  const persistDirtyBoxFactors = async (factors = boxFactors) => {
    const rows = (registerPreview?.rows || []).filter((row) => dirtyBoxKeys.current.has(Number(row.prodKey)));
    for (const row of rows) {
      const perBox = boxFactorForUnit(row.unit, factors[row.prodKey]);
      if (!(perBox > 0)) continue;
      await persistBoxFactor(row, perBox);
      dirtyBoxKeys.current.delete(Number(row.prodKey));
    }
  };

  const register = async () => {
    if (!confirming) return;
    if (!registerItems.length) { setError('주문등록할 수량이 없습니다. 반내림으로 0박스가 된 품목을 확인하세요.'); return; }
    if (writeLock.current) { setError('이전 주문 반영이 끝나기 전에 다시 누를 수 없습니다.'); return; }
    writeLock.current = true;
    setBusy('register'); setError(''); setMessage('');
    try {
      await persistDirtyBoxFactors();
      await apiPost('/api/orders', {
        source: 'hotel-miu-board',
        custKey: cust.custKey,
        custName: cust.custName,
        year,
        week,
        items: registerItems,
      });
      const rec = await apiPost('/api/sales/hotel-miu-intake', {
        action: 'markRegistered',
        year, week, custKey: cust.custKey,
        batchKeys: draftBatches.map((b) => b.batchKey),
        history: buildRegisterHistory(registerPreview, registerItems, boxRounds),
      });
      setBatches(rec.batches || []);
      setRegisterSnaps(rec.registerSnaps || []);
      await loadHistoryFactors(rec.batches || []);
      await loadExeQty();
      setConfirming(false);
      setHistoryOpen(true);
      setMessage(`${cust.custName} 주문수량에 ${draftBatches.length}개 합산을 더했습니다. 아래 주문반영 내역에서 반올림 전·후를 확인하세요.`);
    } catch (e) { setError(e.message); }
    finally { writeLock.current = false; setBusy(''); }
  };

  const persistBatchLines = async (batch, nextLines, originalLines = batch.lines) => {
    if (writeLock.current) { setError('이전 주문 반영이 끝나기 전에 다시 누를 수 없습니다.'); return; }
    writeLock.current = true;
    const wasDraft = isDraftBatch(batch);
    const others = batches.filter((b) => !isDraftBatch(b) && Number(b.batchKey) !== Number(batch.batchKey));
    const delta = wasDraft
      ? []
      : orderDeltaForRegisteredBatch({
        previousLines: originalLines,
        nextLines,
        snaps: registerSnaps,
        otherRegisteredBatches: others,
      });
    setBusy('edit'); setError('');
    try {
      if (delta.length) {
        try {
          await apiPost('/api/orders', {
            source: 'hotel-miu-board',
            custKey: cust.custKey,
            custName: cust.custName,
            year, week,
            items: delta,
          });
        } catch (e) {
          if (!isHotelMiuCancelOverflowError(e.message)) throw e;
        }
      }
      const rec = await apiPost('/api/sales/hotel-miu-intake', {
        action: 'updateBatch',
        year, week, custKey: cust.custKey,
        batchKey: batch.batchKey,
        lines: nextLines,
      });
      setBatches(rec.batches || []);
      await loadHistoryFactors(rec.batches || []);
      if (delta.length) await loadExeQty();
      setEditing(null);
      setMessage(wasDraft
        ? (nextLines.length ? `${batch.batchNo}합산을 고쳤습니다.` : `${batch.batchNo}합산을 삭제했습니다.`)
        : `${batch.batchNo}합산 변경을 주문수량에 반영했습니다.`);
    } catch (e) { setError(e.message); }
    finally { writeLock.current = false; setBusy(''); }
  };

  const reapplyHistory = async () => {
    const items = reapplyItemsFromSnaps(registerSnaps);
    if (!items.length) { setError('다시 더할 등록 수량이 없습니다.'); return; }
    if (!window.confirm(`${cust.custName} ${week} 전산 주문수량에 등록내역 ${items.length}품목을 다시 더할까요?`)) return;
    if (writeLock.current) { setError('이전 주문 반영이 끝나기 전에 다시 누를 수 없습니다.'); return; }
    writeLock.current = true;
    setBusy('reapply'); setError(''); setMessage('');
    try {
      await apiPost('/api/orders', {
        source: 'hotel-miu-board',
        custKey: cust.custKey,
        custName: cust.custName,
        year, week,
        items,
      });
      await loadExeQty();
      setMessage(`${cust.custName} 전산 주문수량에 등록내역을 다시 더했습니다. nenova.exe 주문등록에서 같은 연도·차수·업체를 확인하세요.`);
    } catch (e) { setError(e.message); }
    finally { writeLock.current = false; setBusy(''); }
  };

  const saveBatchEdit = async () => {
    if (!editing) return;
    if (editing.lines.some((l) => !l.prodKey)) {
      setError('미매칭 품목을 먼저 고르세요.');
      return;
    }
    if (!editing.lines.length && !window.confirm(`${editing.batchNo}합산의 품목을 모두 지울까요?`)) return;
    await persistBatchLines(editing, editing.lines, editing.original);
  };

  const removeEditingLine = (idx) => {
    const line = editing?.lines?.[idx];
    if (!line) return;
    const name = line.prodName || line.inputName || '이 품목';
    if (!window.confirm(`${name}을(를) 합산에서 삭제할까요?`)) return;
    setEditing((cur) => ({ ...cur, lines: cur.lines.filter((_, i) => i !== idx) }));
  };

  const deleteEntireBatch = async (batch) => {
    const extra = isDraftBatch(batch) ? '' : ' 이미 주문에 더한 수량만큼 주문에서도 빠집니다.';
    if (!window.confirm(`${batch.batchNo}합산을 통째로 삭제할까요?${extra}`)) return;
    await persistBatchLines(batch, [], batch.original || batch.lines);
  };

  const removeCardLine = async (batch, line) => {
    const name = line.prodName || line.inputName || '이 품목';
    const extra = isDraftBatch(batch) ? '' : ' 주문수량에서도 빠집니다.';
    if (!window.confirm(`${name}을(를) ${batch.batchNo}합산에서 삭제할까요?${extra}`)) return;
    const next = (batch.lines || []).filter((x) => {
      if (line.prodKey && x.prodKey) return Number(x.prodKey) !== Number(line.prodKey);
      return String(x.inputName || x.prodName) !== String(line.inputName || line.prodName);
    });
    await persistBatchLines(batch, next, batch.lines);
  };

  const toggleBoxRound = (prodKey, dir) => {
    setBoxRounds((prev) => {
      if (prev[prodKey] === dir) {
        const next = { ...prev };
        delete next[prodKey];
        return next;
      }
      return { ...prev, [prodKey]: dir };
    });
  };

  const setBoxPerBox = (row, raw) => {
    const n = Number(raw);
    dirtyBoxKeys.current.add(Number(row.prodKey));
    setBoxFactors((prev) => ({
      ...prev,
      [row.prodKey]: applyPerBoxOverride(row.unit, prev[row.prodKey] || {}, n),
    }));
  };

  return (
    <div style={st.page} onPaste={onPaste}>
      <div style={st.head}>
        <div>
          <h1 style={st.h1}>호텔+미우 통합게시판</h1>
          <p style={st.sub}>기본 업체(라움·신라·쵸이문·미우)와 차수(기본~36-02)를 고른 뒤, 이미지·텍스트를 그 업체 합산으로 쌓고 마지막에 주문수량만 더합니다. 출고분배는 하지 않습니다.</p>
        </div>
        <a href="/sales/shilla-miu-allocation" style={st.linkBtn}>잔량분배표</a>
      </div>

      {error && <div style={st.err}>{error}</div>}
      {message && <div style={st.okMsg}>{message}</div>}

      <div style={needCust || !cust ? st.custBoxOn : st.custBox}>
        <b>1) 작업 업체 · 차수</b>
        <div style={st.pickRow}>
          {(defaults.length ? defaults : [
            { label: '라움' }, { label: '신라' }, { label: '쵸이문' }, { label: '미우' },
          ]).map((v) => (
            <button
              key={v.label}
              type="button"
              style={{
                ...(cust?.custKey && cust.custKey === v.custKey ? st.pickOn : st.pick),
                opacity: v.custKey ? 1 : 0.45,
              }}
              disabled={!v.custKey}
              title={v.custKey ? v.custName : `${v.label} 거래처를 찾지 못했습니다`}
              onClick={() => selectCust(v)}
            >{v.label}</button>
          ))}
          {extraVendors.map((f) => (
            <span key={f.favoriteKey} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              <button type="button" style={cust?.custKey === f.custKey ? st.pickOn : st.pick} onClick={() => selectCust(f)}>{f.custName}</button>
              <button type="button" style={st.tiny} onClick={() => removeFavorite(f)} title="추가 업체 해제">×</button>
            </span>
          ))}
          <button type="button" style={st.addBtn} onClick={() => setShowAdd((v) => !v)}>+ 추가</button>
        </div>
        {showAdd && (
          <div style={st.bar}>
            <input style={{ ...st.inp, width: 180 }} value={custQ} onChange={(e) => setCustQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && searchCust()} placeholder="추가할 업체 이름" />
            <button type="button" style={st.btn} onClick={searchCust}>검색</button>
            {custHits.length > 0 && (
              <div style={st.hits}>
                {custHits.slice(0, 8).map((c) => (
                  <button key={c.CustKey || c.custKey} type="button" style={st.chip} onClick={() => addFavorite(c)}>
                    + {c.CustName || c.custName}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div style={st.pickRow}>
          <span style={st.muted}>차수</span>
          {weekOptions.map((opt) => (
            <button
              key={opt.week}
              type="button"
              style={week === opt.week ? st.pickOn : st.pick}
              title="주문등록 내역(반올림 전·후)"
              onClick={() => selectWeek(opt)}
            >{opt.isDefault ? `${opt.label} 기본` : opt.label}</button>
          ))}
        </div>
        {cust
          ? <div style={st.note}>작업 업체: <b>{cust.custName}</b> · {year} / {week} · 품목은 이 이름 아래 1합산, 2합산으로 쌓입니다. 주문등록 후 반올림 전·후는 아래 주문반영 내역에 남고, 차수 버튼을 눌러도 볼 수 있습니다.</div>
          : <div style={st.warnNote}>라움·신라·쵸이문·미우 중 하나를 고른 뒤에만 이미지/텍스트를 넣을 수 있습니다.</div>}
      </div>

      <div style={st.grid}>
        <div style={st.panel}>
          <b>2) 이미지 붙여넣기 / 텍스트 추가</b>
          <div style={st.drop}>엑셀 칸을 복사해 Ctrl+V 하면 글자 그대로 들어갑니다. 표 사진만 있을 때만 이미지 OCR을 씁니다.</div>
          <input type="file" accept="image/*" onChange={(e) => { parseImage(e.target.files?.[0]); e.target.value = ''; }} />
          <textarea
            style={st.ta}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              e.stopPropagation();
              const raw = e.clipboardData?.getData('text/plain') || '';
              if (!clipboardLooksLikeOrderText(raw)) return;
              e.preventDefault();
              const now = Date.now();
              if (now - pasteLock.current < 1500) return;
              pasteLock.current = now;
              parseTextValue(raw);
            }}
            placeholder={'엑셀에서 복사한 품명 / 단위 / 수량\n수국 화이트\t대\t220'}
          />
          <button style={st.primary} disabled={busy === 'parse'} onClick={parseText}>{busy === 'parse' ? '분석 중…' : '텍스트로 품목 추가'}</button>
        </div>
        <div style={st.panel}>
          <b>3) 이번 입력 — 매칭 후 업체에 저장</b>
          {!draft.length && <div style={st.muted}>아직 추가된 행이 없습니다.</div>}
          {!!draft.length && (
            <table style={st.matchTbl}>
              <thead>
                <tr>
                  <th style={st.matchTh}>입력</th>
                  <th style={st.matchTh}>매칭</th>
                  <th style={st.matchThRight}>수량</th>
                  <th style={st.matchTh}>단위</th>
                  <th style={st.matchTh} />
                </tr>
              </thead>
              <tbody>
                {draft.map((l) => (
                  <tr key={l.id}>
                    <td style={st.matchTdName}>
                      {l.inputName}
                      {l.sourceType === 'image' ? <span style={st.srcImg}> 이미지</span> : null}
                    </td>
                    <td style={st.matchTdName}>
                      <button style={l.prodKey ? st.matchOk : st.warn} onClick={() => setPicker(l)}>{l.displayName || l.prodName || '품목 매칭'}</button>
                    </td>
                    <td style={st.matchTdRight}>
                      <input style={{ ...st.inp, width: 64 }} value={l.qty} onChange={(e) => setDraft((p) => p.map((x) => (x.id === l.id ? { ...x, qty: Number(e.target.value) || 0 } : x)))} />
                    </td>
                    <td style={st.matchTd}>{l.unit || '-'}</td>
                    <td style={st.matchTd}><button style={st.tiny} onClick={() => setDraft((p) => p.filter((x) => x.id !== l.id))}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!!draft.length && (
            <div style={{ marginTop: 10 }}>
              <b>이번 합칠 수량 ({merged.length}품목)</b>
              {merged.map((m) => (
                <div key={m.prodKey} style={st.merge}>{m.displayName || m.prodName} · {m.unit} · {fmt(m.qty)}</div>
              ))}
              <button style={st.primary} disabled={!!busy} onClick={saveToVendor}>
                {busy === 'save' ? '저장 중…' : `${cust?.custName || '업체'}에 ${nextSumNo}합산으로 저장`}
              </button>
            </div>
          )}
        </div>
      </div>

      <div style={st.panel}>
        <b>{cust?.custName || '업체'} 합산 — 1합산 / 2합산</b>
        {!draftBatches.length && <div style={st.muted}>아직 이 업체에 저장된 합산이 없습니다. 품목을 넣은 뒤 저장하세요.</div>}
        <div style={st.sumRow}>
          {draftBatches.map((b, i) => (
            <div key={b.batchKey} style={st.sumCard}>
              {i > 0 && <div style={st.sumDash} />}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <b>{b.batchNo}합산</b>
                <span>{fmt(batchLineTotal(b.lines))}</span>
                <button style={st.btn} disabled={!!busy} onClick={() => setEditing({ ...b, original: b.lines.map((l) => ({ ...l })) })}>수정</button>
                <button type="button" style={st.danger} disabled={!!busy} onClick={() => deleteEntireBatch(b)}>삭제</button>
              </div>
              {mergeDraftLines(b.lines).map((l) => (
                <div key={l.prodKey || l.inputName} style={st.merge}>
                  <span>{l.displayName || l.prodName || l.inputName} · {l.unit} · {fmt(l.qty)}</span>
                  <button type="button" style={st.tiny} disabled={!!busy} onClick={() => removeCardLine(b, l)} title="품목 삭제">×</button>
                </div>
              ))}
            </div>
          ))}
        </div>
        <button style={st.orderBtn} disabled={!!busy} onClick={openRegisterConfirm}>
          {busy === 'confirm' ? '확인표 준비…' : busy === 'register' ? '등록 중…' : `주문등록 (더하기) — ${draftBatches.length}개 합산`}
        </button>
      </div>

      {!!registeredBatches.length && (
        <div style={st.panel}>
          <b>주문반영 내역 — {cust?.custName} / {week}</b>
          <p style={st.muted}>1·2·3차는 그 합산 원문입니다. 반올림 전은 합계, 괄호는 박스+나머지입니다. 품종 버튼으로 묶어서 볼 수 있습니다. 출고분배는 하지 않습니다.</p>
          <HistoryQtyTable
            view={historyView}
            exeQty={exeQty}
            products={historyFactors}
            selectedVarieties={selectedVarieties}
            onToggleVariety={toggleVariety}
            onClearVarieties={clearVarieties}
          />
          {registeredBatches.map((b) => (
            <div key={b.batchKey} style={st.batch}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <b>{b.batchNo}합산 (주문반영)</b>
                <span style={st.muted}>{b.createdAt}</span>
                <button style={st.btn} disabled={!!busy} onClick={() => setEditing({ ...b, original: b.lines.map((l) => ({ ...l })) })}>수정</button>
                <button type="button" style={st.danger} disabled={!!busy} onClick={() => deleteEntireBatch(b)}>삭제</button>
              </div>
              {b.lines.map((l, i) => {
                const h = registeredLineHistory(l, historyView.rows, historyFactors[l.prodKey] || historyFactors[Number(l.prodKey)]);
                return (
                <div key={i} style={st.merge}>
                  <span>{l.prodName || l.inputName} · 전 {h.beforeLabel} → 후 {h.afterLabel}{h.roundLabel ? ` (${h.roundLabel})` : ''}</span>
                  <button type="button" style={st.tiny} disabled={!!busy} onClick={() => removeCardLine(b, l)} title="품목 삭제">×</button>
                </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div style={st.modal}>
          <div style={st.modalBox}>
            <b>{editing.batchNo}{isDraftBatch(editing) ? '합산' : '합산(주문반영)'} 수량·품목매칭 수정</b>
            {!editing.lines.length && <div style={st.muted}>품목이 없습니다. 저장하면 이 합산이 삭제됩니다.</div>}
            {editing.lines.map((l, i) => (
              <div key={i} style={st.row}>
                <span>{l.inputName || l.prodName}</span>
                <button
                  type="button"
                  style={l.prodKey ? st.matchOk : st.warn}
                  disabled={!!busy}
                  onClick={() => setPicker({
                    ...l,
                    editIndex: i,
                    inputName: l.inputName || l.displayName || l.prodName || '',
                  })}
                >{l.displayName || l.prodName || '품목 매칭'}</button>
                <span style={st.muted}>{l.unit || ''}</span>
                <input style={{ ...st.inp, width: 72 }} value={l.qty} onChange={(e) => {
                  const qty = Number(e.target.value) || 0;
                  setEditing((cur) => ({ ...cur, lines: cur.lines.map((x, idx) => (idx === i ? { ...x, qty } : x)) }));
                }} />
                <button type="button" style={st.tiny} disabled={!!busy} onClick={() => removeEditingLine(i)} title="품목 삭제">×</button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button style={st.primary} disabled={!!busy} onClick={saveBatchEdit}>
                {isDraftBatch(editing) ? '합산 저장' : '주문수량에 차이만큼 반영'}
              </button>
              <button type="button" style={st.danger} disabled={!!busy} onClick={() => deleteEntireBatch(editing)}>합산 전체 삭제</button>
              <button style={st.btn} onClick={() => setEditing(null)}>닫기</button>
            </div>
          </div>
        </div>
      )}

      {confirming && (
        <div style={st.modal}>
          <div style={{ ...st.modalBox, width: 'min(1100px, 96vw)' }}>
            <b>주문등록 수량 확인 — {cust?.custName} / {week}</b>
            <p style={st.muted}>아래 합계를 주문수량에 더합니다. 품종 버튼은 화면만 묶어서 보여 주고, 주문등록은 숨긴 품종도 함께 더합니다. 박스당 단/송이가 틀리면 고친 뒤 반올림·반내림하세요. 고친 박스당은 매칭 데이터처럼 저장되어 다음 주문등록에도 쓰입니다. 전산 품목 마스터와 출고분배는 건드리지 않습니다.</p>
            <VarietyChipBar rows={confirmRows} selectedVarieties={selectedVarieties} onToggle={toggleVariety} onClear={clearVarieties} />
            <table style={st.tbl}>
              <thead>
                <tr>
                  <th style={st.th}>품목</th>
                  <th style={st.th}>단위</th>
                  {registerPreview.batchNos.map((no) => (
                    <th key={no} style={st.thRight}>{no}합산</th>
                  ))}
                  <th style={st.thRight}>합계</th>
                  <th style={st.thRight}>박스당</th>
                  <th style={st.thRight}>나머지</th>
                  <th style={st.thRight}>주문</th>
                  <th style={st.th}>박스맞춤</th>
                </tr>
              </thead>
              <tbody>
                {groupRowsByVariety(filterRowsByVarieties(confirmRows, selectedVarieties)).map((g) => (
                  <Fragment key={g.variety}>
                    <tr>
                      <td colSpan={2 + registerPreview.batchNos.length + 5} style={st.varHead}>{g.variety}</td>
                    </tr>
                    {g.rows.map((row) => {
                  const hint = boxRoundHint(row.total, row.unit, boxFactors[row.prodKey]);
                  const round = boxRounds[row.prodKey];
                  const orderLabel = hint.needsRound && round === 'up'
                    ? roundChoiceLabel(hint, 'up')
                    : hint.needsRound && round === 'down'
                      ? (hint.floorBoxes > 0 ? roundChoiceLabel(hint, 'down') : '0 (제외)')
                      : `${fmt(row.total)}${row.unit || ''}`;
                  return (
                    <tr key={row.prodKey}>
                      <td style={st.td}>{row.prodName}</td>
                      <td style={st.td}>{row.unit || '-'}</td>
                      {registerPreview.batchNos.map((no) => (
                        <td key={no} style={st.tdRight}>{row.byBatch[no] ? fmt(row.byBatch[no]) : '-'}</td>
                      ))}
                      <td style={st.tdRight}><b>{fmt(row.total)}</b></td>
                      <td style={st.tdRight}>
                        <input
                          style={st.perBoxInp}
                          value={hint.perBox || ''}
                          onChange={(e) => setBoxPerBox(row, e.target.value)}
                          onBlur={(e) => {
                            const n = Number(e.target.value);
                            if (!(n > 0) || !dirtyBoxKeys.current.has(Number(row.prodKey))) return;
                            persistBoxFactor(row, n)
                              .then(() => { dirtyBoxKeys.current.delete(Number(row.prodKey)); })
                              .catch((err) => setError(err.message));
                          }}
                          title={`${row.unit || ''} / 1박스`}
                        />
                        <span style={st.muted}>{row.unit || ''}</span>
                      </td>
                      <td style={st.tdRight}>{hint.needsRound ? fmt(hint.remainder) : '-'}</td>
                      <td style={st.tdRight}><b>{orderLabel}</b></td>
                      <td style={st.td}>
                        {hint.needsRound ? (
                          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                            <button type="button" style={round === 'up' ? st.chipOn : st.chip} onClick={() => toggleBoxRound(row.prodKey, 'up')}>반올림 {roundChoiceLabel(hint, 'up')}</button>
                            <button type="button" style={round === 'down' ? st.chipOn : st.chip} onClick={() => toggleBoxRound(row.prodKey, 'down')}>반내림 {roundChoiceLabel(hint, 'down')}</button>
                          </span>
                        ) : <span style={st.muted}>{hint.perBox > 1 ? '정수 박스' : '박스당을 입력하면 반올림할 수 있습니다'}</span>}
                      </td>
                    </tr>
                  );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button style={st.orderBtn} disabled={!!busy || !registerItems.length} onClick={register}>
                {busy === 'register' ? '등록 중…' : `주문수량에 더하기 — ${registerItems.length}품목`}
              </button>
              <button style={st.btn} disabled={!!busy} onClick={() => { setConfirming(false); setBoxRounds({}); }}>취소</button>
            </div>
          </div>
        </div>
      )}

      {historyOpen && (
        <div style={st.modal}>
          <div style={{ ...st.modalBox, width: 'min(1200px, 96vw)' }}>
            <b>주문등록 내역 — {cust?.custName} / {week}</b>
            <p style={st.muted}>1·2·3차는 그 합산 원문입니다. 반올림 전은 합계, 괄호는 박스+나머지입니다. 품종 버튼으로 묶어서 볼 수 있습니다. 출고분배는 하지 않습니다.</p>
            <HistoryQtyTable
              view={historyView}
              exeQty={exeQty}
              products={historyFactors}
              selectedVarieties={selectedVarieties}
              onToggleVariety={toggleVariety}
              onClearVarieties={clearVarieties}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button style={st.orderBtn} disabled={!!busy || !reapplyItemsFromSnaps(registerSnaps).length} onClick={reapplyHistory}>
                {busy === 'reapply' ? '반영 중…' : '등록내역을 전산에 다시 더하기'}
              </button>
              <button style={st.btn} onClick={() => setHistoryOpen(false)}>닫기</button>
            </div>
          </div>
        </div>
      )}

      {picker && (
        <div style={st.modalFront}>
          <div style={st.modalBox}>
            <b>품목 매칭 — {picker.inputName || picker.prodName}</b>
            <ProductSearch query={picker.inputName || picker.prodName} suggestions={picker.suggestedProducts} onPick={(p) => pickProduct(picker, p)} onClose={() => setPicker(null)} />
          </div>
        </div>
      )}
    </div>
  );
}

function ProductSearch({ query, suggestions, onPick, onClose }) {
  const [q, setQ] = useState(query || '');
  const [rows, setRows] = useState(suggestions || []);
  const search = async () => {
    const d = await apiGet('/api/products/search', { q });
    setRows(d.products || d.rows || []);
  };
  useEffect(() => { if (!suggestions?.length) search(); }, []); // eslint-disable-line
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, margin: '8px 0' }}>
        <input style={{ ...st.inp, flex: 1, width: 'auto' }} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
        <button style={st.btn} onClick={search}>검색</button>
      </div>
      {(Array.isArray(rows) ? rows : []).slice(0, 12).map((p) => (
        <button key={p.ProdKey || p.prodKey} style={{ ...st.chip, display: 'block', width: '100%', textAlign: 'left', marginBottom: 4 }} onClick={() => onPick(p)}>
          {p.ProdName || p.prodName} {p.DisplayName || p.displayName ? `(${p.DisplayName || p.displayName})` : ''} · {p.CounName || p.counName || ''}
        </button>
      ))}
      <button style={st.btn} onClick={onClose}>닫기</button>
    </div>
  );
}

const st = {
  page: { padding: '12px 16px', maxWidth: 'min(1680px, 100%)', margin: '0 auto', fontSize: 13, color: '#0f172a' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  h1: { margin: 0, fontSize: 20 },
  sub: { margin: '6px 0 0', color: '#64748b', fontSize: 12 },
  bar: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', margin: '8px 0' },
  inp: { border: '1px solid #cbd5e1', borderRadius: 6, padding: '6px 8px', width: 88 },
  btn: { border: '1px solid #94a3b8', background: '#fff', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' },
  primary: { background: '#0f766e', color: '#fff', border: 0, borderRadius: 8, padding: '8px 14px', fontWeight: 700, cursor: 'pointer', marginTop: 8 },
  orderBtn: { background: '#0f766e', color: '#fff', border: 0, borderRadius: 8, padding: '10px 16px', fontWeight: 800, cursor: 'pointer', marginTop: 12 },
  linkBtn: { background: '#1d4ed8', color: '#fff', textDecoration: 'none', borderRadius: 8, padding: '8px 12px', fontWeight: 700 },
  chip: { border: '1px solid #cbd5e1', background: '#fff', borderRadius: 999, padding: '4px 10px', cursor: 'pointer' },
  chipOn: { border: '1px solid #0f766e', background: '#ccfbf1', borderRadius: 999, padding: '4px 10px', cursor: 'pointer', fontWeight: 800 },
  pick: { border: '1px solid #94a3b8', background: '#fff', borderRadius: 10, padding: '10px 16px', cursor: 'pointer', fontSize: 15, fontWeight: 700, minWidth: 72 },
  pickOn: { border: '2px solid #0f766e', background: '#ccfbf1', borderRadius: 10, padding: '10px 16px', cursor: 'pointer', fontSize: 15, fontWeight: 800, minWidth: 72, color: '#0f766e' },
  pickRow: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', margin: '10px 0' },
  addBtn: { border: '1px dashed #64748b', background: '#fff', borderRadius: 10, padding: '10px 14px', cursor: 'pointer', color: '#334155' },
  tiny: { border: 0, background: 'transparent', cursor: 'pointer', color: '#64748b' },
  hits: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 },
  note: { background: '#f0fdfa', border: '1px solid #99f6e4', borderRadius: 8, padding: '6px 10px', marginTop: 8 },
  warnNote: { background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 8, padding: '6px 10px', marginTop: 8 },
  custBox: { border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, background: '#fff', margin: '12px 0' },
  custBoxOn: { border: '2px solid #0f766e', borderRadius: 10, padding: 12, background: '#f0fdfa', margin: '12px 0' },
  grid: { display: 'grid', gridTemplateColumns: 'minmax(220px, 280px) minmax(0, 1fr)', gap: 12, marginBottom: 12, alignItems: 'start' },
  panel: { border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, background: '#fff', marginBottom: 12 },
  drop: { background: '#f8fafc', border: '1px dashed #94a3b8', borderRadius: 8, padding: 10, margin: '8px 0', color: '#475569', fontSize: 12 },
  ta: { width: '100%', minHeight: 72, border: '1px solid #cbd5e1', borderRadius: 8, padding: 8, marginTop: 8, fontSize: 12 },
  row: { display: 'flex', gap: 6, alignItems: 'center', padding: '3px 0', borderBottom: '1px solid #f1f5f9', justifyContent: 'flex-start' },
  merge: { fontSize: 12, color: '#334155', padding: '1px 0', display: 'flex', justifyContent: 'flex-start', alignItems: 'center', gap: 6 },
  matchTbl: { width: 'auto', maxWidth: '100%', borderCollapse: 'collapse', marginTop: 4, fontSize: 12 },
  matchTh: { textAlign: 'left', padding: '3px 8px 3px 0', color: '#64748b', fontWeight: 700, whiteSpace: 'nowrap' },
  matchThRight: { textAlign: 'right', padding: '3px 8px 3px 0', color: '#64748b', fontWeight: 700, whiteSpace: 'nowrap' },
  matchTd: { padding: '3px 8px 3px 0', verticalAlign: 'middle', whiteSpace: 'nowrap' },
  matchTdName: { padding: '3px 8px 3px 0', verticalAlign: 'middle', maxWidth: 260 },
  matchTdRight: { padding: '3px 8px 3px 0', verticalAlign: 'middle', textAlign: 'right', whiteSpace: 'nowrap' },
  batch: { borderTop: '1px solid #e2e8f0', padding: '8px 0' },
  muted: { color: '#94a3b8', fontSize: 12 },
  okMsg: { background: '#f0fdf4', color: '#166534', padding: 8, borderRadius: 8, margin: '8px 0' },
  err: { background: '#fef2f2', color: '#b91c1c', padding: 8, borderRadius: 8, margin: '8px 0' },
  warn: { background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 6, padding: '4px 8px', cursor: 'pointer' },
  matchOk: { background: '#ecfdf5', border: '1px solid #6ee7b7', borderRadius: 6, padding: '4px 8px', cursor: 'pointer' },
  srcImg: { fontSize: 11, color: '#b45309', fontWeight: 700 },
  sumRow: { display: 'flex', gap: 0, flexWrap: 'wrap', alignItems: 'stretch', marginTop: 8 },
  sumCard: { flex: '0 1 320px', border: '1px solid #99f6e4', borderRadius: 8, padding: 10, background: '#f0fdfa', position: 'relative' },
  sumDash: { position: 'absolute', left: -14, top: '45%', width: 28, borderTop: '2px dashed #94a3b8' },
  modal: { position: 'fixed', inset: 0, background: '#0006', display: 'grid', placeItems: 'center', zIndex: 40 },
  modalFront: { position: 'fixed', inset: 0, background: '#0006', display: 'grid', placeItems: 'center', zIndex: 50 },
  modalBox: { background: '#fff', padding: 16, width: 'min(720px, 92vw)', maxHeight: '80vh', overflow: 'auto', borderRadius: 10 },
  danger: { border: '1px solid #fca5a5', background: '#fef2f2', color: '#b91c1c', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' },
  tbl: { width: 'auto', maxWidth: '100%', borderCollapse: 'collapse', marginTop: 4, fontSize: 11 },
  th: { textAlign: 'left', borderBottom: '1px solid #cbd5e1', padding: '2px 5px', color: '#475569', fontWeight: 700 },
  thRight: { textAlign: 'right', borderBottom: '1px solid #cbd5e1', padding: '2px 5px', color: '#475569', fontWeight: 700 },
  td: { borderBottom: '1px solid #f1f5f9', padding: '2px 5px', verticalAlign: 'middle' },
  tdRight: { borderBottom: '1px solid #f1f5f9', padding: '2px 5px', textAlign: 'right', verticalAlign: 'middle' },
  varRow: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', margin: '6px 0' },
  varHead: { background: '#f1f5f9', color: '#0f766e', fontWeight: 800, padding: '3px 5px', borderBottom: '1px solid #cbd5e1' },
  perBoxInp: { border: '1px solid #cbd5e1', borderRadius: 6, padding: '3px 6px', width: 52, textAlign: 'right', marginRight: 4 },
};
