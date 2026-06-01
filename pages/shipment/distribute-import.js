import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout';
import { useWeekInput } from '../../lib/useWeekInput';

const fmt = n => Number(n || 0).toLocaleString('ko-KR');
const fmtUpload = r => Number(r.quantityMultiplier || 1) > 1
  ? `${fmt(r.uploadQty)} (${fmt(r.excelQty)}×${fmt(r.quantityMultiplier)})`
  : fmt(r.uploadQty);
const hasQtyDiff = n => Math.abs(Number(n || 0)) > 0.0001;
const statusText = status => status === '주문없음' ? '신규추가' : status;
const rowChanged = r => r?.status !== '동일';
const orderChanged = r => hasQtyDiff(r?.orderDiffQty) || r?.status === '주문없음';
const shipmentDiffQty = r => Number(r?.shipmentDiffQty ?? (Number(r?.uploadQty || 0) - Number(r?.currentOutQty || 0)));
const shipmentNeedsApply = r => hasQtyDiff(shipmentDiffQty(r));
const applyTarget = r => rowChanged(r) || shipmentNeedsApply(r);
const rowStatusText = r => r?.status === '동일' && shipmentNeedsApply(r) ? '분배반영' : statusText(r?.status);
const rowBg = r => r?.status === '주문없음' ? '#eff6ff' : rowChanged(r) ? '#fff7ed' : shipmentNeedsApply(r) ? '#f0fdf4' : '#fff';

function buildPivotModel(sourceRows) {
  const customers = new Map();
  const products = new Map();
  for (const r of sourceRows || []) {
    const custKey = String(r.custKey || r.custName || '');
    const prodKey = String(r.prodKey || r.prodName || '');
    if (!custKey || !prodKey) continue;
    if (!customers.has(custKey)) {
      customers.set(custKey, {
        key: custKey,
        name: r.custName,
        orderQty: 0,
        currentOutQty: 0,
        uploadQty: 0,
        changeQty: 0,
        shipmentDiffQty: 0,
        changedLines: 0,
        shipmentChangedLines: 0,
      });
    }
    if (!products.has(prodKey)) {
      products.set(prodKey, {
        key: prodKey,
        name: r.displayName || r.prodName,
        prodName: r.prodName,
        outUnit: r.outUnit,
        orderQty: 0,
        currentOutQty: 0,
        uploadQty: 0,
        changeQty: 0,
        shipmentDiffQty: 0,
        changedLines: 0,
        shipmentChangedLines: 0,
        cells: new Map(),
      });
    }
    const c = customers.get(custKey);
    const p = products.get(prodKey);
    c.orderQty += Number(r.orderQty || 0);
    c.currentOutQty += Number(r.currentOutQty || 0);
    c.uploadQty += Number(r.uploadQty || 0);
    c.changeQty += Number(r.changeQty || 0);
    c.shipmentDiffQty += shipmentDiffQty(r);
    p.orderQty += Number(r.orderQty || 0);
    p.currentOutQty += Number(r.currentOutQty || 0);
    p.uploadQty += Number(r.uploadQty || 0);
    p.changeQty += Number(r.changeQty || 0);
    p.shipmentDiffQty += shipmentDiffQty(r);
    if (rowChanged(r)) {
      c.changedLines += 1;
      p.changedLines += 1;
    }
    if (applyTarget(r)) {
      c.shipmentChangedLines += 1;
      p.shipmentChangedLines += 1;
    }
    p.cells.set(custKey, r);
  }
  return {
    customers: [...customers.values()],
    products: [...products.values()],
  };
}

