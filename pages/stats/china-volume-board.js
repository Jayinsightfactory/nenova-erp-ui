import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import * as XLSX from 'xlsx';
import XLSXStyled from 'xlsx-js-style';
import { apiDelete, apiGet, apiPost } from '../../lib/useApi';
import {
  buildChinaVolumeWorkbookRows,
  applyChinaPackingCustomerMatch,
  canApplyChinaPackingRows,
  chinaVolumeProductLabel,
  matchChinaPackingRows,
  mergeChinaPackingIntoPivotCells,
  normalizeChinaText,
  parseChinaPackingRows,
  planChinaBoxNeighborAreas,
  restoreChinaPackingCells,
  summarizeChinaVolumeTotals,
  stepChinaOrderWeek,
  validateChinaCellAllocation,
} from '../../lib/chinaVolumeBoard';

const currentYear = new Date().getFullYear();
const DEFAULT_WEEK = '35-01';

function fmt(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : number.toLocaleString('ko-KR', { maximumFractionDigits: 3 });
}

function fmtUnitTotals(unitTotals, field) {
  const values = (unitTotals || []).filter(item => Math.abs(Number(item?.[field] || 0)) >= 0.001);
  return values.length ? values.map(item => `${item.unit} ${fmt(item[field])}`).join(' · ') : '0';
}

function fmtUnitDifferences(unitTotals) {
  const values = (unitTotals || []).map(item => ({ unit: item.unit, difference: Number(item.board || 0) - Number(item.allocated || 0) })).filter(item => Math.abs(item.difference) >= 0.001);
  return values.length ? values.map(item => `${item.unit} ${fmt(item.difference)}`).join(' · ') : '0';
}

function chinaMappingKey(value) {
  return normalizeChinaText(value);
}

function mergeChinaProductCandidates(pivotData, productCatalog = []) {
  const byKey = new Map();
  [...(pivotData?.rows || []), ...(productCatalog || [])]
    .filter(row => /중국/i.test(String(row?.country || '')))
    .forEach(row => byKey.set(Number(row.prodKey), { ...row, outOrders: row.outOrders || {} }));
  return [...byKey.values()];
}

function applySavedChinaMappings(rows, pivotData, productMappings = {}, productCatalog = []) {
  const products = mergeChinaProductCandidates(pivotData, productCatalog);
  return (rows || []).map(row => {
    const saved = productMappings[chinaMappingKey(row.sourceItemName)];
    const savedProdKey = Number(saved?.prodKey || saved?.ProdKey || saved || 0);
    const product = savedProdKey ? products.find(item => Number(item.prodKey) === savedProdKey) : row.product;
    if (!product) return row;
    const customer = row.customer;
    return {
      ...row,
      product,
      mappingStatus: customer ? 'MATCHED' : 'CUSTOMER_UNMATCHED',
      cellKey: customer ? `${customer.custKey}:${product.prodKey}` : '',
    };
  });
}

function normalizeBoard(record) {
  if (!record) return null;
  return {
    boardKey: record.boardKey || record.BoardKey || record.key || record.Key || '',
    name: record.name || record.Name || record.boardName || record.BoardName || '',
    orderYear: Number(record.orderYear || record.OrderYear || 0),
    orderWeek: record.orderWeek || record.OrderWeek || '',
    packingRows: record.packingRows || record.PackingRows || [],
    cells: record.cells || record.Cells || {},
    matchOverrides: record.matchOverrides || record.MatchOverrides || {},
    reviewState: record.reviewState || record.ReviewState || {},
    sourceFileName: record.sourceFileName || record.SourceFileName || '',
    sourceSheetName: record.sourceSheetName || record.SourceSheetName || '',
    updatedAt: record.updatedAt || record.UpdateDtm || record.createDtm || '',
    rowVersion: record.rowVersion || record.RowVersionHex || record.rowVersionHex || '',
  };
}

function normalizeProductMappings(raw) {
  if (Array.isArray(raw)) return Object.fromEntries(raw.map(item => [chinaMappingKey(item.sourceItemName || item.SourceItemName), item]));
  return raw && typeof raw === 'object' ? raw : {};
}

