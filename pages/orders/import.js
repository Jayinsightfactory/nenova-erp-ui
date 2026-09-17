// pages/orders/import.js — 이미지/엑셀 업로드 주문등록 (라움 등 거래처 발주표)

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
// Layout 은 _app.js 가 전역 래핑 — 페이지 자체 래핑 금지(이중 사이드바 원인)
import { apiGet, apiPost } from '../../lib/useApi';
import { getCurrentWeek, formatWeekDisplay } from '../../lib/useWeekInput';
import { normalizeOrderUnit, resolveOrderWeekQuery } from '../../lib/orderUtils';
import { getDisplayName } from '../../lib/displayName';
import { clearImportProductMatchForName } from '../../lib/orderImportMatch';
import { scoreProductSearchOptions } from '../../lib/productSearchRanking';
import {
  mergeRegisterItems,
  setImportItemsSkip,
  importSkipCounts,
  pickImportRegisteredOrder,
  importWriteStatusLabel,
  buildImportRegisterResult,
  buildImportMatchAggregates,
  buildImportInlineMatchRows,
  findOrderImportMatchInsertIndex,
  findImportMixedUnitProducts,
  sortImportRowsByProductOrder,
} from '../../lib/orderImportRegister';
import { buildStatementRowsFromImportItems, parentWeekFromFullWeek } from '../../lib/importStatementRows';
import { loadImportDraft, saveImportDraft, clearImportDraft } from '../../lib/orderImportDraft';
import { ESTIMATE_PRINT_FORMAT } from '../../lib/estimatePrintFormats';
import * as XLSX from 'xlsx';
import { initializeShipDateAllocations, moveShipmentQuantity, allocationTotal, buildShipmentListRows } from '../../lib/orderShipmentList';
import { sanitizeExcelSheetName } from '../../lib/estimatePrintPrepare';
import {
  buildEstimatePrintWorkbook,
  buildEstimatePrintWorksheet,
  downloadEstimatePrintWorkbook,
} from '../../lib/estimatePrintExcel';

const DEFAULT_CUST_SEARCH = '라움';
const IMPORT_CUST_STORAGE_KEY = 'nenova_import_last_cust';

async function persistItemMapping(item, prod, { force = true, custKey = null, custName = '' } = {}) {
  if (!item?.inputName || !prod?.ProdKey) return false;
  try {
    await apiPost('/api/orders/mappings', {
      inputToken: item.inputName,
      prodKey: prod.ProdKey,
      prodName: prod.ProdName,
      displayName: prod.DisplayName || prod.ProdName,
      flowerName: prod.FlowerName,
      counName: prod.CounName,
      unit: item.unit,
      force,
      custKey,
      custName,
    });
    if (item.unit) {
      await apiPost('/api/orders/import-units', {
        inputName: item.inputName,
        unit: item.unit,
        source: 'manual',
      });
    }
    return true;
  } catch (e) {
    console.warn('[import] mapping save failed:', e?.message || e);
    return false;
  }
}

function getNearby2026Weeks(range = 4) {
  const now = new Date();
  const year = now.getFullYear();
  const start = new Date(year, 0, 1);
  const dayOfYear = Math.floor((now - start) / 86400000) + 1;
  const curWeek = Math.min(Math.ceil(dayOfYear / 7), 52);
  const weeks = [];
  for (let w = Math.max(1, curWeek - range); w <= curWeek + range; w += 1) {
    for (let s = 1; s <= 3; s += 1) {
      weeks.push(`${year}-${String(w).padStart(2, '0')}-${String(s).padStart(2, '0')}`);
    }
  }
  return weeks;
}

function unitSourceLabel(source) {
  if (source === 'upload') return '엑셀열';
  if (source === 'catalog') return '엑셀학습';
  if (source === 'inferred') return '품목추론';
  if (source === 'mapping') return '저장매핑';
  if (source === 'manual') return '수동';
  if (source === 'product') return '품목설정';
  if (source === 'history') return '주문이력';
  return '';
}