export default function DistributeImport() {
  const router = useRouter();
  const weekInput = useWeekInput('');
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [filter, setFilter] = useState('apply');
  const [viewMode, setViewMode] = useState('pivot');

  const rows = preview?.rows || [];
  const changedRows = useMemo(() => rows.filter(r => r.status !== '동일'), [rows]);
  const orderlessRows = useMemo(() => changedRows.filter(r => r.status === '주문없음'), [changedRows]);
  const orderChangeRows = useMemo(() => changedRows.filter(orderChanged), [changedRows]);
  const applyRows = useMemo(() => rows.filter(applyTarget), [rows]);
  const visibleRows = useMemo(() => {
    const base = filter === 'apply' ? applyRows : filter === 'changed' ? changedRows : filter === 'unmatched' ? [] : rows;
    return base.slice(0, 1000);
  }, [rows, applyRows, changedRows, filter]);
  const pivotModel = useMemo(() => {
    const source = filter === 'apply' ? applyRows : filter === 'changed' ? changedRows : rows;
    return buildPivotModel(source);
  }, [rows, applyRows, changedRows, filter]);

  useEffect(() => {
    if (!router.isReady) return;
    const qWeek = Array.isArray(router.query.week) ? router.query.week[0] : router.query.week;
    if (qWeek) weekInput.setValue(String(qWeek));
  }, [router.isReady, router.query.week]);

  const handlePreview = async () => {
    if (!weekInput.value) { setError('차수를 입력하세요.'); return; }
    if (!file) { setError('업로드할 엑셀 파일을 선택하세요.'); return; }
    setLoading(true); setError(''); setMessage(''); setPreview(null);
    try {
      const form = new FormData();
      form.append('week', weekInput.value);
      form.append('file', file);
      const res = await fetch('/api/shipment/distribute-import-preview', { method: 'POST', body: form });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '검증 실패');
      setPreview(data);
      setFilter('apply');
      const orderless = (data.changedRows || []).filter(r => r.status === '주문없음').length;
      const orderChanges = (data.changedRows || []).filter(orderChanged).length;
      const applyCount = (data.rows || []).filter(applyTarget).length;
      setMessage(`검증 완료: 신규추가 ${orderless}건, 주문변경 ${data.changedRows?.length || 0}건, 분배반영 ${applyCount}건, 미매칭 ${data.unmatched?.length || 0}건`);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    if (!preview) return;
    if ((preview.unmatched || []).length > 0) {
      setError('미매칭 행이 있습니다. 품목/업체 매칭을 먼저 확인하세요.');
      return;
    }
    if (!applyRows.length) {
      setError('적용할 주문변경/분배반영 대상이 없습니다.');
      return;
    }
    const orderCreateText = orderlessRows.length ? `\n신규추가 ${orderlessRows.length}건은 주문등록을 먼저 만든 뒤 분배합니다.` : '';
    const orderChangeText = orderChangeRows.length ? `\n기존 주문수량 변경 ${orderChangeRows.length}건은 엑셀 최종 수량으로 동기화합니다.` : '';
    if (!confirm(`${preview.week}차 검증 결과를 일괄 주문등록 및 출고분배로 적용하시겠습니까?\n적용대상 ${applyRows.length}건 / 주문변경 ${changedRows.length}건${orderCreateText}${orderChangeText}`)) return;
    setApplying(true); setError(''); setMessage('');
    try {
      const res = await fetch('/api/shipment/distribute-import-apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week: preview.week, rows: applyRows }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '적용 실패');
      setMessage(`적용 완료: 신규추가 ${data.orderCreatedCount || 0}건, 주문수정 ${data.orderUpdatedCount || 0}건, 주문삭제 ${data.orderDeletedCount || 0}건, 분배 ${data.shipmentChangedCount || 0}건`);
      await handlePreview();
    } catch (e) {
      setError(e.message);
    } finally {
      setApplying(false);
    }
  };

  return (
    <Layout>
      <div style={st.page}>
        <div style={st.toolbar}>
          <div>
            <h1 style={st.title}>출고분배 엑셀 검증 업로드</h1>
            <div style={st.sub}>차수피벗 출고리스트 또는 분류프로그램 물량표를 읽어 기존 주문등록 수량 기준으로 변경을 검증합니다.</div>
          </div>
          <div style={st.controls}>
            <button onClick={weekInput.prevWeek} style={st.iconBtn}>◁</button>
            <button onClick={weekInput.prev} style={st.iconBtn}>‹</button>
            <input {...weekInput.props} style={st.weekInput} placeholder="22-01" />
            <button onClick={weekInput.next} style={st.iconBtn}>›</button>
            <button onClick={weekInput.nextWeek} style={st.iconBtn}>▷</button>
          </div>
        </div>

        <div style={st.uploadBand}>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            style={{ display: 'none' }}
            onChange={e => setFile(e.target.files?.[0] || null)}
          />
          <button style={st.secondaryBtn} onClick={() => fileRef.current?.click()}>파일 선택</button>
          <span style={st.fileName}>{file ? file.name : '차수피벗 출고리스트 또는 분류프로그램 결과 물량표 엑셀을 선택하세요'}</span>
          <button style={st.primaryBtn} onClick={handlePreview} disabled={loading}>{loading ? '읽는 중...' : '검증하기'}</button>
          <button style={st.applyBtn} onClick={handleApply} disabled={applying || !preview}>{applying ? '적용 중...' : '승인 후 주문등록+분배'}</button>
        </div>

        {error && <div style={st.error}>{error}</div>}
        {message && <div style={st.message}>{message}</div>}

        {preview && (
          <>
            <div style={st.kpis}>
              <Kpi label="전체 표시" value={rows.length} />
              <Kpi label="주문변경" value={changedRows.length} warn={changedRows.length > 0} />
              <Kpi label="분배반영" value={applyRows.length} warn={applyRows.length > changedRows.length} />
              <Kpi label="신규추가" value={orderlessRows.length} warn={orderlessRows.length > 0} />
              <Kpi label="미매칭" value={preview.unmatched?.length || 0} danger={(preview.unmatched?.length || 0) > 0} />
            </div>

            <div style={st.grid}>
              <section style={st.panel}>
                <div style={st.panelHead}>
                  <strong>검증 로그</strong>
                </div>
                <div style={st.logBox}>
                  {(preview.logs || []).map((l, i) => <div key={i}>{l}</div>)}
                </div>
              </section>
              <section style={st.panel}>
                <div style={st.panelHead}>
                  <strong>업체별 합계</strong>
                </div>
                <div style={st.tableWrap}>
                  <table style={st.table}>
                    <thead><tr><th>업체</th><th>주문등록</th><th>현재분배</th><th>엑셀수량</th><th>주문변경</th><th>분배차이</th><th>변경품목</th></tr></thead>
                    <tbody>
                      {(preview.summaryByCustomer || []).map(r => (
                        <tr key={r.custName}>
                          <td>{r.custName}</td><td>{fmt(r.orderQty)}</td><td>{fmt(r.currentOutQty)}</td>
                          <td>{fmt(r.uploadQty)}</td><td style={{ color: r.changeQty ? '#b45309' : '#475569' }}>{fmt(r.changeQty)}</td>
                          <td style={{ color: r.shipmentDiffQty ? '#15803d' : '#475569' }}>{fmt(r.shipmentDiffQty)}</td><td>{r.changedLines}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            <div style={st.panel}>
              <div style={st.panelHead}>
                <strong>업체별 품목 수량 비교</strong>
                <div style={st.panelActions}>
                  {filter !== 'unmatched' && (
                    <div style={st.segment}>
                      <button onClick={() => setViewMode('pivot')} style={viewMode === 'pivot' ? st.segOn : st.seg}>피벗보기</button>
                      <button onClick={() => setViewMode('list')} style={viewMode === 'list' ? st.segOn : st.seg}>상세목록</button>
                    </div>
                  )}
                  <div style={st.segment}>
                    <button onClick={() => setFilter('apply')} style={filter === 'apply' ? st.segOn : st.seg}>적용대상</button>
                    <button onClick={() => setFilter('changed')} style={filter === 'changed' ? st.segOn : st.seg}>주문변경만</button>
                    <button onClick={() => setFilter('all')} style={filter === 'all' ? st.segOn : st.seg}>전체</button>
                    <button onClick={() => setFilter('unmatched')} style={filter === 'unmatched' ? st.segOn : st.seg}>미매칭</button>
                  </div>
                </div>
              </div>
              {filter === 'unmatched' ? (
                <SimpleUnmatched rows={preview.unmatched || []} />
              ) : viewMode === 'pivot' ? (
                <PivotComparison model={pivotModel} />
              ) : (
                <div style={st.tableWrapLarge}>
                  <table style={st.table}>
                    <thead>
                      <tr><th>상태</th><th>업체</th><th>품목</th><th>단위</th><th>주문등록</th><th>현재분배</th><th>엑셀수량</th><th>주문변경</th><th>분배차이</th><th>셀</th></tr>
                    </thead>
                    <tbody>
                      {visibleRows.map(r => (
                        <tr key={r.key} style={{ background: rowBg(r) }}>
                          <td>{rowStatusText(r)}</td><td>{r.custName}</td><td>{r.displayName || r.prodName}</td><td>{r.outUnit}</td>
                          <td>{fmt(r.orderQty)}</td><td>{fmt(r.currentOutQty)}</td><td>{fmtUpload(r)}</td>
                          <td>{fmt(r.changeQty)}</td><td>{fmt(shipmentDiffQty(r))}</td><td>{(r.cells || []).slice(0, 2).join(', ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      <style jsx global>{`
        table th {
          position: sticky;
          top: 0;
          z-index: 1;
          background: #f1f5f9;
          color: #334155;
          font-weight: 700;
        }
        table th, table td {
          border-bottom: 1px solid #e2e8f0;
          padding: 7px 8px;
          text-align: left;
          white-space: nowrap;
        }
        table td:nth-child(n+4), table th:nth-child(n+4) {
          text-align: right;
        }
        button:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
      `}</style>
    </Layout>
  );
}

function PivotComparison({ model }) {
  if (!model.products.length) {
    return <div style={{ padding: 18, color: '#64748b' }}>표시할 품목 수량이 없습니다.</div>;
  }
  const totals = model.customers.reduce((acc, c) => {
    acc.orderQty += c.orderQty;
    acc.currentOutQty += c.currentOutQty;
    acc.uploadQty += c.uploadQty;
    acc.changeQty += c.changeQty;
    acc.shipmentDiffQty += c.shipmentDiffQty;
    return acc;
  }, { orderQty: 0, currentOutQty: 0, uploadQty: 0, changeQty: 0, shipmentDiffQty: 0 });
  return (
    <div style={st.pivotWrap}>
      <table style={st.pivotTable}>
        <thead>
          <tr>
            <th style={{ ...st.pivotStickyHead, minWidth: 230 }}>품목</th>
            {model.customers.map(c => (
              <th key={c.key} style={st.pivotCustHead}>
                <div style={st.custName}>{c.name}</div>
                <div style={st.custMeta}>엑셀 {fmt(c.uploadQty)} / 주문변경 {fmt(c.changeQty)}</div>
              </th>
            ))}
            <th style={st.pivotTotalHead}>주문등록</th>
            <th style={st.pivotTotalHead}>현재분배</th>
            <th style={st.pivotTotalHead}>엑셀수량</th>
            <th style={st.pivotTotalHead}>주문변경</th>
            <th style={st.pivotTotalHead}>분배차이</th>
          </tr>
        </thead>
        <tbody>
          {model.products.map(p => (
            <tr key={p.key}>
              <td style={st.pivotProductCell}>
                <div style={{ fontWeight: 700 }}>{p.name}</div>
                <div style={{ fontSize: 11, color: '#64748b' }}>{p.outUnit || '박스'} · 주문변경 {p.changedLines}건</div>
              </td>
              {model.customers.map(c => {
                const r = p.cells.get(c.key);
                if (!r) return <td key={c.key} style={st.pivotEmptyCell} />;
                const changed = rowChanged(r);
                const orderDiff = orderChanged(r);
                const shipDiff = shipmentNeedsApply(r);
                return (
                  <td key={c.key} style={{
                    ...st.pivotQtyCell,
                    background: rowBg(r),
                    borderColor: changed ? '#fdba74' : shipDiff ? '#86efac' : '#e2e8f0',
                  }}>
                    <div style={{ ...st.qtyMain, color: changed ? '#9a3412' : '#0f172a' }}>
                      {fmtUpload(r)}
                    </div>
                    {orderDiff && (
                      <div style={{ ...st.qtySub, color: '#b45309' }}>
                        주문 {fmt(r.orderQty)} → {fmt(r.uploadQty)}
                      </div>
                    )}
                    {shipDiff && (
                      <div style={{ ...st.qtySub, color: '#15803d' }}>
                        분배 {fmt(r.currentOutQty)} → {fmt(r.uploadQty)}
                      </div>
                    )}
                    {r.status === '주문없음' && <div style={st.createBadge}>신규추가</div>}
                  </td>
                );
              })}
              <td style={st.totalCell}>{fmt(p.orderQty)}</td>
              <td style={st.totalCell}>{fmt(p.currentOutQty)}</td>
              <td style={st.totalCellStrong}>{fmt(p.uploadQty)}</td>
              <td style={{ ...st.totalCellStrong, color: p.changeQty ? '#b45309' : '#475569' }}>{fmt(p.changeQty)}</td>
              <td style={{ ...st.totalCellStrong, color: p.shipmentDiffQty ? '#15803d' : '#475569' }}>{fmt(p.shipmentDiffQty)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td style={st.pivotProductCell}>합계</td>
            {model.customers.map(c => (
              <td key={c.key} style={st.totalCellStrong}>{fmt(c.uploadQty)}</td>
            ))}
            <td style={st.totalCellStrong}>{fmt(totals.orderQty)}</td>
            <td style={st.totalCellStrong}>{fmt(totals.currentOutQty)}</td>
            <td style={st.totalCellStrong}>{fmt(totals.uploadQty)}</td>
            <td style={{ ...st.totalCellStrong, color: totals.changeQty ? '#b45309' : '#475569' }}>{fmt(totals.changeQty)}</td>
            <td style={{ ...st.totalCellStrong, color: totals.shipmentDiffQty ? '#15803d' : '#475569' }}>{fmt(totals.shipmentDiffQty)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Kpi({ label, value, warn, danger }) {
  return (
    <div style={{ ...st.kpi, borderColor: danger ? '#ef4444' : warn ? '#f59e0b' : '#dbe3ef' }}>
      <span>{label}</span>
      <strong style={{ color: danger ? '#dc2626' : warn ? '#b45309' : '#0f172a' }}>{fmt(value)}</strong>
    </div>
  );
}

function SimpleUnmatched({ rows }) {
  return (
    <div style={st.tableWrapLarge}>
      <table style={st.table}>
        <thead><tr><th>사유</th><th>시트</th><th>행</th><th>업체 라벨</th><th>품목 라벨</th><th>수량</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ background: '#fee2e2' }}>
              <td>{r.reason}</td><td>{r.sheetName}</td><td>{r.rowNo}</td><td>{r.customerLabel}</td><td>{r.productLabel}</td><td>{fmt(r.uploadQty)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const st = {
  page: { padding: 18, maxWidth: 1600, margin: '0 auto' },
  toolbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 12 },
  title: { margin: 0, fontSize: 22, color: '#0f172a' },
  sub: { marginTop: 4, fontSize: 13, color: '#64748b' },
  controls: { display: 'flex', alignItems: 'center', gap: 4 },
  iconBtn: { width: 32, height: 32, border: '1px solid #cbd5e1', background: '#fff', borderRadius: 6, cursor: 'pointer' },
  weekInput: { width: 104, height: 32, border: '1px solid #cbd5e1', borderRadius: 6, textAlign: 'center', fontWeight: 700 },
  uploadBand: { display: 'flex', alignItems: 'center', gap: 8, padding: 12, border: '1px solid #dbe3ef', background: '#f8fafc', borderRadius: 8, marginBottom: 12 },
  fileName: { flex: 1, color: '#475569', fontSize: 13 },
  secondaryBtn: { height: 34, padding: '0 14px', border: '1px solid #cbd5e1', background: '#fff', borderRadius: 6, cursor: 'pointer' },
  primaryBtn: { height: 34, padding: '0 16px', border: 0, background: '#2563eb', color: '#fff', borderRadius: 6, cursor: 'pointer', fontWeight: 700 },
  applyBtn: { height: 34, padding: '0 16px', border: 0, background: '#15803d', color: '#fff', borderRadius: 6, cursor: 'pointer', fontWeight: 700 },
  error: { padding: 10, background: '#fee2e2', color: '#991b1b', borderRadius: 6, marginBottom: 10 },
  message: { padding: 10, background: '#dcfce7', color: '#166534', borderRadius: 6, marginBottom: 10 },
  kpis: { display: 'grid', gridTemplateColumns: 'repeat(5, minmax(120px, 1fr))', gap: 10, marginBottom: 12 },
  kpi: { background: '#fff', border: '1px solid #dbe3ef', borderRadius: 8, padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  grid: { display: 'grid', gridTemplateColumns: 'minmax(320px, 0.8fr) minmax(460px, 1.2fr)', gap: 12, marginBottom: 12 },
  panel: { border: '1px solid #dbe3ef', borderRadius: 8, background: '#fff', overflow: 'hidden' },
  panelHead: { minHeight: 42, padding: '0 12px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  logBox: { padding: 12, height: 220, overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 12, lineHeight: 1.55, background: '#0f172a', color: '#e2e8f0' },
  tableWrap: { height: 220, overflow: 'auto' },
  tableWrapLarge: { maxHeight: 560, overflow: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  panelActions: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' },
  segment: { display: 'flex', gap: 4 },
  seg: { border: '1px solid #cbd5e1', background: '#fff', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' },
  segOn: { border: '1px solid #2563eb', background: '#2563eb', color: '#fff', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' },
  pivotWrap: { maxHeight: 640, overflow: 'auto', background: '#fff' },
  pivotTable: { width: 'max-content', minWidth: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 12 },
  pivotStickyHead: { position: 'sticky', top: 0, left: 0, zIndex: 4, background: '#e2e8f0', color: '#0f172a', borderRight: '1px solid #cbd5e1', borderBottom: '1px solid #cbd5e1', padding: '8px 10px', textAlign: 'left' },
  pivotCustHead: { position: 'sticky', top: 0, zIndex: 3, minWidth: 132, maxWidth: 150, background: '#e2e8f0', color: '#0f172a', borderRight: '1px solid #cbd5e1', borderBottom: '1px solid #cbd5e1', padding: '7px 8px', textAlign: 'center', verticalAlign: 'top' },
  pivotTotalHead: { position: 'sticky', top: 0, zIndex: 3, minWidth: 90, background: '#cbd5e1', color: '#0f172a', borderRight: '1px solid #94a3b8', borderBottom: '1px solid #94a3b8', padding: '7px 8px', textAlign: 'right' },
  pivotProductCell: { position: 'sticky', left: 0, zIndex: 2, minWidth: 230, maxWidth: 260, background: '#f8fafc', color: '#0f172a', borderRight: '1px solid #cbd5e1', borderBottom: '1px solid #e2e8f0', padding: '8px 10px', textAlign: 'left', whiteSpace: 'normal' },
  pivotQtyCell: { minWidth: 132, maxWidth: 150, borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0', padding: '6px 8px', textAlign: 'right', verticalAlign: 'top' },
  pivotEmptyCell: { minWidth: 132, borderRight: '1px solid #f1f5f9', borderBottom: '1px solid #f1f5f9', background: '#fff' },
  qtyMain: { fontWeight: 800, fontVariantNumeric: 'tabular-nums' },
  qtySub: { marginTop: 2, fontSize: 10, color: '#64748b', fontVariantNumeric: 'tabular-nums' },
  createBadge: { marginTop: 3, display: 'inline-block', fontSize: 10, color: '#1d4ed8', background: '#dbeafe', borderRadius: 8, padding: '1px 6px', fontWeight: 700 },
  custName: { fontWeight: 700, lineHeight: 1.25, whiteSpace: 'normal' },
  custMeta: { marginTop: 3, fontSize: 10, color: '#64748b', fontWeight: 500, whiteSpace: 'normal' },
  totalCell: { minWidth: 90, borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0', padding: '7px 8px', textAlign: 'right', color: '#475569', fontVariantNumeric: 'tabular-nums' },
  totalCellStrong: { minWidth: 90, borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0', padding: '7px 8px', textAlign: 'right', fontWeight: 800, fontVariantNumeric: 'tabular-nums', background: '#f8fafc' },
};