function MatchingModal({ rows, products, customers, onClose, onMatch, onCustomerMatch }) {
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const unresolved = rows.filter(row => row.mappingStatus !== 'MATCHED');
  const target = unresolved[Math.min(selectedIndex, Math.max(0, unresolved.length - 1))];
  const candidates = products.filter(product => {
    const haystack = normalizeChinaText(`${product.flower || ''} ${product.displayName || ''} ${chinaVolumeProductLabel(product.prodName)}`);
    return !search.trim() || haystack.includes(normalizeChinaText(search));
  }).slice(0, 80);
  if (!target) return null;
  return (
    <div className="modal-shade" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section className="match-modal" role="dialog" aria-modal="true" aria-labelledby="china-match-title">
        <header><strong id="china-match-title">중국 품목 미매칭 처리</strong><button onClick={onClose}>×</button></header>
        <div className="match-source"><b>{target.sourceItemName}</b><span>패킹 수량 {fmt(target.quantity)} · Client No. {target.customerCode}</span><small>선택 후 중국전용 매칭값으로 저장됩니다. 다음 차수 업로드에도 재사용됩니다.</small></div>
        {unresolved.length > 1 && <div className="match-queue">{unresolved.map((row, index) => <button className={row === target ? 'active' : ''} key={`${row.sourceRow}-${index}`} onClick={() => setSelectedIndex(index)}>{index + 1}. {row.sourceItemName}</button>)}</div>}
        {target.mappingStatus === 'CUSTOMER_UNMATCHED' ? <>
          <label className="match-search">전산 업체 검색<input autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder="업체명 또는 Client No." /></label>
          <div className="match-products">
            {(customers || []).filter(customer => !search.trim() || normalizeChinaText(`${customer.custName} ${customer.orderCode}`)?.includes(normalizeChinaText(search))).slice(0, 80).map(customer => <button key={customer.custKey} onClick={() => onCustomerMatch(target, customer)}><b>{customer.orderCode || '코드없음'}</b><span>{customer.custName}</span><small>#{customer.custKey}</small></button>)}
          </div>
        </> : <>
          <label className="match-search">중국 품목 검색<input autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder="품종 또는 품목명" /></label>
          <div className="match-products">
            {candidates.map(product => <button key={product.prodKey} onClick={() => onMatch(target, product)}><b>{product.flower || '품종미상'}</b><span>{chinaVolumeProductLabel(product.prodName)}</span><small>#{product.prodKey}</small></button>)}
            {!candidates.length && <p>검색 결과가 없습니다.</p>}
          </div>
        </>}
        <footer><button onClick={onClose}>닫기</button></footer>
      </section>
    </div>
  );
}

function BoxBadges({ allocations = [], area = 'self' }) {
  const capacity = area === 'self' ? 4 : (area === 'left' || area === 'right' ? 10 : 8);
  const visible = allocations.slice(0, capacity);
  if (!allocations.length) return null;
  const title = allocations.map(item => `${item.boxNo}번 ${fmt(item.quantity)}`).join(' / ');
  return (
    <span className={`box-badges area-${area}`} title={title} aria-label={`박스 ${title}`}>
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
  const [workHistory, setWorkHistory] = useState([]);
  const [boardKey, setBoardKey] = useState('');
  const [boardName, setBoardName] = useState('');
  const [productMappings, setProductMappings] = useState({});
  const [productCatalog, setProductCatalog] = useState([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [matchOpen, setMatchOpen] = useState(false);
  const [reviewNotes, setReviewNotes] = useState({});
  const [sourceFileName, setSourceFileName] = useState('');
  const [sourceSheetName, setSourceSheetName] = useState('');
  const [expectedRowVersion, setExpectedRowVersion] = useState('');
  const [packingPhase, setPackingPhase] = useState('EMPTY');

  const applyBoard = (rawBoard, pivotData = data, mappings = productMappings, catalog = productCatalog) => {
    const board = normalizeBoard(rawBoard);
    if (!board) return;
    setBoardKey(board.boardKey);
    setBoardName(board.name || `${board.orderYear || year}년 ${board.orderWeek || week} 중국 물량표`);
    const hydratedRows = applySavedChinaMappings(board.packingRows, pivotData, { ...mappings, ...board.matchOverrides }, catalog);
    const nextPhase = board.reviewState?.packingPhase || (hydratedRows.length ? 'APPLIED' : 'EMPTY');
    setPackingRows(hydratedRows);
    setPackingPhase(nextPhase);
    setCells(nextPhase === 'APPLIED'
      ? restoreChinaPackingCells(board.cells || {}, hydratedRows, { ...pivotData, rows: mergeChinaProductCandidates(pivotData, catalog) })
      : (board.cells || {}));
    setReviewNotes(board.reviewState || {});
    setSourceFileName(board.sourceFileName || '');
    setSourceSheetName(board.sourceSheetName || '');
    setExpectedRowVersion(board.rowVersion || '');
    setDirty(false);
  };

  const loadBoardHistory = async (targetYear = year, targetWeek = week) => {
    const result = await apiGet('/api/stats/china-volume-board', { orderYear: targetYear, orderWeek: targetWeek });
    const boards = (result.boards || result.items || result.history || []).map(normalizeBoard);
    const mappings = normalizeProductMappings(result.productMappings || result.mappings || {});
    setWorkHistory(boards);
    setProductMappings(mappings);
    return { boards, mappings, active: normalizeBoard(result.activeBoard || result.board || boards[0]) };
  };

  const load = async () => {
    setLoading(true); setError('');
    try {
      const [result, history, catalogResult] = await Promise.all([
        apiGet('/api/stats/pivot-data', { orderYear: year, weekStart: week, weekEnd: week }),
        loadBoardHistory(year, week),
        apiGet('/api/stats/china-volume-products'),
      ]);
      const catalog = catalogResult.products || [];
      setProductCatalog(catalog);
      setData(result);
      if (history.active) applyBoard(history.active, result, history.mappings, catalog);
      else {
        setBoardKey(''); setBoardName(`${year}년 ${week} 중국 물량표`);
        setCells({}); setPackingRows([]); setSourceFileName(''); setSourceSheetName(''); setExpectedRowVersion(''); setPackingPhase('EMPTY'); setDirty(false);
      }
    } catch (e) { setError(e.message || '물량표 조회 실패'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const matchProducts = useMemo(() => mergeChinaProductCandidates(data, productCatalog), [data, productCatalog]);
  const chinaRows = useMemo(() => {
    const byKey = new Map((data?.rows || []).filter(row => /중국/i.test(String(row.country || ''))).map(row => [Number(row.prodKey), row]));
    packingRows.forEach(row => row.product?.prodKey && !byKey.has(Number(row.product.prodKey)) && byKey.set(Number(row.product.prodKey), { ...row.product, outOrders: {} }));
    return [...byKey.values()];
  }, [data, packingRows]);
  const customers = useMemo(() => {
    const used = new Set();
    chinaRows.forEach(row => Object.entries(row.outOrders || {}).forEach(([name, qty]) => Number(qty || 0) > 0 && used.add(name)));
    packingRows.forEach(row => row.customer?.custName && used.add(row.customer.custName));
    return (data?.customers || []).filter(customer => used.has(customer.custName));
  }, [data, chinaRows, packingRows]);
  const boxAreas = useMemo(() => planChinaBoxNeighborAreas({ rows: chinaRows, customers, cells }), [chinaRows, customers, cells]);
  const totals = useMemo(() => summarizeChinaVolumeTotals({ pivotData: { ...data, rows: chinaRows }, packingRows, cells }), [data, chinaRows, packingRows, cells]);

  const persistBoardSnapshot = async ({ nextRows, nextCells, nextFileName = sourceFileName, nextSheetName = sourceSheetName, nextPhase = packingPhase }) => {
    const name = boardName.trim() || `${year}년 ${week} 중국 물량표`;
    const saved = await apiPost('/api/stats/china-volume-board', {
      action: 'save', boardKey: boardKey || undefined, name, orderYear: year, orderWeek: week,
      packingRows: nextRows, cells: nextCells,
      matchOverrides: Object.fromEntries(nextRows.filter(row => row.product?.prodKey).map(row => [chinaMappingKey(row.sourceItemName), { prodKey: Number(row.product.prodKey), prodName: row.product.prodName }])),
      reviewState: { ...reviewNotes, packingPhase: nextPhase }, sourceFileName: nextFileName, sourceSheetName: nextSheetName,
      expectedRowVersion: expectedRowVersion || undefined,
    });
    const nextBoard = normalizeBoard(saved.board || saved.item || saved);
    if (nextBoard?.boardKey) setBoardKey(nextBoard.boardKey);
    setBoardName(nextBoard?.name || name);
    setExpectedRowVersion(nextBoard?.rowVersion || expectedRowVersion);
    setDirty(false);
    await loadBoardHistory(year, week);
    return nextBoard;
  };

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
      const candidateData = { ...data, rows: matchProducts };
      const matched = applySavedChinaMappings(matchChinaPackingRows(parseChinaPackingRows(aoa), candidateData), data, productMappings, productCatalog);
      setPackingRows(matched);
      setCells({});
      setPackingPhase('REVIEW');
      setSourceFileName(file.name);
      setSourceSheetName(workbook.SheetNames[0] || '');
      setDirty(true);
      await persistBoardSnapshot({ nextRows: matched, nextCells: {}, nextFileName: file.name, nextSheetName: workbook.SheetNames[0] || '', nextPhase: 'REVIEW' });
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
    setDirty(true);
    setDraft(null); setSelectedKey('');
  };

  const saveBoard = async () => {
    if (!data) return;
    setSaving(true); setError('');
    try {
      await persistBoardSnapshot({ nextRows: packingRows, nextCells: cells });
    } catch (e) {
      setError(['STALE_BOARD_VERSION', 'BOARD_VERSION_REQUIRED'].includes(e.code)
        ? '다른 사용자가 이 작업본을 변경했습니다. 현재 입력은 유지되지만 저장하지 않았습니다. [중국 물량표 조회]로 최신 작업본을 다시 확인하세요.'
        : `중국물량표 저장 실패: ${e.message || e}`);
    }
    finally { setSaving(false); }
  };

  const newBoard = () => {
    if (dirty && !window.confirm('저장하지 않은 작업이 있습니다. 새 작업으로 전환할까요?')) return;
    setBoardKey(''); setBoardName(`${year}년 ${week} 중국 물량표`); setPackingRows([]); setCells({}); setReviewNotes({}); setSourceFileName(''); setSourceSheetName(''); setExpectedRowVersion(''); setPackingPhase('EMPTY'); setDirty(false);
  };

  const deleteBoard = async () => {
    if (!boardKey) return;
    if (!window.confirm(`'${boardName}' 작업본과 업로드 입고원장 스냅샷을 삭제할까요? 전산 ERP 원장은 변경되지 않습니다.`)) return;
    setSaving(true); setError('');
    try {
      const query = new URLSearchParams({ boardKey: String(boardKey) });
      if (expectedRowVersion) query.set('expectedRowVersion', expectedRowVersion);
      await apiDelete(`/api/stats/china-volume-board?${query.toString()}`);
      const history = await loadBoardHistory(year, week);
      if (history.active) applyBoard(history.active, data, history.mappings);
      else { setBoardKey(''); setBoardName(`${year}년 ${week} 중국 물량표`); setPackingRows([]); setCells({}); setReviewNotes({}); setSourceFileName(''); setSourceSheetName(''); setExpectedRowVersion(''); setPackingPhase('EMPTY'); setDirty(false); }
    } catch (e) {
      setError(['STALE_BOARD_VERSION', 'BOARD_VERSION_REQUIRED'].includes(e.code)
        ? '다른 사용자가 이 작업본을 변경했습니다. 삭제하지 않았습니다. [중국 물량표 조회]로 최신 작업본을 다시 확인하세요.'
        : `작업본 삭제 실패: ${e.message || e}`);
    }
    finally { setSaving(false); }
  };

  const saveProductMatch = async (row, product) => {
    const sourceItemName = row.sourceItemName;
    try {
      await apiPost('/api/stats/china-volume-board', { action: 'save-mapping', sourceItemName, prodKey: Number(product.prodKey), prodName: product.prodName });
      const nextMappings = { ...productMappings, [chinaMappingKey(sourceItemName)]: { prodKey: Number(product.prodKey), prodName: product.prodName } };
      const nextRows = applySavedChinaMappings(packingRows, data, nextMappings, productCatalog);
      const automatic = mergeChinaPackingIntoPivotCells(nextRows, { ...data, rows: matchProducts });
      const nextCells = packingPhase === 'APPLIED' ? { ...cells, ...automatic } : cells;
      setProductMappings(nextMappings);
      setPackingRows(nextRows);
      setCells(nextCells);
      setDirty(true);
      await persistBoardSnapshot({ nextRows, nextCells, nextPhase: packingPhase });
    } catch (e) { setError(`중국 품목 매칭 저장 실패: ${e.message || e}`); }
  };

  const saveCustomerMatch = async (row, customer) => {
    try {
      const nextRows = applyChinaPackingCustomerMatch(packingRows, row.sourceRow, customer);
      setPackingRows(nextRows);
      setDirty(true);
      await persistBoardSnapshot({ nextRows, nextCells: cells, nextPhase: packingPhase });
    } catch (e) { setError(`중국 업체 매칭 저장 실패: ${e.message || e}`); }
  };

  const applyPackingMatches = async () => {
    const unresolved = packingRows.filter(row => row.mappingStatus !== 'MATCHED');
    if (!canApplyChinaPackingRows(packingRows)) {
      setError(`미매칭 ${unresolved.length}건을 먼저 수정하세요.`);
      if (unresolved.length) setMatchOpen(true);
      return;
    }
    setSaving(true); setError('');
    try {
      const nextCells = mergeChinaPackingIntoPivotCells(packingRows, { ...data, rows: matchProducts });
      setCells(nextCells);
      setPackingPhase('APPLIED');
      await persistBoardSnapshot({ nextRows: packingRows, nextCells, nextPhase: 'APPLIED' });
    } catch (e) { setError(`매칭 적용 저장 실패: ${e.message || e}`); }
    finally { setSaving(false); }
  };

  const openReconciliationReview = () => {
    const reviewKey = `china-volume-review:${Date.now()}`;
    sessionStorage.setItem(reviewKey, JSON.stringify({
      boardKey, year, week, boardName, mismatches: totals.mismatches,
      unmatched: packingRows.filter(row => row.mappingStatus !== 'MATCHED').map(row => ({ sourceRow: row.sourceRow, sourceItemName: row.sourceItemName, customerCode: row.customerCode, quantity: row.quantity, mappingStatus: row.mappingStatus })),
    }));
    const child = window.open(`/stats/china-volume-board-review?key=${encodeURIComponent(reviewKey)}&boardKey=${encodeURIComponent(boardKey || '')}`, 'china-volume-review', 'popup,width=1050,height=760,resizable=yes,scrollbars=yes');
    if (!child) setError('누락·초과 확인창이 차단되었습니다. 브라우저 팝업 허용 후 다시 누르세요.');
  };

  useEffect(() => {
    const onReviewMessage = event => {
      if (event.origin !== window.location.origin || event.data?.type !== 'CHINA_VOLUME_REVIEW_ACTION') return;
      const { action, cellKey, sourceRow } = event.data;
      if (action === 'OPEN_CELL' && cellKey) {
        const [custKey, prodKey] = String(cellKey).split(':').map(Number);
        const row = chinaRows.find(item => Number(item.prodKey) === prodKey);
        const customer = customers.find(item => Number(item.custKey) === custKey);
        if (row && customer) openCell(row, customer);
      }
      if (action === 'OPEN_MATCH') setMatchOpen(true);
      if (action === 'APPLY_PACKING' && cellKey) {
        setCells(previous => ({ ...previous, [cellKey]: { ...(previous[cellKey] || { allocations: [] }), quantity: Number(event.data.packingQuantity || 0) } }));
        setReviewNotes(previous => ({ ...previous, [cellKey]: 'apply matched packing quantity' }));
        setDirty(true);
      }
      if (action === 'KEEP_BOARD') { setReviewNotes(previous => ({ ...previous, [cellKey || `source-${sourceRow}`]: 'keep current board quantity' })); setDirty(true); }
      if (action === 'HOLD') { setReviewNotes(previous => ({ ...previous, [cellKey || `source-${sourceRow}`]: 'leave unresolved and save for later' })); setDirty(true); }
    };
    window.addEventListener('message', onReviewMessage);
    return () => window.removeEventListener('message', onReviewMessage);
  }, [chinaRows, customers]);

  const matchedCount = packingRows.filter(row => row.mappingStatus === 'MATCHED').length;

  const downloadExcel = () => {
    if (!data) return;
    if (packingRows.length && totals.status === 'WARNING' && !window.confirm(`수량 대조 경고가 ${totals.mismatches.length + totals.unmatchedRowCount}건 있습니다. 대조내역을 포함해 엑셀을 다운로드할까요?`)) return;
    const sheet = XLSXStyled.utils.aoa_to_sheet(buildChinaVolumeWorkbookRows({ year, week, rows: chinaRows, customers, cells }));
    sheet['!cols'] = [{ wch: 48 }, ...customers.map(() => ({ wch: 16 }))];
    sheet['!rows'] = [{ hpt: 26 }, { hpt: 20 }, ...chinaRows.map(() => ({ hpt: 24 }))];
    sheet['!autofilter'] = { ref: `A2:${XLSX.utils.encode_col(customers.length)}${chinaRows.length + 2}` };
    sheet['!freeze'] = { xSplit: 1, ySplit: 2 };
    const border = { top: { style: 'thin', color: { rgb: 'DDE2E8' } }, bottom: { style: 'thin', color: { rgb: 'DDE2E8' } }, left: { style: 'thin', color: { rgb: 'DDE2E8' } }, right: { style: 'thin', color: { rgb: 'DDE2E8' } } };
    for (let rowIndex = 0; rowIndex < chinaRows.length + 2; rowIndex += 1) {
      for (let colIndex = 0; colIndex <= customers.length; colIndex += 1) {
        const address = XLSXStyled.utils.encode_cell({ r: rowIndex, c: colIndex });
        if (!sheet[address]) continue;
        const isTitle = rowIndex === 0;
        const isHeader = rowIndex === 1;
        const isProduct = colIndex === 0;
        const hasBoxes = /\(/.test(String(sheet[address].v || ''));
        sheet[address].s = {
          border,
          alignment: { vertical: 'center', horizontal: isProduct ? 'left' : 'center', wrapText: true },
          font: { name: '맑은 고딕', sz: isTitle ? 13 : (isHeader ? 10 : (isProduct ? 10 : 14)), bold: isTitle || isHeader || !isProduct, color: { rgb: isTitle || isHeader ? 'FFFFFF' : (hasBoxes ? 'D31616' : (isProduct ? '172033' : '153B7A')) } },
          fill: { patternType: 'solid', fgColor: { rgb: isTitle ? '071780' : (isHeader ? '3A629E' : (isProduct ? 'F7F9FC' : (hasBoxes ? 'FFFAF9' : 'F8FBFF'))) } },
        };
      }
    }
    const workbook = XLSXStyled.utils.book_new();
    XLSXStyled.utils.book_append_sheet(workbook, sheet, '중국물량표');
    const reconciliationRows = [
      ['구분', '수량', '판정/설명'],
      ['피벗 출고 합계', totals.pivotTotal, '입고와 다를 수 있는 참고값'],
      ['현재 물량표 합계', totals.boardTotal, '수동 수정 반영'],
      ['업로드 입고원장 합계', totals.packingTotal, '원본 전체'],
      ['매칭 완료 합계', totals.matchedPackingTotal, '업체·품목 매칭 완료'],
      ['미매칭 합계', totals.unmatchedPackingTotal, totals.unmatchedRowCount ? '확인 필요' : '정상'],
      ['박스 배정 합계', totals.allocationTotal, '현재 셀 박스 배정'],
      ['물량표-박스배정 차이', totals.boardAllocationDifference, Math.abs(totals.boardAllocationDifference) < 0.001 ? '정상' : '확인 필요'],
      [],
      ['단위별 대조', '피벗 출고', '입고원장', '현재 물량표', '박스배정'],
      ...totals.unitTotals.map(item => [item.unit, item.pivot, item.packing, item.board, item.allocated]),
      [],
      ['업체', '품목', '패킹수량', '박스배정', '표시수량', '패킹-배정 차이', '표시-배정 차이'],
      ...totals.mismatches.map(item => [item.customerName, chinaVolumeProductLabel(item.productName), item.packingQuantity, item.allocatedQuantity, item.boardQuantity, item.allocationDifference, item.boardAllocationDifference]),
    ];
    const reconciliationSheet = XLSXStyled.utils.aoa_to_sheet(reconciliationRows);
    reconciliationSheet['!cols'] = [{ wch: 20 }, { wch: 46 }, ...Array.from({ length: 5 }, () => ({ wch: 18 }))];
    reconciliationSheet['!freeze'] = { ySplit: 1 };
    Object.keys(reconciliationSheet).filter(key => !key.startsWith('!')).forEach(address => {
      const rowIndex = XLSXStyled.utils.decode_cell(address).r;
      reconciliationSheet[address].s = {
        border,
        alignment: { vertical: 'center', horizontal: rowIndex === 0 || rowIndex === 9 || rowIndex === 12 ? 'center' : 'left', wrapText: true },
        font: { name: '맑은 고딕', sz: 10, bold: rowIndex === 0 || rowIndex === 9 || rowIndex === 12, color: { rgb: rowIndex === 0 || rowIndex === 9 || rowIndex === 12 ? 'FFFFFF' : '172033' } },
        fill: { patternType: 'solid', fgColor: { rgb: rowIndex === 0 || rowIndex === 9 || rowIndex === 12 ? '173B72' : (rowIndex % 2 ? 'F7F9FC' : 'FFFFFF') } },
      };
    });
    XLSXStyled.utils.book_append_sheet(workbook, reconciliationSheet, '수량대조');
    XLSXStyled.writeFile(workbook, `${year}_${week}_자동중국물량표.xlsx`, { compression: true });
  };

  return (
    <>
      <Head><title>자동 중국물량표 - nenova ERP</title></Head>
      <div className="page">
        <header className="titlebar"><b>자동 중국물량표</b><span>1920×1080 기준</span><button onClick={() => window.opener ? window.close() : router.push('/dashboard')}>닫기</button></header>
        <div className="toolbar">
          <label>연도<input type="number" value={year} onChange={e => setYear(Number(e.target.value))} /></label>
          <label className="week-field">차수<button type="button" aria-label="이전 차수" onClick={() => setWeek(value => stepChinaOrderWeek(value, -1))}>‹</button><input value={week} onChange={e => setWeek(e.target.value)} placeholder="35-01" /><button type="button" aria-label="다음 차수" onClick={() => setWeek(value => stepChinaOrderWeek(value, 1))}>›</button></label>
          <button className="load" onClick={load} disabled={loading}>{loading ? '조회 중…' : '중국 물량표 조회'}</button>
          <label className="board-name">작업명<input value={boardName} onChange={event => { setBoardName(event.target.value); setDirty(true); }} placeholder="예: CL 1차 배정" /></label>
          <select className="board-history" value={boardKey} onChange={event => {
            const next = workHistory.find(item => String(item.boardKey) === event.target.value);
            if (!next || (dirty && !window.confirm('저장하지 않은 변경사항이 있습니다. 저장본을 불러올까요?'))) return;
            applyBoard(next);
          }} title="같은 연도·차수의 저장 작업본">
            <option value="">새 작업본</option>
            {workHistory.map(item => <option key={item.boardKey} value={item.boardKey}>{item.name || '이름 없는 작업'} {item.updatedAt ? `· ${String(item.updatedAt).slice(0, 16)}` : ''}</option>)}
          </select>
          <button className="save-board" onClick={saveBoard} disabled={!data || saving}>{saving ? '저장 중…' : dirty ? '● 작업 저장' : '✓ 저장됨'}</button>
          <button onClick={newBoard} disabled={!data}>새 작업</button>
          <button className="delete-board" onClick={deleteBoard} disabled={!boardKey || saving}>삭제</button>
          <label className={`upload ${!data ? 'disabled' : ''}`}>패킹리스트 업로드<input type="file" accept=".xlsx,.xls" onChange={handleUpload} disabled={!data} /></label>
          <span className="source-file" title={sourceFileName || '적용된 패킹리스트 없음'}>{sourceFileName ? `적용: ${sourceFileName}` : '적용 파일 없음'}</span>
          <button className={totals.unmatchedRowCount ? 'attention' : ''} onClick={() => setMatchOpen(true)} disabled={!packingRows.some(row => row.mappingStatus !== 'MATCHED')}>미매칭 수정 {totals.unmatchedRowCount ? `${totals.unmatchedRowCount}건` : ''}</button>
          <button className={packingPhase === 'REVIEW' ? 'apply-matches' : ''} onClick={applyPackingMatches} disabled={!canApplyChinaPackingRows(packingRows) || packingPhase === 'APPLIED' || saving}>{packingPhase === 'APPLIED' ? '✓ 매칭 적용됨' : '매칭 적용'}</button>
          <button className={totals.status === 'WARNING' ? 'attention' : ''} onClick={openReconciliationReview} disabled={!packingRows.length}>누락·초과 확인</button>
          <button onClick={downloadExcel} disabled={!data || packingPhase === 'REVIEW'}>엑셀 다운로드</button>
          <span className="legend"><i>16</i> 빨간 번호는 패킹 박스 · 셀마다 클릭 수정</span>
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        {packingPhase === 'REVIEW' && <div className="matching-guide"><b>1. 전산 물량표 확인</b><span>2. 오른쪽 인보이스·매칭 결과 확인</span><span>3. 미매칭 수정</span><strong>4. 매칭 적용</strong></div>}
        {data && <section className={`reconcile ${packingRows.length ? totals.status.toLowerCase() : 'idle'}`} aria-label="총수량 대조">
          <b>{packingRows.length ? (totals.status === 'OK' ? '✓ 수량 대조 정상' : '⚠ 수량 대조 확인 필요') : '수량 대조 · 패킹리스트 업로드 대기'}</b>
          <span>피벗 출고 <strong>{fmtUnitTotals(totals.unitTotals, 'pivot')}</strong><small>참고</small></span>
          <span>입고원장 <strong>{fmtUnitTotals(totals.unitTotals, 'packing')}</strong></span>
          <span>매칭 <strong>{fmt(totals.matchedPackingTotal)}</strong></span>
          <span className={totals.unmatchedPackingTotal ? 'warn' : ''}>미매칭 <strong>{fmt(totals.unmatchedPackingTotal)}</strong><small>{totals.unmatchedRowCount}건</small></span>
          <span>박스배정 <strong>{fmtUnitTotals(totals.unitTotals, 'allocated')}</strong></span>
          <span className={Math.abs(totals.boardAllocationDifference) >= 0.001 ? 'warn' : ''}>표시-배정 <strong>{fmtUnitDifferences(totals.unitTotals)}</strong></span>
          <button className={totals.mismatches.length ? 'warn' : ''} onClick={openReconciliationReview}>불일치 <strong>{totals.mismatches.length}</strong><small>업체·품목 확인</small></button>
        </section>}
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
                      const orderQuantity = saved?.orderQuantity ?? originalQty;
                      const allocations = saved?.allocations || [];
                      return <td key={key} className={`${quantity > 0 ? 'active' : ''} ${allocations.length ? 'boxed' : ''}`} onClick={() => openCell(row, customer)}>
                        <span className="qty" title={`패킹 ${fmt(quantity)} · 전산 주문 ${fmt(orderQuantity)}`}>{quantity > 0 ? fmt(quantity) : ''}</span>{quantity !== orderQuantity && <small className="order-qty">주문 {fmt(orderQuantity)}</small>}<BoxBadges allocations={allocations} area={boxAreas[key] || 'self'} />
                      </td>;
                    })}
                  </tr>
                ))}</tbody>
              </table>
            )}
          </section>
          <aside>
            <div className="aside-title"><b>인보이스·매칭 대조</b><span>{packingRows.length ? `${matchedCount}/${packingRows.length}건 매칭` : '업로드 대기'}</span></div>
            <p>{sourceFileName ? <><b>{sourceFileName}</b>{sourceSheetName ? ` · ${sourceSheetName}` : ''}<br /></> : ''}Customer 코드는 거래처 Client No., Item Name은 중국 품목으로 자동 매칭합니다.</p>
            <div className="packing-list">
              {packingRows.map((row, index) => <article key={`${row.sourceRow}-${index}`} className={row.mappingStatus === 'MATCHED' ? 'matched' : 'unmatched'}>
                <header><b>{row.customerCode}</b><span>{row.sourceBoxText}</span></header>
                <strong>{row.sourceItemName}</strong><div>{fmt(row.quantity)} · {row.allocations.map(a => <i key={`${a.boxNo}-${a.quantity}`}>{a.boxNo}:{fmt(a.quantity)}</i>)}</div>
                <small>{row.mappingStatus === 'MATCHED' ? `전산 매칭: ${row.customer.custName} / ${row.product.prodName}` : <>{row.mappingStatus === 'CUSTOMER_UNMATCHED' ? '업체 매칭 필요' : '품목 매칭 필요'} <button className="inline-match" onClick={() => setMatchOpen(true)}>수정</button></>}</small>
              </article>)}
              {!packingRows.length && <div className="aside-empty">예: ROSE Diana 20단 / NO.16.17<br />→ 16번 10단 + 17번 10단</div>}
            </div>
          </aside>
        </main>
      </div>
      <CellEditor draft={draft} onChange={setDraft} onClose={() => setDraft(null)} onSave={saveCell} />
      {matchOpen && <MatchingModal rows={packingRows} products={matchProducts} customers={data?.customers || []} onClose={() => setMatchOpen(false)} onMatch={saveProductMatch} onCustomerMatch={saveCustomerMatch} />}
      <style jsx global>{`
        html,body,#__next{height:100%;margin:0} body{overflow:hidden;font-family:Arial,'맑은 고딕',sans-serif;background:#eef1f5;color:#172033}
        *{box-sizing:border-box} button,input,select{font:inherit}.page{height:100vh;display:flex;flex-direction:column}.titlebar{height:27px;flex:none;background:linear-gradient(90deg,#071780,#087bc2);color:#fff;display:flex;align-items:center;padding:0 8px;font-size:11px;gap:10px}.titlebar span{font-weight:400;opacity:.8}.titlebar button{margin-left:auto;color:#fff;background:transparent;border:1px solid #ffffff66;border-radius:3px;padding:2px 10px}.toolbar{min-height:40px;flex:none;display:flex;align-items:center;gap:4px;padding:4px 6px;background:#fff;border-bottom:1px solid #cdd5df;font-size:11px;white-space:nowrap;overflow-x:auto}.toolbar label:not(.upload){display:flex;align-items:center;gap:3px}.toolbar input,.toolbar select{height:25px;border:1px solid #aeb9c8;border-radius:3px;padding:2px 5px}.toolbar label:first-child input{width:58px}.toolbar label:nth-child(2) input{width:65px}.toolbar .board-name input{width:122px}.toolbar .board-history{width:170px}.toolbar button,.upload{height:25px;border:1px solid #9aa9bc;background:#fff;border-radius:3px;padding:3px 7px;cursor:pointer}.toolbar .load,.upload,.save-board{background:#155bd7;color:#fff;border-color:#155bd7;font-weight:700}.toolbar .delete-board{color:#a11b1b;border-color:#e1a5a5}.toolbar .attention{background:#fff0e8;border-color:#e98145;color:#ae3c10;font-weight:800}.upload input{display:none}.upload.disabled{opacity:.45;cursor:not-allowed}.legend{margin-left:auto;color:#677388}.legend i,.box-badge{font-style:normal;color:#d31616;border:1px solid #e32626;background:#fff6f6;border-radius:3px;font-weight:800}.legend i{padding:1px 4px}.error{flex:none;background:#fff0f0;color:#b00020;padding:4px 8px;font-size:11px;border-bottom:1px solid #efb5bd}main{display:grid;grid-template-columns:minmax(0,1fr) 292px;min-height:0;flex:1;gap:4px;padding:4px}.board-wrap,aside{background:#fff;border:1px solid #cbd3de;border-radius:4px;min-height:0;overflow:auto}.empty{padding:50px;text-align:center;color:#7c8797}.board{border-collapse:separate;border-spacing:0;font-size:10px;min-width:100%}.board th,.board td{border-right:1px solid #dde2e8;border-bottom:1px solid #dde2e8}.board thead th{position:sticky;top:0;z-index:4;background:#e8eef7;height:34px;min-width:76px;max-width:76px;padding:2px}.board thead small{display:block;color:#78869a;font-weight:400}.board .product-head,.board tbody th{position:sticky;left:0;z-index:5;min-width:260px;max-width:260px;background:#f7f9fc;text-align:left}.board tbody th{height:32px;padding:2px 5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.board tbody th small{display:inline;color:#6c7890;font-weight:400;margin-right:4px}.board td{position:relative;width:76px;min-width:76px;max-width:76px;height:32px;min-height:32px;text-align:center;cursor:pointer;background:#fff}.board td:hover{outline:2px solid #276fea;outline-offset:-2px}.board td.active{background:#f8fbff}.board td.boxed{background:#fffaf9}.qty{font-weight:800;color:#153b7a}.box-badges{position:absolute;right:2px;top:2px;display:flex;gap:2px;max-width:58px;overflow:hidden;pointer-events:none}.box-badge{font-size:9px;line-height:13px;height:15px;min-width:18px;padding:0 2px;white-space:nowrap}.box-badge.more{background:#e32626;color:#fff}.aside-title{position:sticky;top:0;z-index:2;background:#172b55;color:#fff;padding:6px 7px;display:flex;justify-content:space-between;font-size:11px}aside>p{font-size:10px;color:#667286;margin:5px 7px}.packing-list{padding:0 5px 6px}.packing-list article{padding:5px;margin-bottom:4px;border:1px solid #d7dde6;border-left:3px solid #239b56;border-radius:3px;font-size:10px}.packing-list article.unmatched{border-left-color:#e24b3b;background:#fff7f5}.packing-list article header{display:flex;justify-content:space-between;color:#56647a}.packing-list article strong{display:block;margin:2px 0}.packing-list article i{font-style:normal;color:#d31616;border:1px solid #ee9b9b;border-radius:3px;padding:1px 2px;margin-left:2px}.packing-list article small{display:block;margin-top:3px;color:#64748b}.aside-empty{text-align:center;color:#8894a5;padding:28px 8px;line-height:1.7}.modal-shade{position:fixed;inset:0;z-index:100;background:#08122688;display:flex;align-items:center;justify-content:center}.cell-modal,.match-modal{width:510px;max-height:85vh;background:#fff;border-radius:7px;box-shadow:0 15px 60px #0006;overflow:auto}.cell-modal>header,.match-modal>header{height:36px;background:#183b72;color:#fff;display:flex;align-items:center;padding:0 12px}.cell-modal>header button,.match-modal>header button{margin-left:auto;background:transparent;color:#fff;border:0;font-size:22px}.modal-meta{padding:10px 13px;border-bottom:1px solid #e1e6ec}.modal-meta span,.modal-meta small{display:block;margin-top:3px}.modal-meta small{color:#b42318}.qty-field{display:flex;align-items:center;justify-content:space-between;padding:10px 13px;font-weight:700}.qty-field input{width:150px}.cell-modal input{height:29px;border:1px solid #aeb9c8;border-radius:4px;padding:3px 6px}.alloc-title{display:flex;justify-content:space-between;padding:7px 13px;background:#f3f6fa;font-size:12px}.alloc-title span{color:#657187}.alloc-list{padding:8px 13px}.alloc-row{display:grid;grid-template-columns:1fr 1fr 52px;gap:7px;margin-bottom:6px;align-items:end}.alloc-row label{font-size:11px}.alloc-row input{display:block;width:100%;margin-top:2px}.remove{height:29px;border:1px solid #e1a5a5;background:#fff;color:#b42318;border-radius:4px}.add-box{margin:0 13px 8px;border:1px dashed #df5454;background:#fff8f8;color:#c51f1f;border-radius:4px;padding:5px 10px}.allocation-check{margin:2px 13px;padding:7px;border-radius:4px;font-size:12px;font-weight:700}.allocation-check.ok{background:#eaf8ef;color:#176b35}.allocation-check.bad{background:#fff0f0;color:#ad1622}.cell-modal footer,.match-modal footer{display:flex;justify-content:flex-end;gap:7px;padding:10px 13px;border-top:1px solid #e2e7ed}.cell-modal footer button,.match-modal footer button{padding:6px 17px;border:1px solid #aeb9c8;background:#fff;border-radius:4px}.cell-modal footer .primary{background:#155bd7;color:#fff;border-color:#155bd7}.cell-modal footer .primary:disabled{opacity:.45}
        .board .product-head,.board tbody th{min-width:260px;max-width:260px}.board tbody th{overflow:visible;text-overflow:clip}.board tbody th span{display:inline;white-space:nowrap}.qty{position:absolute;z-index:5;left:1px;width:31px;top:1px;text-align:center;font-size:15px;line-height:18px;font-weight:900;pointer-events:none}.order-qty{position:absolute;z-index:5;left:1px;bottom:0;width:31px;font-size:7px;line-height:9px;color:#6d7787;pointer-events:none;white-space:nowrap}.box-badges{z-index:3;left:auto;right:1px;top:1px;bottom:1px;width:42px;max-width:42px;display:flex;align-content:center;justify-content:flex-start;flex-wrap:wrap;gap:1px;overflow:hidden}.box-badges.area-right{width:118px;max-width:118px;right:-75px;background:#fffaf9aa;padding:1px}.box-badges.area-left{width:118px;max-width:118px;right:1px;background:#fffaf9aa;padding:1px}.box-badges.area-down{height:62px;bottom:-31px;background:#fffaf9aa;padding:1px}.box-badges.area-up{height:62px;top:-31px;background:#fffaf9aa;padding:1px}.box-badge{font-size:9px;line-height:12px;height:14px;padding:0 1px;min-width:0;box-shadow:0 0 0 1px #fff}.box-badge[data-digits="1"]{width:15px}.box-badge[data-digits="2"]{width:19px}.box-badge[data-digits="3"]{width:24px}
        .reconcile{height:36px;flex:none;display:flex;align-items:center;gap:4px;padding:3px 6px;background:#eef8f1;border-bottom:1px solid #a9d9b8;font-size:10px;overflow-x:auto;white-space:nowrap}.reconcile>b{min-width:125px;color:#176b35}.reconcile>span,.reconcile>button{display:flex;align-items:baseline;gap:3px;min-width:90px;padding:3px 5px;background:#fff;border:1px solid #cbd8ce;border-radius:3px;font:inherit;text-align:left}.reconcile strong{font-size:13px;color:#183b72}.reconcile small{color:#78869a}.reconcile.warning{background:#fff6e8;border-color:#efbd68}.reconcile.warning>b,.reconcile .warn,.reconcile .warn strong{color:#b42318}.reconcile.idle{background:#f4f6f8;border-color:#d6dce4}
        .match-modal{width:690px}.match-source{padding:10px 13px;border-bottom:1px solid #e1e6ec}.match-source b,.match-source span,.match-source small{display:block}.match-source span{margin-top:3px}.match-source small{color:#657187;margin-top:5px}.match-queue{padding:7px 10px;background:#f3f6fa;display:flex;gap:4px;overflow:auto}.match-queue button{border:1px solid #bac6d7;background:#fff;border-radius:3px;padding:3px 6px;white-space:nowrap;font-size:11px}.match-queue button.active{background:#173b72;color:#fff;border-color:#173b72}.match-search{display:block;padding:9px 12px;font-size:11px;font-weight:700}.match-search input{display:block;width:100%;height:30px;margin-top:4px;border:1px solid #aeb9c8;border-radius:4px;padding:4px 7px}.match-products{display:grid;grid-template-columns:1fr 1fr;gap:5px;padding:0 12px 12px;max-height:48vh;overflow:auto}.match-products button{border:1px solid #d5dce6;background:#fff;text-align:left;border-radius:4px;padding:6px;cursor:pointer}.match-products button:hover{border-color:#155bd7;background:#f4f8ff}.match-products b,.match-products span,.match-products small{display:block}.match-products b{font-size:10px;color:#617087}.match-products span{font-size:12px;font-weight:700;margin-top:2px}.match-products small{font-size:10px;color:#7b8798;margin-top:3px}
        .week-field button{width:24px;padding:0!important;font-size:18px;font-weight:900}.source-file{display:inline-block;max-width:180px;overflow:hidden;text-overflow:ellipsis;color:#36547c;vertical-align:middle}.toolbar .apply-matches{background:#168447;color:#fff;border-color:#168447;font-weight:900}.matching-guide{height:31px;flex:none;display:flex;align-items:center;gap:18px;padding:4px 8px;background:#fff7db;border-bottom:1px solid #e6bf55;font-size:11px}.matching-guide b{color:#173b72}.matching-guide strong{color:#087b3d}.inline-match{margin-left:4px;border:1px solid #dd6b55;background:#fff;color:#b42318;border-radius:3px;font-size:10px;padding:1px 5px;cursor:pointer}
        @media(max-width:1200px){main{grid-template-columns:minmax(0,1fr) 320px}.legend{display:none}}
        @media print{.titlebar,.toolbar,aside,.error{display:none!important}body{overflow:visible}.page,main{height:auto;display:block;padding:0}.board-wrap{border:0;overflow:visible}.board thead th,.board tbody th{position:static}.box-badge{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
      `}</style>
    </>
  );
}