const st = {
  page: { maxWidth: 1840, margin: '0 auto', padding: '12px 16px 120px' },
  card: { background: '#fff', border: '1px solid #dbe3ef', borderRadius: 8, padding: 16, marginBottom: 14 },
  title: { fontSize: 18, fontWeight: 700, color: '#0f172a', marginBottom: 4 },
  sub: { fontSize: 12, color: '#64748b', marginBottom: 12 },
  row: { display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 },
  label: { fontSize: 12, fontWeight: 600, color: '#475569', minWidth: 56 },
  input: { padding: '7px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13 },
  btn: { padding: '8px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  btnPrimary: { background: '#1565c0', color: '#fff' },
  btnSecondary: { background: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1' },
  drop: { border: '2px dashed #94a3b8', borderRadius: 8, padding: 24, textAlign: 'center', background: '#f8fafc', cursor: 'pointer' },
  dropActive: { borderColor: '#1565c0', background: '#eff6ff' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: { textAlign: 'left', padding: '8px 6px', borderBottom: '2px solid #e2e8f0', background: '#f8fafc', fontWeight: 700 },
  td: { padding: '7px 6px', borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' },
  badgeOk: { background: '#dcfce7', color: '#166534', padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700 },
  badgeWarn: { background: '#ffedd5', color: '#c2410c', padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700 },
  badgeErr: { background: '#fee2e2', color: '#b91c1c', padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700 },
  suggestRow: { display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  suggestBtn: { fontSize: 10, padding: '3px 6px', borderRadius: 4, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', textAlign: 'left' },
  searchWrap: { position: 'relative', minWidth: 220 },
  dropdown: { position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: '#fff', border: '1px solid #cbd5e1', borderRadius: 6, maxHeight: 180, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.12)' },
  pickRow: { display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px', border: 'none', background: '#fff', cursor: 'pointer', fontSize: 11 },
  editBtn: { fontSize: 10, lineHeight: 1.1, padding: '2px 5px', border: '1px solid #1565c0', borderRadius: 4, background: '#e3f2fd', color: '#0d47a1', cursor: 'pointer', whiteSpace: 'nowrap' },
  clearBtn: { fontSize: 10, lineHeight: 1.1, padding: '2px 5px', border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff', color: '#64748b', cursor: 'pointer', whiteSpace: 'nowrap' },
  kpi: { display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 },
  kpiBox: { padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12 },
};

function ExcelSheetPreview({
  preview,
  inlineRows,
  allProducts,
  editProdIdx,
  onEditProdIdx,
  onUpdateItem,
  onChangeUnit,
  onPickProduct,
  onClearProduct,
  onPersistMapping,
}) {
  if (!preview?.rows?.length) {
    return (
      <div style={{ ...st.card, marginBottom: 0, minHeight: 220 }}>
        <strong>원본 Excel 시트</strong>
        <div style={{ marginTop: 12, color: '#64748b', fontSize: 12 }}>
          Excel 파일을 업로드하면 실제 시트와 매칭된 행을 여기에 함께 표시합니다.
        </div>
      </div>
    );
  }
  const inlineByRow = new Map((inlineRows || []).map(row => [Number(row.rowNo), row.matches || []]));
  const matchInsertIndex = findOrderImportMatchInsertIndex(preview);
  const matchCell = {
    minWidth: 150,
    maxWidth: 260,
    padding: '2px 4px',
    borderRight: '1px solid #bfdbfe',
    borderBottom: '1px solid #cbd5e1',
    background: '#f8fbff',
    verticalAlign: 'middle',
  };
  const matchHead = {
    ...matchCell,
    background: '#1e3a8a',
    color: '#fff',
    fontWeight: 800,
    whiteSpace: 'nowrap',
  };
  const statusBadge = (item) => {
    if (item.skip) return <span style={st.badgeErr}>제외</span>;
    if (!item.prodKey) return <span style={st.badgeWarn}>미매칭</span>;
    if (Number(item.qty) <= 0) return <span style={st.badgeWarn}>수량0</span>;
    if (item.mappingScope === 'customer') return <span style={st.badgeOk}>업체 저장매칭</span>;
    if (item.fromMapping) return <span style={st.badgeOk}>저장매칭</span>;
    if (item.mappingMatchType === 'manual') return <span style={st.badgeOk}>수동</span>;
    return <span style={st.badgeOk}>자동</span>;
  };
  return (
    <div style={{ ...st.card, marginBottom: 0, padding: 12, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <strong>원본 Excel 시트 + 행별 ERP 매칭</strong>
        <span style={{ fontSize: 11, color: '#64748b' }}>
          {preview.sheetName || 'Sheet1'} · {preview.sourceRange || ''} · {preview.rowCount}행 × {preview.columnCount}열
        </span>
      </div>
      <div style={{ overflowX: 'auto', overflowY: 'visible', border: '1px solid #cbd5e1', borderRadius: 6 }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, minWidth: '100%', fontSize: 11 }}>
          <tbody>
            {preview.rows.map((row) => {
              const isHeader = Number(row.rowNo) === Number(preview.headerRow);
              const rowMatches = inlineByRow.get(Number(row.rowNo)) || [];
              const isMatched = rowMatches.some(entry => !entry.item.skip && entry.item.prodKey);
              return (
                <tr key={row.rowNo} style={{ background: isHeader ? '#dbeafe' : isMatched ? '#ecfdf5' : '#fff' }}>
                  <th style={{ position: 'sticky', left: 0, zIndex: 2, minWidth: 36, padding: '2px 4px', borderRight: '1px solid #cbd5e1', borderBottom: '1px solid #e2e8f0', background: isHeader ? '#bfdbfe' : isMatched ? '#d1fae5' : '#f8fafc', color: '#64748b', textAlign: 'right', lineHeight: 1.15 }}>
                    {row.rowNo}
                  </th>
                  {(row.cells || []).slice(0, matchInsertIndex).map((cell, colIdx) => {
                    const aggregateEntry = rowMatches.find(entry => entry.sourceCount > 1);
                    const isQtyCell = !isHeader && colIdx === matchInsertIndex - 1 && aggregateEntry;
                    return (
                      <td key={`${row.rowNo}-${colIdx}`} title={String(cell ?? '')} style={{ minWidth: isQtyCell ? 150 : 56, maxWidth: isQtyCell ? 190 : 165, padding: '2px 4px', borderRight: '1px solid #eef2f7', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: isHeader ? 700 : 400, lineHeight: 1.15 }}>
                        <span>{String(cell ?? '')}</span>
                        {isQtyCell && (
                          <span title={`원본 ${aggregateEntry.sourceCount}행을 합산한 최종수량`} style={{ marginLeft: 5, padding: '1px 4px', borderRadius: 8, background: '#dbeafe', color: '#1d4ed8', fontSize: 9, fontWeight: 800 }}>
                            Σ {aggregateEntry.sourceCount}행 → {aggregateEntry.item.qty}{aggregateEntry.item.unit}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  {isHeader ? (
                    <>
                      <th style={{ ...matchHead, borderLeft: '3px solid #2563eb', minWidth: 330, width: 330 }}>ERP 매칭 품목</th>
                      <th style={{ ...matchHead, minWidth: 126 }}>최종수량</th>
                      <th style={{ ...matchHead, minWidth: 82 }}>단위</th>
                      <th style={{ ...matchHead, minWidth: 112 }}>상태 · 수정</th>
                    </>
                  ) : (
                    <>
                      <td style={{ ...matchCell, borderLeft: '3px solid #2563eb', minWidth: 330, width: 330 }}>
                        {rowMatches.map((entry, matchIdx) => {
                          const item = entry.item;
                          return (
                            <div key={`${entry.itemIndex}-${matchIdx}`} style={{ minHeight: 22, display: 'flex', alignItems: 'center', paddingBottom: matchIdx < rowMatches.length - 1 ? 2 : 0, marginBottom: matchIdx < rowMatches.length - 1 ? 2 : 0, borderBottom: matchIdx < rowMatches.length - 1 ? '1px dashed #bfdbfe' : 'none' }}>
                              {entry.isPrimary ? (
                                <ProductMatchCell
                                  row={item}
                                  idx={entry.itemIndex}
                                  allProducts={allProducts}
                                  editing={editProdIdx === entry.itemIndex}
                                  onToggleEdit={() => onEditProdIdx(editProdIdx === entry.itemIndex ? null : entry.itemIndex)}
                                  onPick={(product) => onPickProduct(entry.itemIndex, product)}
                                  onClear={() => onClearProduct(entry.itemIndex)}
                                  onPersistMapping={onPersistMapping}
                                  compact
                                />
                              ) : (
                                <span title={item.displayName || item.prodName || '미매칭'} style={{ fontWeight: 700, color: item.prodKey ? '#1e40af' : '#b45309', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {item.displayName || item.prodName || '미매칭'} <small style={{ color: '#64748b' }}>· 합산 포함</small>
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </td>
                      <td style={{ ...matchCell, minWidth: 126 }}>
                        {rowMatches.map((entry) => entry.isPrimary ? (
                          <div key={entry.itemIndex} style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                            <input
                              type="number"
                              min={0}
                              value={entry.item.qty}
                              onChange={(e) => onUpdateItem(entry.itemIndex, { qty: e.target.value === '' ? '' : Math.max(0, Number(e.target.value) || 0) })}
                              onBlur={(e) => { if (e.target.value === '' || Number(e.target.value) <= 0) onUpdateItem(entry.itemIndex, { qty: 0 }); }}
                              style={{ ...st.input, width: 66, padding: '2px 4px', height: 24 }}
                            />
                            {entry.sourceCount > 1 && <span style={{ fontSize: 9, color: '#1d4ed8', fontWeight: 700 }}>Σ{entry.sourceCount}행</span>}
                          </div>
                        ) : (
                          <span key={entry.itemIndex} style={{ color: '#475569', whiteSpace: 'nowrap' }}>{entry.sourceQty} 포함 → Σ{entry.item.qty}</span>
                        ))}
                      </td>
                      <td style={{ ...matchCell, minWidth: 82 }}>
                        {rowMatches.map((entry) => entry.isPrimary ? (
                          <select key={entry.itemIndex} style={{ ...st.input, padding: '2px 4px', height: 24 }} value={entry.item.unit || '박스'} onChange={(e) => onChangeUnit(entry.itemIndex, e.target.value)}>
                            {['박스', '단', '송이'].map(unit => <option key={unit} value={unit}>{unit}</option>)}
                          </select>
                        ) : <div key={entry.itemIndex}>{entry.item.unit}</div>)}
                      </td>
                      <td style={{ ...matchCell, minWidth: 112 }}>
                        {rowMatches.map((entry) => (
                          <div key={entry.itemIndex} style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'nowrap', whiteSpace: 'nowrap' }}>
                            {statusBadge(entry.item)}
                            {entry.isPrimary && (
                              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#475569' }}>
                                <input type="checkbox" checked={!!entry.item.skip} onChange={(e) => onUpdateItem(entry.itemIndex, { skip: e.target.checked })} /> 제외
                              </label>
                            )}
                          </div>
                        ))}
                      </td>
                    </>
                  )}
                  {(row.cells || []).slice(matchInsertIndex).map((cell, colIdx) => {
                    const originalColIdx = matchInsertIndex + colIdx;
                    return (
                      <td key={`${row.rowNo}-${originalColIdx}`} title={String(cell ?? '')} style={{ minWidth: 56, maxWidth: 165, padding: '2px 4px', borderRight: '1px solid #eef2f7', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: isHeader ? 700 : 400, lineHeight: 1.15 }}>
                        {String(cell ?? '')}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {(preview.truncatedRows || preview.truncatedColumns) && (
        <div style={{ marginTop: 6, fontSize: 11, color: '#b45309' }}>화면 속도를 위해 일부 행·열만 미리보기로 표시합니다. 주문등록은 전체 파싱 결과를 기준으로 합니다.</div>
      )}
      <div style={{ marginTop: 6, fontSize: 11, color: '#047857' }}>연두색 원본 행의 발주수량 바로 오른쪽, 파란 구분선부터 ERP 매칭값입니다. 품목·수량·단위를 같은 행에서 바로 확인하고 수정할 수 있습니다.</div>
    </div>
  );
}

function MatchAggregateTable({ rows }) {
  const unitTotals = (rows || []).reduce((acc, row) => {
    acc[row.unit] = (acc[row.unit] || 0) + Number(row.qty || 0);
    return acc;
  }, {});
  return (
    <div style={{ marginBottom: 12, border: '1px solid #93c5fd', borderRadius: 7, overflow: 'hidden' }}>
      <div style={{ padding: '5px 7px', background: '#eff6ff', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong style={{ color: '#1e40af' }}>Excel 행 순서 · 합산된 매칭수량 {rows.length}품목</strong>
        {Object.entries(unitTotals).map(([unit, qty]) => <span key={unit} style={{ ...st.badgeOk, fontSize: 11 }}>{unit} {qty.toLocaleString()}</span>)}
      </div>
      <div style={{ overflowX: 'auto', overflowY: 'visible' }}>
        <table style={st.table}>
          <thead><tr><th style={{ ...st.th, padding: '4px 5px' }}>매칭 품목</th><th style={{ ...st.th, padding: '4px 5px' }}>원본 행</th><th style={{ ...st.th, padding: '4px 5px', textAlign: 'right' }}>최종수량</th></tr></thead>
          <tbody>{rows.map(row => (
            <tr key={`${row.prodKey}-${row.unit}`}>
              <td title={[row.displayName || row.prodName, row.counName, row.flowerName].filter(Boolean).join(' · ')} style={{ ...st.td, padding: '3px 5px', maxWidth: 320, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}><b>{row.displayName || row.prodName}</b>{row.sourceCount > 1 && <span style={{ marginLeft: 5, color: '#1d4ed8', fontSize: 9, fontWeight: 800 }}>Σ{row.sourceCount}행</span>}</td>
              <td style={{ ...st.td, padding: '3px 5px', whiteSpace: 'nowrap' }}>{row.sourceRows.length ? `${row.sourceRows.join(', ')}행` : `${row.sourceCount}건`}</td>
              <td style={{ ...st.td, padding: '3px 5px', textAlign: 'right', fontWeight: 800, color: '#1d4ed8', whiteSpace: 'nowrap' }}>{Number(row.qty).toLocaleString()} {row.unit}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

function RegisterProgressLog({ entries, running }) {
  if (!entries.length && !running) return null;
  return (
    <div style={{ ...st.card, border: `2px solid ${running ? '#2563eb' : '#94a3b8'}`, background: '#f8fafc' }} aria-live="polite">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <strong>주문등록 진행 로그</strong>
        <span style={{ ...st.badgeOk, background: running ? '#dbeafe' : '#e2e8f0', color: running ? '#1d4ed8' : '#475569' }}>{running ? '처리 중' : '처리 종료'}</span>
      </div>
      <div style={{ fontSize: 12 }}>
        {entries.map(entry => (
          <div key={entry.id} style={{ padding: '6px 8px', marginBottom: 4, borderLeft: `4px solid ${entry.type === 'error' ? '#dc2626' : entry.type === 'success' ? '#16a34a' : '#3b82f6'}`, background: '#fff' }}>
            <span style={{ color: '#64748b', marginRight: 8 }}>{entry.time}</span>{entry.message}
          </div>
        ))}
      </div>
    </div>
  );
}

function CustomerSearchSelect({ value, onChange, placeholder }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [remote, setRemote] = useState([]);
  const [loading, setLoading] = useState(false);
  const [label, setLabel] = useState('');
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!value) { setLabel(''); return; }
    (async () => {
      try {
        const d = await apiGet('/api/customers/search', { q: String(value) });
        const hit = (d.customers || []).find(c => String(c.CustKey) === String(value));
        if (hit) setLabel(hit.CustName);
      } catch { /* ignore */ }
    })();
  }, [value]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (!open || query.trim().length < 1) {
      setRemote([]);
      return undefined;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const d = await apiGet('/api/customers/search', { q: query.trim() });
        setRemote(d.customers || []);
      } catch {
        setRemote([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, open]);

  return (
    <div ref={wrapRef} style={st.searchWrap}>
      <input
        style={{ ...st.input, width: '100%', minWidth: 200, boxSizing: 'border-box' }}
        value={open ? query : (label || query)}
        placeholder={placeholder || '거래처 검색 (라움)'}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); if (!e.target.value) onChange(null); }}
        onFocus={() => setOpen(true)}
      />
      {open && (
        <div style={st.dropdown}>
          {loading && <div style={{ padding: 8, fontSize: 11, color: '#64748b' }}>검색 중…</div>}
          {!loading && query.trim() && remote.length === 0 && (
            <div style={{ padding: 8, fontSize: 11, color: '#64748b' }}>검색 결과 없음</div>
          )}
          {remote.map(c => (
            <button
              key={c.CustKey}
              type="button"
              style={st.pickRow}
              onMouseDown={() => {
                onChange({ CustKey: c.CustKey, CustName: c.CustName });
                setLabel(c.CustName);
                setQuery('');
                setOpen(false);
              }}
            >
              {c.CustName}{c.OrderCode ? ` (${c.OrderCode})` : ''}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ProductPicker({ row, allProducts, onPick, onPersistMapping, compact = false }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const matchQuery = row.matchName || row.inputName;
  const defaultSuggestions = useMemo(() => {
    if ((row.suggestedProducts || []).length > 0) return row.suggestedProducts;
    if (!row.inputName) return [];
    return scoreProductSearchOptions(matchQuery, allProducts)
      .slice(0, 6)
      .map(({ product: prod, matchScore }) => ({
        prodKey: prod.ProdKey,
        prodName: prod.ProdName,
        displayName: prod.DisplayName || prod.ProdName,
        flowerName: prod.FlowerName,
        counName: prod.CounName,
        outUnit: prod.OutUnit,
        score: Math.min(100, Math.round(matchScore)),
      }));
  }, [row.suggestedProducts, matchQuery, allProducts]);

  const searchHits = useMemo(() => {
    if (!search.trim()) return [];
    return scoreProductSearchOptions(search.trim(), allProducts)
      .slice(0, 12)
      .map(({ product: prod, matchScore }) => ({
        prod,
        score: Math.min(100, Math.round(matchScore)),
      }));
  }, [search, allProducts]);

  const pick = async (prod) => {
    const saved = onPersistMapping ? await onPersistMapping(row, prod) : true;
    onPick(prod);
    setOpen(false);
    setSearch('');
    if (!saved) {
      alert('현재 화면의 품목은 변경했지만 저장매핑 반영에 실패했습니다. 다시 업로드하기 전에 품목을 다시 선택해 주세요.');
    }
  };

  return (
    <div ref={wrapRef} style={compact ? { flex: 1, minWidth: 0 } : undefined}>
      {!compact && defaultSuggestions.length > 0 && (
        <div style={st.suggestRow}>
          {defaultSuggestions.map(s => (
            <button
              key={s.prodKey}
              type="button"
              style={st.suggestBtn}
              title={`${s.score}%`}
              onClick={() => void pick({
                ProdKey: s.prodKey,
                ProdName: s.prodName,
                DisplayName: s.displayName,
                FlowerName: s.flowerName,
                CounName: s.counName,
                OutUnit: s.outUnit,
              })}
            >
              ★ {s.score}% {s.displayName || s.prodName}
            </button>
          ))}
        </div>
      )}
      <div style={{ marginTop: compact ? 0 : 6, position: 'relative' }}>
        <input
          style={{ ...st.input, width: '100%', height: compact ? 24 : undefined, padding: compact ? '2px 5px' : st.input.padding, boxSizing: 'border-box' }}
          placeholder={compact ? '품목 검색…' : '품목 검색 (한글·영문)…'}
          value={search}
          onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
        />
        {open && search.trim() && searchHits.length > 0 && (
          <div style={st.dropdown}>
            {searchHits.map(({ prod, score }) => (
              <button key={prod.ProdKey} type="button" style={st.pickRow} onMouseDown={() => void pick(prod)}>
                {score}% · {getDisplayName(prod)} · {prod.CounName || ''}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProductMatchCell({ row, idx, allProducts, editing, onToggleEdit, onPick, onClear, onPersistMapping, compact = false }) {
  const hasMatch = !!row.prodKey;

  if (compact) {
    if (!hasMatch || editing) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%', minWidth: 0, whiteSpace: 'nowrap' }}>
          <ProductPicker row={row} allProducts={allProducts} onPick={onPick} onPersistMapping={onPersistMapping} compact />
          {hasMatch && <button type="button" style={st.editBtn} onClick={onToggleEdit}>닫기</button>}
          {hasMatch && <button type="button" style={st.clearBtn} onClick={onClear}>해제</button>}
        </div>
      );
    }
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%', minWidth: 0, whiteSpace: 'nowrap' }}>
        <span title={[row.displayName || row.prodName, row.counName, row.flowerName].filter(Boolean).join(' · ')} style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 700, color: '#1e40af' }}>
          {row.displayName || row.prodName}
        </span>
        {Number(row.customerUsageCount || 0) > 0 && (
          <span title={`이 업체의 기존 주문이력 ${row.customerUsageCount}회${Number(row.customerRecentUsageCount || 0) > 0 ? ` · 최근 ${row.customerRecentUsageCount}회` : ''}`} style={{ flex: '0 0 auto', fontSize: 9, color: '#166534', background: '#dcfce7', borderRadius: 7, padding: '1px 4px', fontWeight: 800 }}>
            업체이력 {row.customerUsageCount}
          </span>
        )}
        <button type="button" style={st.editBtn} onClick={onToggleEdit}>변경</button>
      </div>
    );
  }

  return (
    <div>
      {hasMatch && (
        <div style={{ marginBottom: editing ? 8 : 0 }}>
          <div style={{ fontWeight: 600, color: '#1e40af' }}>{row.displayName || row.prodName}</div>
          <div style={{ fontSize: 10, color: '#64748b' }}>{row.counName} · {row.flowerName}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
            <button type="button" style={st.editBtn} onClick={onToggleEdit}>
              {editing ? '닫기' : '✎ 품목 변경'}
            </button>
            {editing && (
              <button type="button" style={st.clearBtn} onClick={onClear}>매칭 해제</button>
            )}
          </div>
        </div>
      )}
      {(!hasMatch || editing) && (
        <ProductPicker
          row={row}
          allProducts={allProducts}
          onPick={onPick}
          onPersistMapping={onPersistMapping}
          compact={hasMatch}
        />
      )}
    </div>
  );
}

export default function OrderImportPage() {
  const [week, setWeek] = useState(getCurrentWeek());
  const [weeks, setWeeks] = useState([]);
  const [showOldWeeks, setShowOldWeeks] = useState(false);
  const [cust, setCust] = useState(null);
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [logs, setLogs] = useState([]);
  const [sheetPreview, setSheetPreview] = useState(null);
  const [registerLogs, setRegisterLogs] = useState([]);
  const [fileName, setFileName] = useState('');
  const [sourceType, setSourceType] = useState('');
  const [loading, setLoading] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [statementLoading, setStatementLoading] = useState(false);
  const [resultMsg, setResultMsg] = useState('');
  const [registeredResult, setRegisteredResult] = useState(null);
  const skipAllRef = useRef(null);
  const [defaultShipDates, setDefaultShipDates] = useState({ 1: '', 2: '' });
  const [shipmentRows, setShipmentRows] = useState([]);
  const [shipmentSource, setShipmentSource] = useState('upload');
  const [targetShipDate, setTargetShipDate] = useState('');
  const [moveQty, setMoveQty] = useState({});
  const [dragOver, setDragOver] = useState(false);
  const [allProducts, setAllProducts] = useState([]);
  const [editProdIdx, setEditProdIdx] = useState(null);
  const fileRef = useRef(null);

  const appendRegisterLog = useCallback((message, type = 'info') => {
    setRegisterLogs((prev) => [...prev, {
      id: `${Date.now()}-${prev.length}`,
      time: new Date().toLocaleTimeString('ko-KR', { hour12: false }),
      message,
      type,
    }]);
  }, []);

  useEffect(() => {
    const draft = loadImportDraft();
    if (!draft?.items?.length) return;
    setItems(draft.items);
    setSummary(draft.summary || null);
    setLogs(draft.logs || []);
    setFileName(draft.fileName || '');
    setSourceType(draft.sourceType || '');
    if (draft.week) setWeek(draft.week);
    if (draft.cust?.CustKey) setCust(draft.cust);
    setResultMsg(`💾 이전 매칭 ${draft.items.length}건 복원 (${draft.fileName || '업로드'})`);
  }, []);

  const loadDefaultCust = useCallback(async () => {
    const cd = await apiGet('/api/customers/search', { q: DEFAULT_CUST_SEARCH });
    const raum = (cd.customers || []).find(c => /라움/i.test(c.CustName));
    if (raum) return { CustKey: raum.CustKey, CustName: raum.CustName };
    return null;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const d = await apiGet('/api/products/search');
        setAllProducts(d.products || []);

        let nextCust = null;
        try {
          const saved = localStorage.getItem(IMPORT_CUST_STORAGE_KEY);
          if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed?.CustKey && parsed?.CustName) nextCust = parsed;
          }
        } catch { /* ignore */ }
        if (!nextCust) nextCust = await loadDefaultCust();
        if (nextCust) setCust(nextCust);
      } catch { /* ignore */ }
    })();
  }, [loadDefaultCust]);

  useEffect(() => {
    if (cust?.CustKey) {
      try {
        localStorage.setItem(IMPORT_CUST_STORAGE_KEY, JSON.stringify(cust));
      } catch { /* ignore */ }
    }
  }, [cust]);

  useEffect(() => {
    if (!items.length) return undefined;
    const timer = setTimeout(() => {
      saveImportDraft({
        items,
        summary,
        logs,
        fileName,
        sourceType,
        week,
        cust,
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [items, summary, logs, fileName, sourceType, week, cust]);

  useEffect(() => {
    apiGet('/api/orders/weeks').then((d) => {
      if (!d.success) return;
      const def = getCurrentWeek();
      const nearby = getNearby2026Weeks(4);
      const dbWeeks = (d.weeks || []).filter(w => !nearby.includes(w));
      setWeeks([...nearby, ...dbWeeks]);
      setWeek(def);
    }).catch(() => {
      setWeeks(getNearby2026Weeks(4));
    });
  }, []);

  const openTemplateWindow = useCallback(() => {
    const suffix = week ? `?week=${encodeURIComponent(week)}&popup=1` : '?popup=1';
    const popup = window.open(
      `/orders/paste-template${suffix}`,
      'pasteOrderTemplatePopup',
      'width=1440,height=920,left=30,top=20,resizable=yes,scrollbars=yes',
    );
    if (!popup) window.location.href = `/orders/paste-template${suffix}`;
  }, [week]);

  const handleStatementExcel = useCallback(async () => {
    if (!cust?.CustKey) {
      alert('거래처를 선택하세요.');
      return;
    }
    if (!week) {
      alert('차수를 선택하세요.');
      return;
    }

    const pw = parentWeekFromFullWeek(week);
    const printDate = new Date().toISOString().slice(0, 10);
    const weekLabel = pw || week;
    setStatementLoading(true);

    try {
      const gridRows = buildStatementRowsFromImportItems(
        mergeRegisterItems(items.filter(it => !it.skip && it.prodKey && Number(it.qty) > 0)),
        allProducts,
      );

      let rows = gridRows;
      let sourceLabel = '업로드 화면';

      if (!rows.length) {
        const d = await apiGet('/api/estimate/order-statement-rows', {
          custKey: cust.CustKey,
          orderYear: week.match(/^(\d{4})-/)?.[1] || '',
          parentWeek: pw,
          week: pw,
        });
        if (!d.success) throw new Error(d.error || '조회 실패');
        rows = d.rows || [];
        sourceLabel = '주문등록(DB)';
      }

      if (!rows.length) {
        alert('거래명세표로 내려받을 품목이 없습니다.\n업로드 후 매칭하거나, 해당 차수에 주문을 등록했는지 확인하세요.');
        return;
      }

      const sheetName = sanitizeExcelSheetName(cust.CustName);
      const wb = buildEstimatePrintWorkbook([{
        name: sheetName,
        worksheet: buildEstimatePrintWorksheet({
          custName: cust.CustName,
          week: `${weekLabel}차`,
          printDate,
          serialNo: '',
          printFormat: ESTIMATE_PRINT_FORMAT.STATEMENT,
          rows,
          showBoxQty: false,
          showDistribDesc: false,
          showDeductionOutDay: false,
          bigoLabel: `${weekLabel}차 종합거래명세표 (${sourceLabel})`,
        }),
      }]);

      downloadEstimatePrintWorkbook(
        wb,
        `거래명세표_${cust.CustName}_${weekLabel}차.xlsx`,
      );
    } catch (e) {
      alert(e.message || '거래명세표 다운로드 실패');
    } finally {
      setStatementLoading(false);
    }
  }, [allProducts, cust, items, week]);

  const resetDefaultCust = async () => {
    try {
      const next = await loadDefaultCust();
      if (next) setCust(next);
      else alert(`「${DEFAULT_CUST_SEARCH}」 거래처를 찾을 수 없습니다.`);
    } catch (e) {
      alert(e.message);
    }
  };

  const isDefaultCust = !!cust?.CustName && /라움/i.test(cust.CustName);

  const uploadFile = useCallback(async (file) => {
    if (!file) return;
    setLoading(true);
    setResultMsg('');
    setRegisteredResult(null);
    setSheetPreview(null);
    setRegisterLogs([]);
    const fd = new FormData();
    fd.append('file', file);
    if (cust?.CustKey) fd.append('custKey', String(cust.CustKey));
    if (cust?.CustName) fd.append('custName', cust.CustName);
    const selectedOrderYear = String(week || '').match(/^(\d{4})-/)?.[1];
    if (selectedOrderYear) fd.append('orderYear', selectedOrderYear);
    try {
      const res = await fetch('/api/orders/import-parse', {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      const d = await res.json();
      if (!d.success) {
        const detail = (d.logs || []).slice(-4).join('\n');
        throw new Error(detail ? `${d.error || '파싱 실패'}\n\n${detail}` : (d.error || '파싱 실패'));
      }
      setItems(d.items || []);
      setSummary(d.summary || null);
      setLogs(d.logs || []);
      setSheetPreview(d.sheetPreview || null);
      setFileName(d.fileName || file.name);
      setSourceType(d.sourceType || '');
      const meta = d.metadata || {};
      if (meta.majorWeek) {
        const year = new Date().getFullYear();
        setWeek(`${year}-${meta.majorWeek}-01`);
      }
      if (d.matchedCustomer?.CustKey) {
        setCust({ CustKey:d.matchedCustomer.CustKey, CustName:d.matchedCustomer.CustName });
        setResultMsg(`✅ 업체 자동매칭: ${d.matchedCustomer.CustName}${d.matchedCustomer.fromMapping ? ' (저장 매핑)' : ''}`);
      } else if (meta.customerName) {
        try {
          const found = await apiGet('/api/customers/search', { q: meta.customerName });
          const exact = (found.customers || []).find(c => String(c.CustName).replace(/\s/g, '') === String(meta.customerName).replace(/\s/g, ''));
          if (exact) setCust({ CustKey: exact.CustKey, CustName: exact.CustName });
          else setResultMsg(`⚠ 업체 자동매칭 실패: ${meta.customerName} — 업체를 직접 선택하세요.`);
        } catch { /* 사용자가 직접 선택 */ }
      }
      setEditProdIdx(null);
    } catch (e) {
      alert(e.message);
    } finally {
      setLoading(false);
    }
  }, [cust]);

  const prepareShipmentList = async () => {
    let sourceItems = items;
    if (shipmentSource !== 'upload') {
      if (!cust?.CustKey || !week) { alert('업체와 차수를 선택하세요.'); return; }
      try {
        const d = await apiGet('/api/orders/shipment-list-source', {
          source: shipmentSource, custKey:cust.CustKey,
          year:String(week).match(/^(\d{4})-/)?.[1] || new Date().getFullYear(), week,
        });
        sourceItems = (d.rows || []).map((r,i)=>({ rowNo:i+1,prodKey:r.ProdKey,prodName:r.ProdName,displayName:r.DisplayName,
          flowerName:r.FlowerName,counName:r.CounName,unit:normalizeOrderUnit(r.OutUnit),qty:Number(r.qty),unitPrice:Number(r.unitPrice||0) }));
      } catch (e) { alert(e.message); return; }
    }
    const rows = initializeShipDateAllocations(sourceItems, week, defaultShipDates);
    if (!rows.length) { alert('먼저 품목을 업로드하고 매칭하세요.'); return; }
    const no = Number(String(week).slice(-2));
    if (!defaultShipDates[no]) { alert(`${no}차 기본출고일을 먼저 설정하세요.`); return; }
    setShipmentRows(rows);
  };

  const moveRowDate = (idx, fromDate) => {
    try {
      setShipmentRows(prev => prev.map((row, i) => i === idx
        ? moveShipmentQuantity(row, fromDate, targetShipDate, moveQty[idx] || 1)
        : row));
    } catch (e) { alert(e.message); }
  };

  const downloadShipmentList = () => {
    const flat = buildShipmentListRows(shipmentRows);
    if (!flat.length || !cust?.CustName) { alert('생성할 출고내역이 없습니다.'); return; }
    const grouped = new Map();
    flat.sort((a,b) => a.shipDate.localeCompare(b.shipDate)).forEach(row => {
      const date = row.shipDate; const flower = row.flowerName || '기타';
      if (!grouped.has(date)) grouped.set(date, new Map());
      if (!grouped.get(date).has(flower)) grouped.get(date).set(flower, []);
      grouped.get(date).get(flower).push(row);
    });
    const aoa = [[`${cust.CustName} ${String(week).match(/-(\d{2})-/)?.[1] || ''}차 예상 출고리스트`], [], ['품 명','칼 라','주문수량','출고수량','단가','비 고']];
    const merges = [{s:{r:0,c:0},e:{r:0,c:5}}];
    for (const [date, flowers] of grouped) {
      const dateStart = aoa.length;
      for (const [flower, group] of flowers) {
        const flowerStart = aoa.length;
        group.forEach((row, idx) => aoa.push([idx ? '' : flower, row.color || row.displayName || row.prodName, row.totalQty, row.shipQty, row.unitPrice || '', '']));
        if (group.length > 1) merges.push({s:{r:flowerStart,c:0},e:{r:aoa.length-1,c:0}});
        aoa.push(['', '합계', group.reduce((s,r)=>s+r.totalQty,0), group.reduce((s,r)=>s+r.shipQty,0), '', '']);
      }
      const dateEnd = aoa.length - 1;
      const day = ['일','월','화','수','목','금','토'][new Date(`${date}T00:00:00`).getDay()];
      aoa[dateStart][5] = `${date} ${day}요일 출고`;
      if (dateEnd > dateStart) merges.push({s:{r:dateStart,c:5},e:{r:dateEnd,c:5}});
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!merges'] = merges;
    ws['!cols'] = [{wch:20},{wch:38},{wch:12},{wch:12},{wch:12},{wch:20}];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    XLSX.writeFile(wb, `${cust.CustName}_${week}_출고리스트.xlsx`);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) uploadFile(file);
  };

  const updateItem = (idx, patch) => {
    setItems(prev => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const handlePersistMapping = useCallback((row, prod) => {
    return persistItemMapping(row, prod, {
      force: true,
      custKey: cust?.CustKey || null,
      custName: cust?.CustName || '',
    });
  }, [cust?.CustKey, cust?.CustName]);

  const pickProduct = (idx, prod) => {
    const current = items[idx];
    const nextRow = {
      ...current,
      prodKey: prod.ProdKey,
      prodName: prod.ProdName,
      displayName: prod.DisplayName || prod.ProdName,
      flowerName: prod.FlowerName,
      counName: prod.CounName,
      unit: current?.unit || normalizeOrderUnit(prod.OutUnit || '박스'),
      fromMapping: false,
      mappingMatchType: 'manual',
      confidence: 1,
      confidenceLabel: 'high',
      mappingScope: cust?.CustKey ? 'customer' : 'global',
    };
    updateItem(idx, {
      prodKey: nextRow.prodKey,
      prodName: nextRow.prodName,
      displayName: nextRow.displayName,
      flowerName: nextRow.flowerName,
      counName: nextRow.counName,
      unit: nextRow.unit,
      fromMapping: false,
      mappingMatchType: 'manual',
      confidence: 1,
      confidenceLabel: 'high',
      mappingScope: nextRow.mappingScope,
    });
    setEditProdIdx(null);
  };

  const clearProduct = (idx) => {
    updateItem(idx, {
      prodKey: null,
      prodName: null,
      displayName: null,
      flowerName: null,
      counName: null,
      fromMapping: false,
      mappingMatchType: null,
      confidence: 0,
      confidenceLabel: 'none',
    });
    setEditProdIdx(idx);
  };

  const changeUnit = async (idx, unit) => {
    const row = items[idx];
    updateItem(idx, { unit, unitSource: 'manual', unitMatchType: 'manual' });
    if (row?.inputName) {
      try {
        await apiPost('/api/orders/import-units', {
          inputName: row.inputName,
          unit,
          source: 'manual',
        });
      } catch { /* ignore */ }
    }
  };

  const handleRegister = async () => {
    if (!cust?.CustKey) { alert('거래처를 선택하세요.'); return; }
    if (!week) { alert('차수를 입력하세요.'); return; }
    const registerItems = mergeRegisterItems(items.filter(it => !it.skip && it.prodKey && Number(it.qty) > 0));
    if (!registerItems.length) { alert('등록할 매칭 품목이 없습니다. (수량 0·미매칭·제외 행 확인)'); return; }

    const weekQuery = resolveOrderWeekQuery(week);
    if (!confirm(`${cust.CustName} / ${formatWeekDisplay(week)}\n업로드 ${registerItems.length}개 품목을 이 차수의 최종 주문수량으로 적용하시겠습니까?\n\n파일 안의 같은 품목 행은 합산해 최종수량이 됩니다. 파일에 없는 기존 주문 품목은 삭제 대상이며, 이미 출고분배가 있으면 전체 적용이 중단됩니다.`)) return;

    setRegistering(true);
    setResultMsg('');
    setRegisteredResult(null);
    setRegisterLogs([]);
    const skippedItems = items.filter(it => it.skip || !it.prodKey || Number(it.qty) <= 0);
    appendRegisterLog(`최종본 주문 적용 시작 — ${cust.CustName} / ${formatWeekDisplay(week)}`);
    appendRegisterLog(`파일 원본 ${matchedSourceRows.length}행 → 품목별 최종수량 ${registerItems.length}개 · 최종본 제외 ${skippedItems.length}행`);
    try {
      appendRegisterLog('서버 트랜잭션으로 기존 주문을 업로드 최종본에 맞추는 중입니다.');
      const d = await apiPost('/api/orders', {
        custKey: cust.CustKey,
        week,
        year: weekQuery.year,
        items: registerItems.map(it => ({
          prodKey: it.prodKey,
          prodName: it.prodName,
          qty: it.qty,
          unit: it.unit,
        })),
        orderMode: 'FINAL_SNAPSHOT',
        source: 'order-import-final',
      });
      if (!d.success) throw new Error(d.error || '저장 실패');
      const orderedApiResults = sortImportRowsByProductOrder(d.results, registerItems);
      const appliedCount = d.results?.filter(r => ['OK', 'UPDATED', 'ADDED', 'DELETED'].includes(r.status)).length ?? registerItems.length;
      const unchangedCount = d.results?.filter(r => r.status === 'UNCHANGED').length || 0;
      appendRegisterLog(`최종본 적용 완료 — 변경 ${appliedCount}품목 · 동일 ${unchangedCount}품목${d.warning ? ` · 경고: ${d.warning}` : ''}`, d.warning ? 'info' : 'success');
      setResultMsg(`✅ 최종본 적용 완료 — 변경 ${appliedCount}개 · 동일 ${unchangedCount}개 · OrderKey ${d.orderMasterKey}${d.warning ? ` / ⚠ ${d.warning}` : ''}`);
      setRegisteredResult(buildImportRegisterResult({
        apiResults: orderedApiResults,
        skippedItems,
        orderMasterKey: d.orderMasterKey,
        warning: d.warning,
      }));
      try {
        appendRegisterLog('저장된 주문을 DB에서 다시 읽어 최종값을 확인합니다.');
        const od = await apiGet('/api/orders', { custName: cust.CustName, week, year: weekQuery.year });
        const matched = pickImportRegisteredOrder(od.orders, cust.CustName, week);
        if (matched) {
          setRegisteredResult(buildImportRegisterResult({
            apiResults: orderedApiResults,
            dbOrder: { ...matched, items: sortImportRowsByProductOrder(matched.items, registerItems) },
            skippedItems,
            orderMasterKey: d.orderMasterKey,
            warning: d.warning,
          }));
          appendRegisterLog(`최종 확인 완료 — 현재 주문 ${matched.items?.length || 0}품목`, 'success');
        } else {
          appendRegisterLog('저장은 완료됐지만 DB 재조회에서 대상 주문을 찾지 못했습니다. 결과표의 저장 응답을 확인하세요.', 'error');
        }
      } catch (readError) {
        appendRegisterLog(`저장은 완료됐지만 DB 재조회에 실패했습니다 — ${readError.message || '조회 오류'}`, 'error');
      }
      clearImportDraft();
    } catch (e) {
      setResultMsg(`❌ ${e.message}`);
      appendRegisterLog(`주문등록 실패 — ${e.message}`, 'error');
    } finally {
      setRegistering(false);
    }
  };

  const matchAggregates = useMemo(() => buildImportMatchAggregates(items), [items]);
  const inlineMatchRows = useMemo(() => buildImportInlineMatchRows(items), [items]);
  const mixedUnitProducts = useMemo(() => findImportMixedUnitProducts(matchAggregates), [matchAggregates]);
  const matchedSourceRows = useMemo(() => items.flatMap((item) => {
    if (item.skip || !item.prodKey) return [];
    if (Array.isArray(item.sourceDetails) && item.sourceDetails.length) return item.sourceDetails.map(detail => Number(detail.rowNo));
    return [Number(item.rowNo)];
  }).filter(Number.isFinite), [items]);

  const liveSummary = useMemo(() => {
    const active = items.filter(it => !it.skip);
    const skipCounts = importSkipCounts(items);
    return {
      total: items.length,
      matched: active.filter(it => it.prodKey).length,
      registerable: active.filter(it => it.prodKey && Number(it.qty) > 0).length,
      unmatched: active.filter(it => !it.prodKey).length,
      skipped: skipCounts.skipped,
      allSkipped: skipCounts.allSkipped,
      noneSkipped: skipCounts.noneSkipped,
    };
  }, [items]);

  useEffect(() => {
    if (!skipAllRef.current) return;
    skipAllRef.current.indeterminate = items.length > 0 && !liveSummary.allSkipped && !liveSummary.noneSkipped;
  }, [items.length, liveSummary.allSkipped, liveSummary.noneSkipped]);

  const newWeeks = weeks.filter(w => w.match(/^\d{4}-/));
  const oldWeeks = weeks.filter(w => !w.match(/^\d{4}-/));

  return (
    <>
      <div style={st.page}>
        <div style={st.card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
            <div style={st.title}>📤 이미지 / 엑셀 업로드 주문등록</div>
            <button
              type="button"
              onClick={openTemplateWindow}
              style={{
                padding: '8px 18px',
                background: '#5e35b1',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 800,
                cursor: 'pointer',
                boxShadow: '0 2px 6px rgba(94,53,177,0.25)',
              }}
              title="새 창에서 원본 차수 주문 불러오기, 즐겨찾기 저장/수정, 등록대상 차수 주문등록"
            >
              주문즐겨찾기
            </button>
            <button
              type="button"
              onClick={handleStatementExcel}
              disabled={statementLoading || !cust?.CustKey}
              style={{
                ...st.btn,
                background: '#00897b',
                color: '#fff',
                opacity: statementLoading || !cust?.CustKey ? 0.55 : 1,
              }}
              title="업로드 화면 품목 또는 등록된 주문(ViewOrder) 기준 거래명세표 Excel"
            >
              {statementLoading ? '다운로드 중…' : '📥 거래명세표 Excel'}
            </button>
          </div>
          <div style={st.sub}>
            발주표(카톡 이미지·엑셀)를 먼저 업로드하면 제목의 <b>업체·차수</b>와 품목·단위를 자동매칭합니다.
            업로드 후 <b>업체·차수·수량·단위·품목</b>은 모두 수정할 수 있습니다.
          </div>

          <div
            style={{ ...st.drop, ...(dragOver ? st.dropActive : {}) }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv,image/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                const selected = e.target.files?.[0];
                e.target.value = '';
                uploadFile(selected);
              }}
            />
            {loading ? (
              <div style={{ color: '#1565c0', fontWeight: 600 }}>파싱·매칭 중…</div>
            ) : (
              <>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>1. 파일을 드래그하거나 클릭하여 업로드</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>xlsx · xls · csv · png · jpg · webp</div>
                {fileName && (
                  <div style={{ marginTop: 10, fontSize: 12, color: '#334155' }}>
                    최근: {fileName} ({sourceType === 'image' ? '이미지 OCR' : '엑셀'})
                  </div>
                )}
              </>
            )}
          </div>

          {items.length > 0 && <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#1a237e', marginBottom: 10 }}>2. 자동 매칭 결과 확인</div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ ...st.label, display: 'block', marginBottom: 6 }}>
              거래처
              <span style={{ fontWeight: 400, color: '#667085', fontSize: 11, marginLeft: 6 }}>
                기본 라움 · 검색으로 변경
              </span>
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <CustomerSearchSelect value={cust?.CustKey || ''} onChange={setCust} />
              {isDefaultCust && (
                <span style={{ fontSize: 11, fontWeight: 700, color: '#1a237e', background: '#e8eaf6', padding: '4px 10px', borderRadius: 10 }}>
                  기본: 라움
                </span>
              )}
              {!isDefaultCust && cust?.CustName && (
                <button
                  type="button"
                  onClick={resetDefaultCust}
                  style={{ ...st.btn, ...st.btnSecondary, fontSize: 11, padding: '5px 10px' }}
                >
                  ↺ 라움으로
                </button>
              )}
              {cust?.CustName && (
                <span style={{ fontSize: 12, color: '#334155', fontWeight: 600 }}>
                  선택: {cust.CustName}
                </span>
              )}
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ ...st.label, display: 'block', marginBottom: 6 }}>
              등록 차수
              <span style={{ fontWeight: 400, color: '#667085', fontSize: 11, marginLeft: 6 }}>
                주변 차수 선택 · 직접 입력 가능
              </span>
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: '#1a237e', fontWeight: 700, background: '#e8eaf6', padding: '2px 8px', borderRadius: 10 }}>2026</span>
              {newWeeks.map(w => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setWeek(w)}
                  style={{
                    padding: '5px 22px',
                    borderRadius: 20,
                    fontSize: 13,
                    cursor: 'pointer',
                    border: week === w ? '2px solid #1a237e' : '1px solid #c5cae9',
                    background: week === w ? '#1a237e' : '#f3f4ff',
                    color: week === w ? '#fff' : '#1a237e',
                    fontWeight: week === w ? 700 : 500,
                  }}
                >
                  {formatWeekDisplay(w)}
                </button>
              ))}
            </div>
            {oldWeeks.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowOldWeeks(v => !v)}
                  style={{ fontSize: 11, color: '#888', background: 'none', border: '1px solid #ddd', borderRadius: 10, padding: '2px 10px', cursor: 'pointer', marginBottom: 4 }}
                >
                  {showOldWeeks ? '▲' : '▼'} 이전 차수 (25년도) {oldWeeks.length}개
                </button>
                {showOldWeeks && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
                    {oldWeeks.map(w => (
                      <button
                        key={w}
                        type="button"
                        onClick={() => setWeek(w)}
                        style={{
                          padding: '4px 11px',
                          borderRadius: 20,
                          fontSize: 12,
                          cursor: 'pointer',
                          border: week === w ? '2px solid #888' : '1px solid #ddd',
                          background: week === w ? '#666' : '#f9f9f9',
                          color: week === w ? '#fff' : '#888',
                        }}
                      >
                        {formatWeekDisplay(w)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <input style={st.input} value={week} onChange={(e) => setWeek(e.target.value)} placeholder="2026-28-01" />
              {week && (
                <span style={{ fontSize: 12, color: '#1a237e', fontWeight: 600 }}>
                  선택: {formatWeekDisplay(week)}
                </span>
              )}
            </div>
          </div>

          <div style={{ ...st.row, padding: 10, background: '#f8fafc', border: '1px solid #dbe3ef', borderRadius: 7 }}>
            <strong style={{ fontSize: 12 }}>세부차수 기본출고일</strong>
            <label style={{ fontSize: 12 }}>1차 <input type="date" style={st.input} value={defaultShipDates[1]} onChange={e=>setDefaultShipDates(v=>({...v,1:e.target.value}))}/></label>
            <label style={{ fontSize: 12 }}>2차 <input type="date" style={st.input} value={defaultShipDates[2]} onChange={e=>setDefaultShipDates(v=>({...v,2:e.target.value}))}/></label>
            <span style={{fontSize:11,color:'#64748b'}}>매칭 수량은 선택 세부차수의 기본출고일에 전량 배정됩니다.</span>
          </div>
          </div>}

          {(summary || items.length > 0) && (
            <div style={st.kpi}>
              <div style={st.kpiBox}>전체 <b>{liveSummary.total}</b></div>
              <div style={st.kpiBox}>매칭 <b style={{ color: '#166534' }}>{liveSummary.matched}</b></div>
              <div style={st.kpiBox}>미매칭 <b style={{ color: liveSummary.unmatched ? '#c2410c' : '#166534' }}>{liveSummary.unmatched}</b></div>
              <div style={st.kpiBox}>제외 <b style={{ color: liveSummary.skipped ? '#b91c1c' : '#64748b' }}>{liveSummary.skipped}</b></div>
            </div>
          )}

          {resultMsg && (
            <div style={{ padding: 10, marginBottom: 10, borderRadius: 6, background: resultMsg.startsWith('✅') ? '#ecfdf5' : '#fef2f2', fontSize: 13 }}>
              {resultMsg}
            </div>
          )}

          {registeredResult && (
            <div style={{ ...st.card, border: '2px solid #2e7d32', background: '#f1f8e9', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                <strong style={{ fontSize: 14, color: '#2e7d32' }}>
                  📋 주문등록 결과
                  {registeredResult.custName ? ` — ${registeredResult.custName}` : ''}
                  {registeredResult.week ? ` / ${formatWeekDisplay(registeredResult.week)}` : ` / ${formatWeekDisplay(week)}`}
                </strong>
                {registeredResult.orderMasterKey ? (
                  <span style={{ fontSize: 11, color: '#33691e' }}>OrderKey {registeredResult.orderMasterKey}</span>
                ) : null}
                {registeredResult.skippedItems.length > 0 && (
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#ffebee', color: '#c62828' }}>
                    제외 {registeredResult.skippedItems.length}건은 등록하지 않음
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setRegisteredResult(null)}
                  style={{ marginLeft: 'auto', fontSize: 11, padding: '2px 8px', background: 'none', border: '1px solid #a5d6a7', borderRadius: 4, color: '#388e3c', cursor: 'pointer' }}
                >
                  닫기
                </button>
              </div>
              {registeredResult.writeRows.length > 0 && (
                <div style={{ overflowX: 'auto', marginBottom: registeredResult.dbItems.length ? 10 : 0 }}>
                  <table style={st.table}>
                    <thead>
                      <tr>
                        <th style={{ ...st.th, background: '#c8e6c9' }}>품목</th>
                        <th style={{ ...st.th, background: '#c8e6c9', textAlign: 'right' }}>이전</th>
                        <th style={{ ...st.th, background: '#c8e6c9', textAlign: 'right' }}>증감</th>
                        <th style={{ ...st.th, background: '#c8e6c9', textAlign: 'right' }}>최종</th>
                        <th style={{ ...st.th, background: '#c8e6c9' }}>단위</th>
                        <th style={{ ...st.th, background: '#c8e6c9' }}>상태</th>
                      </tr>
                    </thead>
                    <tbody>
                      {registeredResult.writeRows.map((row, i) => (
                        <tr key={`${row.prodKey || i}-${i}`}>
                          <td style={st.td}>{row.prodName || `품목#${row.prodKey}`}</td>
                          <td style={{ ...st.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{row.previousQty ?? '—'}</td>
                          <td style={{ ...st.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: Number(row.deltaQty) < 0 ? '#c62828' : '#1565c0' }}>
                            {row.deltaQty > 0 ? `+${row.deltaQty}` : (row.deltaQty ?? '—')}
                          </td>
                          <td style={{ ...st.td, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{row.finalQty ?? row.qty}</td>
                          <td style={st.td}>{row.unit || ''}</td>
                          <td style={st.td}>{importWriteStatusLabel(row.status)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {registeredResult.dbItems.length > 0 && (
                <>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#2e7d32', margin: '4px 0 6px' }}>현재 DB 주문 내역</div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={st.table}>
                      <thead>
                        <tr>
                          <th style={{ ...st.th, background: '#c8e6c9' }}>품목</th>
                          <th style={{ ...st.th, background: '#c8e6c9' }}>국가</th>
                          <th style={{ ...st.th, background: '#c8e6c9' }}>꽃</th>
                          <th style={{ ...st.th, background: '#c8e6c9', textAlign: 'right' }}>주문수량</th>
                          <th style={{ ...st.th, background: '#c8e6c9' }}>단위</th>
                        </tr>
                      </thead>
                      <tbody>
                        {registeredResult.dbItems.map((it, i) => (
                          <tr key={it.detailKey || `${it.prodKey}-${i}`}>
                            <td style={st.td}>{it.displayName || it.prodName}</td>
                            <td style={st.td}>{it.counName || '—'}</td>
                            <td style={st.td}>{it.flowerName || '—'}</td>
                            <td style={{ ...st.td, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{it.qty}</td>
                            <td style={st.td}>{it.unit || ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              {registeredResult.skippedItems.length > 0 && (
                <details style={{ marginTop: 8, fontSize: 12, color: '#7f1d1d' }}>
                  <summary>등록하지 않은 행 {registeredResult.skippedItems.length}건</summary>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                    {registeredResult.skippedItems.map((it, i) => (
                      <li key={`${it.inputName}-${i}`}>{it.inputName || it.prodName || '(이름없음)'} {it.qty}{it.unit || ''} — {it.reason}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          <RegisterProgressLog entries={registerLogs} running={registering} />

          {logs.length > 0 && (
            <details style={{ fontSize: 11, color: '#64748b', marginBottom: 10 }}>
              <summary>파싱 로그 ({logs.length})</summary>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {logs.map((l, i) => <li key={i}>{l}</li>)}
              </ul>
            </details>
          )}
        </div>

        <div style={{ ...st.card, border: '2px solid #00897b' }}>
          <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:10}}>
            <strong>📥 출고리스트 엑셀 만들기</strong>
            <select style={st.input} value={shipmentSource} onChange={e=>setShipmentSource(e.target.value)}>
              <option value="upload">업로드 매칭 기준</option><option value="order">선택 차수 주문등록 기준</option><option value="shipment">선택 차수 분배 기준</option>
            </select>
            <button type="button" style={{...st.btn,...st.btnPrimary}} onClick={prepareShipmentList}>수량 불러오기</button>
            <input type="date" style={st.input} value={targetShipDate} onChange={e=>setTargetShipDate(e.target.value)} title="이동할 출고일"/>
            <button type="button" style={{...st.btn,background:'#00897b',color:'#fff'}} disabled={!shipmentRows.length} onClick={downloadShipmentList}>엑셀 다운로드</button>
          </div>
          <div style={{fontSize:11,color:'#64748b',marginBottom:8}}>모든 수량은 기본출고일에 먼저 배정됩니다. 다른 날짜로 보낼 수량만 선택해 이동하세요.</div>
          {shipmentRows.map((row,idx)=><div key={`${row.prodKey}-${idx}`} style={{display:'grid',gridTemplateColumns:'minmax(240px,1fr) 1fr',gap:8,padding:'6px 0',borderBottom:'1px solid #eef2f7',fontSize:12}}>
            <div><b>{row.displayName || row.prodName}</b> · 총 {row.totalQty}{row.unit} <span style={{color:allocationTotal(row)===row.totalQty?'#166534':'#b91c1c'}}>배정 {allocationTotal(row)}</span></div>
            <div style={{display:'flex',gap:6,flexWrap:'wrap',justifyContent:'flex-end'}}>
              {Object.entries(row.allocations || {}).map(([date,qty])=><span key={date} style={{display:'inline-flex',alignItems:'center',gap:4}}>
                {date} <b>{qty}</b>
                <input type="number" min="0.001" max={qty} step="0.001" style={{...st.input,width:72}} value={moveQty[idx] ?? 1} onChange={e=>setMoveQty(v=>({...v,[idx]:e.target.value}))}/>
                <button type="button" style={{...st.btn,...st.btnSecondary,padding:'4px 7px'}} disabled={!targetShipDate || targetShipDate===date} onClick={()=>moveRowDate(idx,date)}>선택일로 보내기</button>
              </span>)}
            </div>
          </div>)}
        </div>

        {items.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.65fr) minmax(420px, 0.75fr)', gap: 12, alignItems: 'start' }}>
            <ExcelSheetPreview
              preview={sheetPreview}
              inlineRows={inlineMatchRows}
              allProducts={allProducts}
              editProdIdx={editProdIdx}
              onEditProdIdx={setEditProdIdx}
              onUpdateItem={updateItem}
              onChangeUnit={changeUnit}
              onPickProduct={pickProduct}
              onClearProduct={clearProduct}
              onPersistMapping={handlePersistMapping}
            />
          <div style={{ ...st.card, marginBottom: 0, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
              <strong style={{ fontSize: 14 }}>품목 매칭 결과 · 매칭 원본 {matchedSourceRows.length}행 → 합산 {matchAggregates.length}품목</strong>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  type="button"
                  style={{ ...st.btn, ...st.btnSecondary }}
                  disabled={!items.length}
                  onClick={() => setItems(setImportItemsSkip(items, true))}
                  title="매칭된 품목도 포함해 모두 주문등록에서 뺍니다"
                >
                  전체 제외
                </button>
                <button
                  type="button"
                  style={{ ...st.btn, ...st.btnSecondary }}
                  disabled={!items.length || liveSummary.noneSkipped}
                  onClick={() => setItems(setImportItemsSkip(items, false))}
                >
                  전체 제외 해제
                </button>
                <button
                  type="button"
                  style={{ ...st.btn, ...st.btnPrimary, opacity: liveSummary.unmatched || mixedUnitProducts.length || registering || !liveSummary.registerable ? 0.6 : 1 }}
                  disabled={!!liveSummary.unmatched || !!mixedUnitProducts.length || registering || !liveSummary.registerable}
                  onClick={handleRegister}
                  title={liveSummary.unmatched ? '미매칭 품목을 먼저 지정하거나 제외하세요' : (mixedUnitProducts.length ? '같은 품목에 서로 다른 단위가 매칭되었습니다' : (!liveSummary.registerable ? '등록할 품목이 없습니다' : ''))}
                >
                  {registering ? '주문등록 처리 중…' : `주문등록 시작 (${matchAggregates.length}품목)`}
                </button>
              </div>
            </div>

            {mixedUnitProducts.length > 0 && (
              <div style={{ padding: 9, marginBottom: 10, borderRadius: 6, background: '#fef2f2', color: '#b91c1c', fontSize: 12, fontWeight: 700 }}>
                같은 품목에 서로 다른 단위가 있습니다. 상세 행에서 단위를 통일한 뒤 등록하세요.
              </div>
            )}
            <MatchAggregateTable rows={matchAggregates} />

            <details style={{ border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff' }}>
              <summary style={{ padding: '9px 10px', cursor: 'pointer', fontWeight: 700, color: '#334155', background: '#f8fafc' }}>
                전체 상세 편집표 열기 · 입력 품목명/추천 후보 확인
              </summary>
            <div style={{ overflowX: 'auto', padding: '0 8px 8px' }}>
              <table style={st.table}>
                <thead>
                  <tr>
                    <th style={st.th}>#</th>
                    <th style={st.th}>입력 품목 / 품종·세부정보</th>
                    <th style={st.th}>수량</th>
                    <th style={st.th}>단위</th>
                    <th style={st.th}>매칭 품목</th>
                    <th style={st.th}>상태</th>
                    <th style={st.th}>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                        제외
                        <input
                          ref={skipAllRef}
                          type="checkbox"
                          checked={!!items.length && liveSummary.allSkipped}
                          onChange={(e) => setItems(setImportItemsSkip(items, e.target.checked))}
                          title="전체 제외 / 전체 제외 해제"
                        />
                      </label>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row, idx) => (
                    <tr key={`${row.rowNo}-${row.inputName}`} style={{ background: row.skip ? '#f8fafc' : row.prodKey ? '#fff' : '#fffbeb', height: 30 }}>
                      <td style={{ ...st.td, padding: '2px 4px', whiteSpace: 'nowrap' }}>{row.rowNo}</td>
                      <td style={{ ...st.td, padding: '2px 4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, whiteSpace: 'nowrap' }}>
                          <input
                            type="text"
                            style={{ ...st.input, width: '100%', minWidth: 120, height: 24, padding: '2px 5px', boxSizing: 'border-box', fontWeight: 600 }}
                            value={row.inputName}
                            onChange={(e) => {
                              updateItem(idx, clearImportProductMatchForName(row, e.target.value));
                              setEditProdIdx(idx);
                            }}
                            title="발주표 품목명 (수정 가능)"
                          />
                          {Array.isArray(row.detailLabels) && row.detailLabels.length > 0 && (
                            <span title={row.detailLabels.join(' · ')} style={{ maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 9, color: '#475569', background: '#eef2f7', padding: '1px 4px', borderRadius: 8 }}>
                              세부 {row.detailLabels.length}건
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ ...st.td, padding: '2px 4px' }}>
                        <input
                          type="number"
                          min={0}
                          style={{ ...st.input, width: 74, height: 24, padding: '2px 5px' }}
                          value={row.qty}
                          onChange={(e) => {
                            const v = e.target.value;
                            updateItem(idx, { qty: v === '' ? '' : Math.max(0, Number(v) || 0) });
                          }}
                          onBlur={(e) => {
                            if (e.target.value === '' || Number(e.target.value) <= 0) {
                              updateItem(idx, { qty: 0 });
                            }
                          }}
                        />
                      </td>
                      <td style={{ ...st.td, padding: '2px 4px', whiteSpace: 'nowrap' }}>
                        <select
                          style={{ ...st.input, height: 24, padding: '2px 4px' }}
                          value={row.unit || '박스'}
                          onChange={(e) => changeUnit(idx, e.target.value)}
                        >
                          {['박스', '단', '송이'].map(u => <option key={u} value={u}>{u}</option>)}
                        </select>
                        {row.unitSource && <span title={`${unitSourceLabel(row.unitSource)}${row.unitMatchType === 'fuzzy' ? ' (유사)' : ''}${row.rawUnit && row.rawUnit !== row.unit ? ` · 원본 ${row.rawUnit}` : ''}`} style={{ marginLeft: 3, fontSize: 9, color: '#0369a1' }}>ⓘ</span>}
                      </td>
                      <td style={{ ...st.td, padding: '2px 4px' }}>
                        <ProductMatchCell
                          row={row}
                          idx={idx}
                          allProducts={allProducts}
                          editing={editProdIdx === idx}
                          onToggleEdit={() => setEditProdIdx(editProdIdx === idx ? null : idx)}
                          onPick={(p) => pickProduct(idx, p)}
                          onClear={() => clearProduct(idx)}
                          onPersistMapping={handlePersistMapping}
                          compact
                        />
                      </td>
                      <td style={{ ...st.td, padding: '2px 4px', whiteSpace: 'nowrap' }}>
                        {row.skip ? <span style={st.badgeErr}>제외</span>
                          : !row.prodKey ? <span style={st.badgeWarn}>미매칭</span>
                            : Number(row.qty) <= 0 ? <span style={st.badgeWarn}>수량0</span>
                              : row.fromMapping ? <span style={st.badgeOk}>저장매칭</span>
                                : row.mappingMatchType === 'manual' ? <span style={st.badgeOk}>수동</span>
                                  : row.confidenceLabel === 'high' ? <span style={st.badgeOk}>자동</span>
                                    : <span style={st.badgeOk}>자동</span>}
                      </td>
                      <td style={{ ...st.td, padding: '2px 4px' }}>
                        <input type="checkbox" checked={!!row.skip} onChange={(e) => updateItem(idx, { skip: e.target.checked })} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </details>
          </div>
          </div>
        )}

      </div>
    </>
  );
}
