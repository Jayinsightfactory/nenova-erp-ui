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
  chinaPackingDistributions,
  chinaVolumeProductLabel,
  matchChinaPackingRows,
  mergeChinaPackingIntoPivotCells,
  normalizeChinaText,
  parseChinaPackingRows,
  planChinaBoxNeighborAreas,
  restoreChinaPackingCells,
  rematchChinaPackingRow,
  setChinaPackingRowDistributions,
  summarizeChinaVolumeTotals,
  validateChinaCellAllocation,
  validateChinaPackingDistribution,
} from '../../lib/chinaVolumeBoard';
import { extractDays, pickDataDay } from '../../lib/pivotVolumeCustDays';

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

function MatchingModal({ rows, products, customers, targetSourceRow, onClose, onSave }) {
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const explicitTarget = targetSourceRow == null ? null : rows.find(row => Number(row.sourceRow) === Number(targetSourceRow));
  const unresolved = rows.filter(row => row.mappingStatus !== 'MATCHED');
  const target = explicitTarget || unresolved[Math.min(selectedIndex, Math.max(0, unresolved.length - 1))];
  const [customerKey, setCustomerKey] = useState(() => String(target?.customer?.custKey || ''));
  const [productKey, setProductKey] = useState(() => String(target?.product?.prodKey || ''));
  useEffect(() => {
    setCustomerKey(String(target?.customer?.custKey || ''));
    setProductKey(String(target?.product?.prodKey || ''));
    setSearch('');
  }, [target?.sourceRow]);
  const candidates = products.filter(product => {
    const haystack = normalizeChinaText(`${product.flower || ''} ${product.displayName || ''} ${chinaVolumeProductLabel(product.prodName)}`);
    return !search.trim() || haystack.includes(normalizeChinaText(search));
  }).slice(0, 80);
  if (!target) return null;
  const selectedCustomer = customers.find(customer => Number(customer.custKey) === Number(customerKey));
  const selectedProduct = products.find(product => Number(product.prodKey) === Number(productKey));
  return (
    <div className="modal-shade" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section className="match-modal" role="dialog" aria-modal="true" aria-labelledby="china-match-title">
        <header><strong id="china-match-title">업체·품목 매칭 수정</strong><button onClick={onClose}>×</button></header>
        <div className="match-source"><b>{target.sourceItemName}</b><span>패킹 수량 {fmt(target.quantity)} · Client No. {target.customerCode}</span><small>선택 후 중국전용 매칭값으로 저장됩니다. 다음 차수 업로드에도 재사용됩니다.</small></div>
        {!explicitTarget && unresolved.length > 1 && <div className="match-queue">{unresolved.map((row, index) => <button className={row === target ? 'active' : ''} key={`${row.sourceRow}-${index}`} onClick={() => setSelectedIndex(index)}>{index + 1}. {row.sourceItemName}</button>)}</div>}
        <div className="rematch-fields">
          <label>전산 업체<select value={customerKey} onChange={event => setCustomerKey(event.target.value)}><option value="">업체를 선택하세요</option>{customers.map(customer => <option value={customer.custKey} key={customer.custKey}>{customer.orderCode || '코드없음'} · {customer.custName}</option>)}</select></label>
          <label>전산 품목<select value={productKey} onChange={event => setProductKey(event.target.value)}><option value="">품목을 선택하세요</option>{products.map(product => <option value={product.prodKey} key={product.prodKey}>{product.flower || '품종미상'} · {chinaVolumeProductLabel(product.prodName)}</option>)}</select></label>
        </div>
        <label className="match-search">중국 품목 빠른 검색<input autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder="품종 또는 품목명" /></label>
          <div className="match-products">
            {candidates.map(product => <button className={Number(productKey) === Number(product.prodKey) ? 'active' : ''} key={product.prodKey} onClick={() => setProductKey(String(product.prodKey))}><b>{product.flower || '품종미상'}</b><span>{chinaVolumeProductLabel(product.prodName)}</span><small>#{product.prodKey}</small></button>)}
            {!candidates.length && <p>검색 결과가 없습니다.</p>}
          </div>
        <footer><button onClick={onClose}>닫기</button><button className="primary" disabled={!selectedCustomer || !selectedProduct} onClick={() => onSave(target, selectedCustomer, selectedProduct)}>매칭 저장 후 박스 분배</button></footer>
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

function PackingDistributionModal({ draft, customers, products, onChange, onClose, onSave }) {
  if (!draft) return null;
  const check = validateChinaPackingDistribution(draft);
  const update = (index, patch) => onChange({ ...draft, distributions: draft.distributions.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) });
  const customerOptions = (customers || []).filter(customer => Number(customer.custKey));
  const productOptions = (products || []).filter(product => Number(product.prodKey));
  return <div className="modal-shade" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="distribution-modal" role="dialog" aria-modal="true" aria-labelledby="distribution-title">
      <header><strong id="distribution-title">인보이스 박스 직접 분배</strong><button onClick={onClose}>×</button></header>
      <div className="distribution-source"><b>{draft.customerCode} · {draft.sourceItemName}</b><span>박스 {draft.sourceBoxText || draft.boxNumbers?.join(', ') || '-'} · 인보이스 수량 {fmt(draft.quantity)}</span><small>전산 원장은 변경하지 않으며 이 중국물량표 작업본에만 저장됩니다.</small></div>
      <div className="distribution-head"><b>분배 대상과 수량</b><span>한 박스를 여러 업체·품목으로 나눌 수 있습니다.</span></div>
      <div className="distribution-list">
        {draft.distributions.map((item, index) => {
          const [custKey = '', prodKey = ''] = String(item.cellKey || '').split(':');
          const selectedCustomer = customerOptions.find(customer => String(customer.custKey) === String(custKey));
          const orderedProducts = [...productOptions].sort((left, right) => Number(right.outOrders?.[selectedCustomer?.custName] || 0) - Number(left.outOrders?.[selectedCustomer?.custName] || 0));
          return <div className="distribution-row" key={index}>
            <label>전산 업체<select value={custKey} onChange={event => update(index, { cellKey: `${event.target.value}:${prodKey}` })}><option value="">업체 선택</option>{customerOptions.map(customer => <option key={customer.custKey} value={customer.custKey}>{customer.custName} · {customer.orderCode || '코드없음'}</option>)}</select></label>
            <label>전산 품목<select value={prodKey} onChange={event => update(index, { cellKey: `${custKey}:${event.target.value}` })}><option value="">품목 선택</option>{orderedProducts.map(product => { const orderQuantity = Number(product.outOrders?.[selectedCustomer?.custName] || 0); return <option key={product.prodKey} value={product.prodKey}>{chinaVolumeProductLabel(product.prodName)} · 주문 {fmt(orderQuantity)}</option>; })}</select></label>
            <label>분배수량<input type="number" min="0.001" step="0.001" value={item.quantity} onChange={event => update(index, { quantity: Number(event.target.value) })} /></label>
            <button className="remove" onClick={() => onChange({ ...draft, distributions: draft.distributions.filter((_, itemIndex) => itemIndex !== index) })}>삭제</button>
          </div>;
        })}
      </div>
      <button className="add-distribution" onClick={() => onChange({ ...draft, distributions: [...draft.distributions, { cellKey: draft.cellKey || '', quantity: Math.max(0, check.remainingQuantity) }] })}>+ 분배 대상 추가</button>
      <div className={`distribution-check ${check.valid ? 'ok' : 'bad'}`}><span>인보이스 <b>{fmt(check.sourceQuantity)}</b></span><span>분배 <b>{fmt(check.distributedQuantity)}</b></span><span>남은 수량 <b>{fmt(check.remainingQuantity)}</b></span><strong>{check.valid ? '✓ 전량 분배됨' : check.remainingQuantity < 0 ? '분배수량이 인보이스를 초과했습니다.' : '남은 수량을 모두 분배하세요.'}</strong></div>
      <footer><button onClick={onClose}>취소</button><button className="primary" disabled={!check.valid} onClick={onSave}>분배 저장</button></footer>
    </section>
  </div>;
}

function InlineReviewPanel({ open, phase, totals, packingRows, onClose, onMatch, onDistribution }) {
  const [filter, setFilter] = useState('all');
  if (!open) return null;
  const unmatched = packingRows.filter(row => row.mappingStatus !== 'MATCHED');
  const differences = (phase === 'REVIEW' ? totals.invoiceMismatches : totals.mismatches)
    .filter(item => filter === 'all' || (filter === 'shortage' ? Number(item.invoiceDifference || 0) < -0.001 : Number(item.invoiceDifference || 0) > 0.001));
  const sourceRows = cellKey => {
    const exact = packingRows.filter(row => row.mappingStatus === 'MATCHED' && chinaPackingDistributions(row).some(item => String(item.cellKey) === String(cellKey)));
    if (exact.length) return exact;
    const productKey = String(cellKey || '').split(':')[1];
    return packingRows.filter(row => row.mappingStatus === 'MATCHED' && chinaPackingDistributions(row).some(item => String(item.cellKey || '').split(':')[1] === productKey));
  };
  return <section className="inline-review" aria-label="매칭 품목 현황">
    <header><div><b>매칭 품목 현황 확인·변경</b><span>전산 주문수량과 인보이스 수량, 인보이스 원본과 DB 품목을 한 화면에서 확인합니다.</span></div><button onClick={onClose}>×</button></header>
    <div className="review-tabs"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>전체 {differences.length + unmatched.length}</button><button className={filter === 'shortage' ? 'active' : ''} onClick={() => setFilter('shortage')}>부족</button><button className={filter === 'excess' ? 'active' : ''} onClick={() => setFilter('excess')}>초과</button></div>
    <div className="review-scroll">
      {unmatched.length > 0 && <div className="review-block"><h3>미매칭 인보이스·품목</h3>{unmatched.map(row => <article className="review-row bad" key={`u-${row.sourceRow}`}><div><small>인보이스 품목</small><b>{row.sourceItemName}</b><span>{row.customerCode} · 박스 {row.sourceBoxText || '-'} · 수량 {fmt(row.quantity)}</span></div><div><small>DB 품목</small><b>매칭 필요</b><span>{row.mappingStatus === 'CUSTOMER_UNMATCHED' ? '업체 미매칭' : '품목 미매칭'}</span></div><button onClick={() => onMatch(row.sourceRow)}>매칭 변경</button></article>)}</div>}
      <div className="review-block"><h3>전산 주문 대비 인보이스 수량</h3>{differences.map(item => { const diff = Number(item.invoiceDifference || 0); const related = sourceRows(item.cellKey); return <article className="review-row bad" key={item.cellKey}><div><small>업체 · DB 품목</small><b>{item.customerName} · {chinaVolumeProductLabel(item.productName)}</b><span>전산 주문 {fmt(item.pivotQuantity)}</span></div><div><small>인보이스 수량</small><b>{fmt(item.packingQuantity)} · {diff < 0 ? `${fmt(Math.abs(diff))} 부족` : `${fmt(diff)} 초과`}</b><span>{related.map(row => `${row.sourceItemName} [${row.sourceBoxText || '-'}]`).join(' · ') || '관련 인보이스 없음'}</span></div><div className="review-actions">{related.map(row => <span key={row.sourceRow}><button onClick={() => onMatch(row.sourceRow)}>매칭</button><button className="primary" onClick={() => onDistribution(row.sourceRow)}>박스 분할·배분</button></span>)}</div></article>; })}
      {!differences.length && !unmatched.length && <div className="review-complete">✓ 모든 인보이스 품목과 물량표 기준 수량이 일치합니다.</div>}</div>
      {packingRows.filter(row => row.mappingStatus === 'MATCHED').map(row => { const check = validateChinaPackingDistribution(row); const orderQty = totals.invoiceMismatches.find(item => chinaPackingDistributions(row).some(dist => dist.cellKey === item.cellKey)); return <article className={`review-row ${check.valid && !orderQty ? 'good' : 'bad'}`} key={`p-${row.sourceRow}`}><div><small>인보이스 품목</small><b>{row.sourceItemName}</b><span>{row.customerCode} · 박스 {row.sourceBoxText || '-'}</span></div><div><small>DB 매칭 품목</small><b>{chinaVolumeProductLabel(row.product?.prodName)}</b><span>{row.customer?.custName} · 분배 {fmt(check.distributedQuantity)}/{fmt(check.sourceQuantity)}</span></div><div className="review-actions"><button onClick={() => onMatch(row.sourceRow)}>매칭 변경</button><button className="primary" onClick={() => onDistribution(row.sourceRow)}>박스 분할·배분</button></div></article>; })}
    </div>
  </section>;
}

export default function ChinaVolumeBoard() {
  const router = useRouter();
  const [year, setYear] = useState(currentYear);
  const [week, setWeek] = useState(DEFAULT_WEEK);
  const [availableWeeks, setAvailableWeeks] = useState([]);
  const [weeksLoading, setWeeksLoading] = useState(false);
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
  const [matchingSourceRow, setMatchingSourceRow] = useState(null);
  const [reviewNotes, setReviewNotes] = useState({});
  const [sourceFileName, setSourceFileName] = useState('');
  const [sourceSheetName, setSourceSheetName] = useState('');
  const [expectedRowVersion, setExpectedRowVersion] = useState('');
  const [packingPhase, setPackingPhase] = useState('EMPTY');
  const [distributionDraft, setDistributionDraft] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(false);

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

  const load = async (targetYear = year, targetWeek = week) => {
    setLoading(true); setError('');
    try {
      const [result, history, catalogResult] = await Promise.all([
        apiGet('/api/stats/pivot-data', { orderYear: targetYear, weekStart: targetWeek, weekEnd: targetWeek }),
        loadBoardHistory(targetYear, targetWeek),
        apiGet('/api/stats/china-volume-products'),
      ]);
      const catalog = catalogResult.products || [];
      setProductCatalog(catalog);
      setData(result);
      if (history.active) applyBoard(history.active, result, history.mappings, catalog);
      else {
        setBoardKey(''); setBoardName(`${targetYear}년 ${targetWeek} 중국 물량표`);
        setCells({}); setPackingRows([]); setSourceFileName(''); setSourceSheetName(''); setExpectedRowVersion(''); setPackingPhase('EMPTY'); setDirty(false);
      }
    } catch (e) { setError(e.message || '물량표 조회 실패'); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    let active = true;
    const loadRecordedWeeks = async () => {
      setWeeksLoading(true);
      setError('');
      try {
        const result = await apiGet('/api/stats/pivot-weeks', { orderYear: year, source: 'orders' });
        if (!active) return;
        const recordedWeeks = Array.isArray(result.weeks) ? result.weeks : [];
        setAvailableWeeks(recordedWeeks);
        if (!recordedWeeks.length) {
          setData(null);
          setPackingRows([]);
          setCells({});
          setError(`${year}년 주문 입력 차수가 없습니다.`);
          return;
        }
        const targetWeek = recordedWeeks.includes(week) ? week : recordedWeeks[0];
        setWeek(targetWeek);
        await load(year, targetWeek);
      } catch (e) {
        if (active) setError(e.message || '입력 차수 조회 실패');
      } finally {
        if (active) setWeeksLoading(false);
      }
    };
    loadRecordedWeeks();
    return () => { active = false; };
  }, [year]);

  const stepWeek = delta => {
    if (!availableWeeks.length) return;
    const currentIndex = availableWeeks.indexOf(week);
    const baseIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = Math.max(0, Math.min(availableWeeks.length - 1, baseIndex - delta));
    setWeek(availableWeeks[nextIndex]);
  };

  const matchProducts = useMemo(() => mergeChinaProductCandidates(data, productCatalog), [data, productCatalog]);
  const chinaRows = useMemo(() => {
    const byKey = new Map((data?.rows || []).filter(row => /중국/i.test(String(row.country || ''))).map(row => [Number(row.prodKey), row]));
    packingRows.forEach(row => row.product?.prodKey && !byKey.has(Number(row.product.prodKey)) && byKey.set(Number(row.product.prodKey), { ...row.product, outOrders: {} }));
    packingRows.flatMap(chinaPackingDistributions).forEach(distribution => {
      const prodKey = Number(String(distribution.cellKey || '').split(':')[1]);
      const product = productCatalog.find(item => Number(item.prodKey) === prodKey);
      if (product && !byKey.has(prodKey)) byKey.set(prodKey, { ...product, outOrders: {} });
    });
    return [...byKey.values()];
  }, [data, packingRows, productCatalog]);
  const customers = useMemo(() => {
    const used = new Set();
    chinaRows.forEach(row => Object.entries(row.outOrders || {}).forEach(([name, qty]) => Number(qty || 0) > 0 && used.add(name)));
    packingRows.forEach(row => row.customer?.custName && used.add(row.customer.custName));
    packingRows.flatMap(chinaPackingDistributions).forEach(distribution => {
      const custKey = Number(String(distribution.cellKey || '').split(':')[0]);
      const customer = (data?.customers || []).find(item => Number(item.custKey) === custKey);
      if (customer) used.add(customer.custName);
    });
    return (data?.customers || []).filter(customer => used.has(customer.custName));
  }, [data, chinaRows, packingRows]);
  const boxAreas = useMemo(() => planChinaBoxNeighborAreas({ rows: chinaRows, customers, cells }), [chinaRows, customers, cells]);
  const totals = useMemo(() => summarizeChinaVolumeTotals({ pivotData: { ...data, rows: chinaRows }, packingRows, cells }), [data, chinaRows, packingRows, cells]);
  const customerDays = useMemo(() => Object.fromEntries(customers.map(customer => [customer.custKey, pickDataDay(extractDays(customer, '중국'))])), [customers]);

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

  const openPackingDistribution = sourceRow => {
    const row = packingRows.find(item => Number(item.sourceRow) === Number(sourceRow));
    if (!row || row.mappingStatus !== 'MATCHED') {
      setError('업체·품목 미매칭을 먼저 수정한 뒤 박스를 분배하세요.');
      setMatchOpen(true);
      return;
    }
    setDistributionDraft({ ...row, distributions: chinaPackingDistributions(row).map(item => ({ ...item })) });
  };

  const savePackingDistribution = async () => {
    const check = validateChinaPackingDistribution(distributionDraft);
    if (!check.valid) { setError('인보이스 원본수량과 분배수량 합계가 같아야 저장할 수 있습니다.'); return; }
    setSaving(true); setError('');
    try {
      const nextRows = setChinaPackingRowDistributions(packingRows, distributionDraft.sourceRow, distributionDraft.distributions);
      const nextCells = packingPhase === 'APPLIED' ? mergeChinaPackingIntoPivotCells(nextRows, { ...data, rows: matchProducts }) : cells;
      setPackingRows(nextRows);
      setCells(nextCells);
      setDistributionDraft(null);
      setDirty(true);
      await persistBoardSnapshot({ nextRows, nextCells, nextPhase: packingPhase });
    } catch (e) { setError(`박스 분배 저장 실패: ${e.message || e}`); }
    finally { setSaving(false); }
  };

  const saveCustomerMatch = async (row, customer) => {
    try {
      const nextRows = applyChinaPackingCustomerMatch(packingRows, row.sourceRow, customer);
      setPackingRows(nextRows);
      setDirty(true);
      await persistBoardSnapshot({ nextRows, nextCells: cells, nextPhase: packingPhase });
    } catch (e) { setError(`중국 업체 매칭 저장 실패: ${e.message || e}`); }
  };

  const openPackingMatch = sourceRow => {
    setMatchingSourceRow(sourceRow == null ? null : Number(sourceRow));
    setMatchOpen(true);
  };

  const saveFullMatch = async (row, customer, product) => {
    const previousDistributions = chinaPackingDistributions(row);
    const nextCellKey = `${customer.custKey}:${product.prodKey}`;
    const changesExistingDistribution = previousDistributions.length > 1 || previousDistributions.some(item => item.cellKey !== nextCellKey);
    if (changesExistingDistribution && !window.confirm('기존 박스 분배를 새 업체·품목 기준으로 초기화하고 다시 분배할까요? 인보이스 원본수량과 박스번호는 유지됩니다.')) return;
    setSaving(true); setError('');
    try {
      await apiPost('/api/stats/china-volume-board', { action: 'save-mapping', sourceItemName: row.sourceItemName, prodKey: Number(product.prodKey), prodName: product.prodName });
      const nextMappings = { ...productMappings, [chinaMappingKey(row.sourceItemName)]: { prodKey: Number(product.prodKey), prodName: product.prodName } };
      const nextRows = rematchChinaPackingRow(packingRows, row.sourceRow, customer, product);
      const nextCells = packingPhase === 'APPLIED' ? mergeChinaPackingIntoPivotCells(nextRows, { ...data, rows: matchProducts }) : cells;
      const nextRow = nextRows.find(item => Number(item.sourceRow) === Number(row.sourceRow));
      setProductMappings(nextMappings);
      setPackingRows(nextRows);
      setCells(nextCells);
      setMatchOpen(false);
      setMatchingSourceRow(null);
      setDistributionDraft({ ...nextRow, distributions: chinaPackingDistributions(nextRow).map(item => ({ ...item })) });
      setDirty(true);
      await persistBoardSnapshot({ nextRows, nextCells, nextPhase: packingPhase });
    } catch (e) { setError(`업체·품목 매칭 저장 실패: ${e.message || e}`); }
    finally { setSaving(false); }
  };

  const applyPackingMatches = async () => {
    const unresolved = packingRows.filter(row => row.mappingStatus !== 'MATCHED');
    const distributionErrors = packingRows.filter(row => row.mappingStatus === 'MATCHED' && !validateChinaPackingDistribution(row).valid);
    if (!canApplyChinaPackingRows(packingRows)) {
      setError(unresolved.length ? `미매칭 ${unresolved.length}건을 먼저 수정하세요.` : `박스 분배가 완료되지 않은 인보이스 ${distributionErrors.length}건을 먼저 확인하세요.`);
      if (unresolved.length) setMatchOpen(true);
      else if (distributionErrors.length) openPackingDistribution(distributionErrors[0].sourceRow);
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
    setReviewOpen(true);
  };

  const matchedCount = packingRows.filter(row => row.mappingStatus === 'MATCHED').length;

  const downloadExcel = () => {
    if (!data) return;
    if (packingPhase !== 'APPLIED') { setError('매칭·박스 배분을 저장하고 [매칭 적용]을 완료한 뒤 엑셀을 다운로드하세요.'); return; }
    if (packingRows.length && totals.status === 'WARNING' && !window.confirm(`수량 대조 경고가 ${totals.mismatches.length + totals.unmatchedRowCount}건 있습니다. 대조내역을 포함해 엑셀을 다운로드할까요?`)) return;
    const appliedCustomers = customers.filter(customer => chinaRows.some(row => Number(cells[`${customer.custKey}:${row.prodKey}`]?.quantity || 0) > 0));
    const appliedRows = chinaRows.filter(row => appliedCustomers.some(customer => Number(cells[`${customer.custKey}:${row.prodKey}`]?.quantity || 0) > 0));
    const sheet = XLSXStyled.utils.aoa_to_sheet(buildChinaVolumeWorkbookRows({ year, week, rows: appliedRows, customers: appliedCustomers, cells, appliedOnly: true, customerDays }));
    sheet['!cols'] = [{ wch: 48 }, ...appliedCustomers.map(() => ({ wch: 16 }))];
    sheet['!rows'] = [{ hpt: 26 }, { hpt: 20 }, { hpt: 34 }, ...appliedRows.map(() => ({ hpt: 24 }))];
    sheet['!autofilter'] = { ref: `A3:${XLSX.utils.encode_col(appliedCustomers.length)}${appliedRows.length + 3}` };
    sheet['!freeze'] = { xSplit: 1, ySplit: 3 };
    const border = { top: { style: 'thin', color: { rgb: 'DDE2E8' } }, bottom: { style: 'thin', color: { rgb: 'DDE2E8' } }, left: { style: 'thin', color: { rgb: 'DDE2E8' } }, right: { style: 'thin', color: { rgb: 'DDE2E8' } } };
    for (let rowIndex = 0; rowIndex < appliedRows.length + 3; rowIndex += 1) {
      for (let colIndex = 0; colIndex <= appliedCustomers.length; colIndex += 1) {
        const address = XLSXStyled.utils.encode_cell({ r: rowIndex, c: colIndex });
        if (!sheet[address]) continue;
        const isTitle = rowIndex === 0;
        const isHeader = rowIndex === 1 || rowIndex === 2;
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
          <label className="week-field">DB 입력 차수<button type="button" aria-label="이전 입력 차수" onClick={() => stepWeek(-1)} disabled={weeksLoading || availableWeeks.indexOf(week) >= availableWeeks.length - 1}>‹</button><select aria-label="차수" value={week} onChange={e => setWeek(e.target.value)} disabled={weeksLoading || !availableWeeks.length}>{availableWeeks.map(item => <option key={item} value={item}>{item}</option>)}</select><button type="button" aria-label="다음 입력 차수" onClick={() => stepWeek(1)} disabled={weeksLoading || availableWeeks.indexOf(week) <= 0}>›</button></label>
          <button className="load" onClick={() => load(year, week)} disabled={loading || weeksLoading || !availableWeeks.length}>{loading || weeksLoading ? '조회 중…' : '중국 물량표 조회'}</button>
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
          <button className={totals.unmatchedRowCount ? 'attention' : ''} onClick={() => openPackingMatch(null)} disabled={!packingRows.some(row => row.mappingStatus !== 'MATCHED')}>미매칭 수정 {totals.unmatchedRowCount ? `${totals.unmatchedRowCount}건` : ''}</button>
          <button className={packingPhase === 'REVIEW' ? 'apply-matches' : ''} onClick={applyPackingMatches} disabled={!canApplyChinaPackingRows(packingRows) || packingPhase === 'APPLIED' || saving}>{packingPhase === 'APPLIED' ? '✓ 매칭 적용됨' : '매칭 적용'}</button>
          <button className={(packingPhase === 'REVIEW' ? totals.invoiceMismatches.length || totals.unmatchedRowCount : totals.status === 'WARNING') ? 'attention' : ''} onClick={openReconciliationReview} disabled={!packingRows.length}>{packingPhase === 'REVIEW' ? `주문↔인보이스 확인 ${totals.invoiceMismatches.length ? `${totals.invoiceMismatches.length}건` : ''}` : '적용 결과 확인'}</button>
          <button onClick={downloadExcel} disabled={!data || packingPhase === 'REVIEW'}>엑셀 다운로드</button>
          <span className="legend"><i>16</i> 빨간 번호는 패킹 박스 · 셀마다 클릭 수정</span>
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        {packingPhase === 'REVIEW' && <div className="matching-guide"><b>1. 전산 물량표 확인</b><span>2. 오른쪽 인보이스·매칭 결과 확인</span><span>3. 미매칭 수정</span><strong>4. 매칭 적용</strong></div>}
        {data && <section className={`reconcile ${packingRows.length ? ((packingPhase === 'REVIEW' ? totals.invoiceMismatches.length || totals.unmatchedRowCount : totals.status === 'WARNING') ? 'warning' : 'ok') : 'idle'}`} aria-label="총수량 대조">
          <b>{!packingRows.length ? '수량 대조 · 패킹리스트 업로드 대기' : packingPhase === 'REVIEW' ? ((totals.invoiceMismatches.length || totals.unmatchedRowCount) ? '⚠ 주문과 인보이스 확인 필요' : '✓ 주문과 인보이스 수량 일치') : (totals.status === 'OK' ? '✓ 적용 결과 정상' : '⚠ 적용 결과 확인 필요')}</b>
          <span>전산 주문 <strong>{fmtUnitTotals(totals.unitTotals, 'pivot')}</strong></span>
          <span>입고원장 <strong>{fmtUnitTotals(totals.unitTotals, 'packing')}</strong></span>
          <span>매칭 <strong>{fmt(totals.matchedPackingTotal)}</strong></span>
          <span className={totals.unmatchedPackingTotal ? 'warn' : ''}>미매칭 <strong>{fmt(totals.unmatchedPackingTotal)}</strong><small>{totals.unmatchedRowCount}건</small></span>
          {packingPhase !== 'REVIEW' && <><span>박스배정 <strong>{fmtUnitTotals(totals.unitTotals, 'allocated')}</strong></span><span className={Math.abs(totals.boardAllocationDifference) >= 0.001 ? 'warn' : ''}>최종표-박스 <strong>{fmtUnitDifferences(totals.unitTotals)}</strong></span></>}
          <button className={(packingPhase === 'REVIEW' ? totals.invoiceMismatches.length : totals.mismatches.length) ? 'warn' : ''} onClick={openReconciliationReview}>{packingPhase === 'REVIEW' ? '주문과 다른 인보이스' : '적용 오류'} <strong>{packingPhase === 'REVIEW' ? totals.invoiceMismatches.length : totals.mismatches.length}</strong><small>업체·품목 확인</small></button>
        </section>}
        <main>
          <section className="board-wrap">
            {!data && !loading && <div className="empty">연도·차수를 조회한 뒤 패킹리스트를 업로드하세요.</div>}
            {data && (
              <table className="board">
                <thead><tr><th className="product-head">품종 · 품목</th>{customers.map(customer => <th key={customer.custKey}><small className="customer-area">{customer.area || '기타'} · {customerDays[customer.custKey] ? `${customerDays[customer.custKey]}요일` : '요일미등록'}</small>{customer.custName}<small>{customer.orderCode || ''}</small></th>)}</tr></thead>
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
              {packingRows.map((row, index) => { const distribution = validateChinaPackingDistribution(row); return <article key={`${row.sourceRow}-${index}`} className={row.mappingStatus === 'MATCHED' && distribution.valid ? 'matched' : 'unmatched'}>
                <header><b>{row.customerCode}</b><span>{row.sourceBoxText}</span></header>
                <strong>{row.sourceItemName}</strong><div>{fmt(row.quantity)} · {row.allocations.map(a => <i key={`${a.boxNo}-${a.quantity}`}>{a.boxNo}:{fmt(a.quantity)}</i>)}</div>
                <small>{row.mappingStatus === 'MATCHED' ? <>전산 매칭: {row.customer.custName} / {row.product.prodName} <button className="inline-match" onClick={() => openPackingMatch(row.sourceRow)}>매칭 수정</button></> : <>{row.mappingStatus === 'CUSTOMER_UNMATCHED' ? '업체 매칭 필요' : '품목 매칭 필요'} <button className="inline-match" onClick={() => openPackingMatch(row.sourceRow)}>수정</button></>}</small>
                {row.mappingStatus === 'MATCHED' && <div className={`distribution-summary ${distribution.valid ? 'ok' : 'bad'}`}><span>분배 {fmt(distribution.distributedQuantity)} / {fmt(distribution.sourceQuantity)}</span><button onClick={() => openPackingDistribution(row.sourceRow)}>박스 분배</button></div>}
              </article>; })}
              {!packingRows.length && <div className="aside-empty">예: ROSE Diana 20단 / NO.16.17<br />→ 16번 10단 + 17번 10단</div>}
            </div>
          </aside>
        </main>
      </div>
      <CellEditor draft={draft} onChange={setDraft} onClose={() => setDraft(null)} onSave={saveCell} />
      <PackingDistributionModal draft={distributionDraft} customers={data?.customers || []} products={matchProducts} onChange={setDistributionDraft} onClose={() => setDistributionDraft(null)} onSave={savePackingDistribution} />
      {matchOpen && <MatchingModal key={matchingSourceRow ?? 'unresolved'} rows={packingRows} products={matchProducts} customers={data?.customers || []} targetSourceRow={matchingSourceRow} onClose={() => { setMatchOpen(false); setMatchingSourceRow(null); }} onSave={saveFullMatch} />}
      <InlineReviewPanel open={reviewOpen} phase={packingPhase} totals={totals} packingRows={packingRows} onClose={() => setReviewOpen(false)} onMatch={sourceRow => { setReviewOpen(false); openPackingMatch(sourceRow); }} onDistribution={sourceRow => { setReviewOpen(false); openPackingDistribution(sourceRow); }} />
      <style jsx global>{`
        html,body,#__next{height:100%;margin:0} body{overflow:hidden;font-family:Arial,'맑은 고딕',sans-serif;background:#eef1f5;color:#172033}
        *{box-sizing:border-box} button,input,select{font:inherit}.page{height:100vh;display:flex;flex-direction:column}.titlebar{height:27px;flex:none;background:linear-gradient(90deg,#071780,#087bc2);color:#fff;display:flex;align-items:center;padding:0 8px;font-size:11px;gap:10px}.titlebar span{font-weight:400;opacity:.8}.titlebar button{margin-left:auto;color:#fff;background:transparent;border:1px solid #ffffff66;border-radius:3px;padding:2px 10px}.toolbar{min-height:40px;flex:none;display:flex;align-items:center;gap:4px;padding:4px 6px;background:#fff;border-bottom:1px solid #cdd5df;font-size:11px;white-space:nowrap;overflow-x:auto}.toolbar label:not(.upload){display:flex;align-items:center;gap:3px}.toolbar input,.toolbar select{height:25px;border:1px solid #aeb9c8;border-radius:3px;padding:2px 5px}.toolbar label:first-child input{width:58px}.toolbar label:nth-child(2) input{width:65px}.toolbar .board-name input{width:122px}.toolbar .board-history{width:170px}.toolbar button,.upload{height:25px;border:1px solid #9aa9bc;background:#fff;border-radius:3px;padding:3px 7px;cursor:pointer}.toolbar .load,.upload,.save-board{background:#155bd7;color:#fff;border-color:#155bd7;font-weight:700}.toolbar .delete-board{color:#a11b1b;border-color:#e1a5a5}.toolbar .attention{background:#fff0e8;border-color:#e98145;color:#ae3c10;font-weight:800}.upload input{display:none}.upload.disabled{opacity:.45;cursor:not-allowed}.legend{margin-left:auto;color:#677388}.legend i,.box-badge{font-style:normal;color:#d31616;border:1px solid #e32626;background:#fff6f6;border-radius:3px;font-weight:800}.legend i{padding:1px 4px}.error{flex:none;background:#fff0f0;color:#b00020;padding:4px 8px;font-size:11px;border-bottom:1px solid #efb5bd}main{display:grid;grid-template-columns:minmax(0,1fr) 292px;min-height:0;flex:1;gap:4px;padding:4px}.board-wrap,aside{background:#fff;border:1px solid #cbd3de;border-radius:4px;min-height:0;overflow:auto}.empty{padding:50px;text-align:center;color:#7c8797}.board{border-collapse:separate;border-spacing:0;font-size:10px;min-width:100%}.board th,.board td{border-right:1px solid #dde2e8;border-bottom:1px solid #dde2e8}.board thead th{position:sticky;top:0;z-index:4;background:#e8eef7;height:34px;min-width:76px;max-width:76px;padding:2px}.board thead small{display:block;color:#78869a;font-weight:400}.board .product-head,.board tbody th{position:sticky;left:0;z-index:5;min-width:260px;max-width:260px;background:#f7f9fc;text-align:left}.board tbody th{height:32px;padding:2px 5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.board tbody th small{display:inline;color:#6c7890;font-weight:400;margin-right:4px}.board td{position:relative;width:76px;min-width:76px;max-width:76px;height:32px;min-height:32px;text-align:center;cursor:pointer;background:#fff}.board td:hover{outline:2px solid #276fea;outline-offset:-2px}.board td.active{background:#f8fbff}.board td.boxed{background:#fffaf9}.qty{font-weight:800;color:#153b7a}.box-badges{position:absolute;right:2px;top:2px;display:flex;gap:2px;max-width:58px;overflow:hidden;pointer-events:none}.box-badge{font-size:9px;line-height:13px;height:15px;min-width:18px;padding:0 2px;white-space:nowrap}.box-badge.more{background:#e32626;color:#fff}.aside-title{position:sticky;top:0;z-index:2;background:#172b55;color:#fff;padding:6px 7px;display:flex;justify-content:space-between;font-size:11px}aside>p{font-size:10px;color:#667286;margin:5px 7px}.packing-list{padding:0 5px 6px}.packing-list article{padding:5px;margin-bottom:4px;border:1px solid #d7dde6;border-left:3px solid #239b56;border-radius:3px;font-size:10px}.packing-list article.unmatched{border-left-color:#e24b3b;background:#fff7f5}.packing-list article header{display:flex;justify-content:space-between;color:#56647a}.packing-list article strong{display:block;margin:2px 0}.packing-list article i{font-style:normal;color:#d31616;border:1px solid #ee9b9b;border-radius:3px;padding:1px 2px;margin-left:2px}.packing-list article small{display:block;margin-top:3px;color:#64748b}.aside-empty{text-align:center;color:#8894a5;padding:28px 8px;line-height:1.7}.modal-shade{position:fixed;inset:0;z-index:100;background:#08122688;display:flex;align-items:center;justify-content:center}.cell-modal,.match-modal{width:510px;max-height:85vh;background:#fff;border-radius:7px;box-shadow:0 15px 60px #0006;overflow:auto}.cell-modal>header,.match-modal>header{height:36px;background:#183b72;color:#fff;display:flex;align-items:center;padding:0 12px}.cell-modal>header button,.match-modal>header button{margin-left:auto;background:transparent;color:#fff;border:0;font-size:22px}.modal-meta{padding:10px 13px;border-bottom:1px solid #e1e6ec}.modal-meta span,.modal-meta small{display:block;margin-top:3px}.modal-meta small{color:#b42318}.qty-field{display:flex;align-items:center;justify-content:space-between;padding:10px 13px;font-weight:700}.qty-field input{width:150px}.cell-modal input{height:29px;border:1px solid #aeb9c8;border-radius:4px;padding:3px 6px}.alloc-title{display:flex;justify-content:space-between;padding:7px 13px;background:#f3f6fa;font-size:12px}.alloc-title span{color:#657187}.alloc-list{padding:8px 13px}.alloc-row{display:grid;grid-template-columns:1fr 1fr 52px;gap:7px;margin-bottom:6px;align-items:end}.alloc-row label{font-size:11px}.alloc-row input{display:block;width:100%;margin-top:2px}.remove{height:29px;border:1px solid #e1a5a5;background:#fff;color:#b42318;border-radius:4px}.add-box{margin:0 13px 8px;border:1px dashed #df5454;background:#fff8f8;color:#c51f1f;border-radius:4px;padding:5px 10px}.allocation-check{margin:2px 13px;padding:7px;border-radius:4px;font-size:12px;font-weight:700}.allocation-check.ok{background:#eaf8ef;color:#176b35}.allocation-check.bad{background:#fff0f0;color:#ad1622}.cell-modal footer,.match-modal footer{display:flex;justify-content:flex-end;gap:7px;padding:10px 13px;border-top:1px solid #e2e7ed}.cell-modal footer button,.match-modal footer button{padding:6px 17px;border:1px solid #aeb9c8;background:#fff;border-radius:4px}.cell-modal footer .primary{background:#155bd7;color:#fff;border-color:#155bd7}.cell-modal footer .primary:disabled{opacity:.45}
        .board .product-head,.board tbody th{min-width:260px;max-width:260px}.board tbody th{overflow:visible;text-overflow:clip}.board tbody th span{display:inline;white-space:nowrap}.qty{position:absolute;z-index:5;left:1px;width:31px;top:1px;text-align:center;font-size:15px;line-height:18px;font-weight:900;pointer-events:none}.order-qty{position:absolute;z-index:5;left:1px;bottom:0;width:31px;font-size:7px;line-height:9px;color:#6d7787;pointer-events:none;white-space:nowrap}.box-badges{z-index:3;left:auto;right:1px;top:1px;bottom:1px;width:42px;max-width:42px;display:flex;align-content:center;justify-content:flex-start;flex-wrap:wrap;gap:1px;overflow:hidden}.box-badges.area-right{width:118px;max-width:118px;right:-75px;background:#fffaf9aa;padding:1px}.box-badges.area-left{width:118px;max-width:118px;right:1px;background:#fffaf9aa;padding:1px}.box-badges.area-down{height:62px;bottom:-31px;background:#fffaf9aa;padding:1px}.box-badges.area-up{height:62px;top:-31px;background:#fffaf9aa;padding:1px}.box-badge{font-size:9px;line-height:12px;height:14px;padding:0 1px;min-width:0;box-shadow:0 0 0 1px #fff}.box-badge[data-digits="1"]{width:15px}.box-badge[data-digits="2"]{width:19px}.box-badge[data-digits="3"]{width:24px}
        .reconcile{height:36px;flex:none;display:flex;align-items:center;gap:4px;padding:3px 6px;background:#eef8f1;border-bottom:1px solid #a9d9b8;font-size:10px;overflow-x:auto;white-space:nowrap}.reconcile>b{min-width:125px;color:#176b35}.reconcile>span,.reconcile>button{display:flex;align-items:baseline;gap:3px;min-width:90px;padding:3px 5px;background:#fff;border:1px solid #cbd8ce;border-radius:3px;font:inherit;text-align:left}.reconcile strong{font-size:13px;color:#183b72}.reconcile small{color:#78869a}.reconcile.warning{background:#fff6e8;border-color:#efbd68}.reconcile.warning>b,.reconcile .warn,.reconcile .warn strong{color:#b42318}.reconcile.idle{background:#f4f6f8;border-color:#d6dce4}
        .match-modal{width:690px}.match-source{padding:10px 13px;border-bottom:1px solid #e1e6ec}.match-source b,.match-source span,.match-source small{display:block}.match-source span{margin-top:3px}.match-source small{color:#657187;margin-top:5px}.match-queue{padding:7px 10px;background:#f3f6fa;display:flex;gap:4px;overflow:auto}.match-queue button{border:1px solid #bac6d7;background:#fff;border-radius:3px;padding:3px 6px;white-space:nowrap;font-size:11px}.match-queue button.active{background:#173b72;color:#fff;border-color:#173b72}.match-search{display:block;padding:9px 12px;font-size:11px;font-weight:700}.match-search input{display:block;width:100%;height:30px;margin-top:4px;border:1px solid #aeb9c8;border-radius:4px;padding:4px 7px}.match-products{display:grid;grid-template-columns:1fr 1fr;gap:5px;padding:0 12px 12px;max-height:48vh;overflow:auto}.match-products button{border:1px solid #d5dce6;background:#fff;text-align:left;border-radius:4px;padding:6px;cursor:pointer}.match-products button:hover{border-color:#155bd7;background:#f4f8ff}.match-products b,.match-products span,.match-products small{display:block}.match-products b{font-size:10px;color:#617087}.match-products span{font-size:12px;font-weight:700;margin-top:2px}.match-products small{font-size:10px;color:#7b8798;margin-top:3px}
        .week-field button{width:24px;padding:0!important;font-size:18px;font-weight:900}.week-field select{width:72px;font-weight:800;color:#173b72}.source-file{display:inline-block;max-width:180px;overflow:hidden;text-overflow:ellipsis;color:#36547c;vertical-align:middle}.toolbar .apply-matches{background:#168447;color:#fff;border-color:#168447;font-weight:900}.matching-guide{height:31px;flex:none;display:flex;align-items:center;gap:18px;padding:4px 8px;background:#fff7db;border-bottom:1px solid #e6bf55;font-size:11px}.matching-guide b{color:#173b72}.matching-guide strong{color:#087b3d}.inline-match{margin-left:4px;border:1px solid #dd6b55;background:#fff;color:#b42318;border-radius:3px;font-size:10px;padding:1px 5px;cursor:pointer}
        .rematch-fields{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:10px 13px;background:#f6f8fb}.rematch-fields label{font-size:11px;font-weight:800}.rematch-fields select{display:block;width:100%;height:32px;margin-top:4px;border:1px solid #aeb9c8;border-radius:4px;background:#fff;padding:3px 6px}.match-products button.active{outline:2px solid #155bd7;background:#edf5ff}.match-modal footer .primary{background:#155bd7;color:#fff;border-color:#155bd7}.match-modal footer .primary:disabled{opacity:.45}.distribution-summary{display:flex;align-items:center;justify-content:space-between;margin-top:5px;padding-top:4px;border-top:1px dashed #d4dbe5;font-size:10px}.distribution-summary.ok span{color:#08783e}.distribution-summary.bad span{color:#b42318;font-weight:800}.distribution-summary button{border:1px solid #2c69bd;background:#edf5ff;color:#174f9d;border-radius:3px;padding:2px 6px;cursor:pointer}.distribution-modal{width:900px;max-width:96vw;max-height:88vh;background:#fff;border-radius:7px;box-shadow:0 15px 60px #0006;overflow:auto}.distribution-modal>header{height:38px;background:#183b72;color:#fff;display:flex;align-items:center;padding:0 12px}.distribution-modal>header button{margin-left:auto;background:transparent;color:#fff;border:0;font-size:22px}.distribution-source{padding:10px 13px;border-bottom:1px solid #dce3ec}.distribution-source b,.distribution-source span,.distribution-source small{display:block}.distribution-source span{margin-top:4px;font-weight:700}.distribution-source small{margin-top:4px;color:#66758a}.distribution-head{display:flex;justify-content:space-between;padding:8px 13px;background:#f2f6fb;font-size:12px}.distribution-head span{color:#66758a}.distribution-list{padding:9px 13px}.distribution-row{display:grid;grid-template-columns:1fr 1.7fr 110px 48px;gap:7px;align-items:end;margin-bottom:7px}.distribution-row label{font-size:10px;font-weight:700}.distribution-row select,.distribution-row input{display:block;width:100%;height:30px;margin-top:3px;border:1px solid #aeb9c8;border-radius:4px;padding:3px 6px;background:#fff}.distribution-row .remove{height:30px}.add-distribution{margin:0 13px 8px;border:1px dashed #447cc4;background:#f5f9ff;color:#174f9d;border-radius:4px;padding:5px 10px}.distribution-check{display:flex;align-items:center;gap:18px;margin:3px 13px 10px;padding:9px;border-radius:4px;font-size:12px}.distribution-check.ok{background:#eaf8ef;color:#176b35}.distribution-check.bad{background:#fff0f0;color:#ad1622}.distribution-check strong{margin-left:auto}.distribution-modal>footer{display:flex;justify-content:flex-end;gap:7px;padding:10px 13px;border-top:1px solid #e2e7ed}.distribution-modal>footer button{padding:6px 17px;border:1px solid #aeb9c8;background:#fff;border-radius:4px}.distribution-modal>footer .primary{background:#155bd7;color:#fff;border-color:#155bd7}.distribution-modal>footer .primary:disabled{opacity:.45}
        .page,.toolbar,main,.board-wrap,aside{min-width:0}.board thead .customer-area{color:#225ea8;font-weight:700;font-size:8px}.inline-review{position:fixed;z-index:90;top:27px;right:0;bottom:0;width:min(860px,72vw);background:#eef2f7;border-left:2px solid #173b72;box-shadow:-10px 0 30px #09152b44;display:flex;flex-direction:column}.inline-review>header{min-height:48px;background:#173b72;color:#fff;display:flex;align-items:center;padding:7px 12px}.inline-review>header div{display:flex;flex-direction:column;gap:2px}.inline-review>header span{font-size:10px;opacity:.8}.inline-review>header button{margin-left:auto;border:0;background:transparent;color:#fff;font-size:24px}.review-tabs{display:flex;gap:5px;padding:7px;background:#fff;border-bottom:1px solid #cdd6e2}.review-tabs button{border:1px solid #aeb9c8;background:#fff;border-radius:3px;padding:5px 10px}.review-tabs button.active{background:#155bd7;color:#fff;border-color:#155bd7}.review-scroll{overflow:auto;padding:7px}.review-block{margin-bottom:8px}.review-block h3{font-size:11px;margin:0;padding:5px 7px;color:#173b72}.review-row{display:grid;grid-template-columns:minmax(170px,1fr) minmax(190px,1.2fr) 210px;gap:7px;align-items:center;margin-bottom:5px;padding:7px;border:1px solid;border-radius:4px;background:#fff}.review-row.good{border-color:#83b8ef;background:#edf6ff}.review-row.bad{border-color:#ef9b92;background:#fff3f1}.review-row small,.review-row b,.review-row span{display:block}.review-row small{font-size:9px;color:#637087}.review-row b{font-size:11px;margin:2px 0}.review-row span{font-size:9px;color:#526077;white-space:normal}.review-row>button,.review-actions button{border:1px solid #9baabd;background:#fff;border-radius:3px;padding:4px 7px;font-size:10px}.review-actions{display:flex;flex-direction:column;gap:3px}.review-actions>span{display:flex;gap:3px}.review-actions .primary{background:#155bd7;color:#fff;border-color:#155bd7}.review-complete{padding:22px;text-align:center;color:#155bd7;background:#edf6ff;border:1px solid #83b8ef;font-weight:800}
        @media(max-width:1200px){main{grid-template-columns:minmax(0,1fr) 320px}.legend{display:none}.inline-review{width:92vw}}
        @media print{.titlebar,.toolbar,aside,.error{display:none!important}body{overflow:visible}.page,main{height:auto;display:block;padding:0}.board-wrap{border:0;overflow:visible}.board thead th,.board tbody th{position:static}.box-badge{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
      `}</style>
    </>
  );
}
