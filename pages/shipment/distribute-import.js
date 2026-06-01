import { useMemo, useRef, useState } from 'react';
import Layout from '../../components/Layout';
import { useWeekInput } from '../../lib/useWeekInput';

const fmt = n => Number(n || 0).toLocaleString('ko-KR');
const cls = status => status === '변경' ? '#fff7ed' : status === '주문없음' ? '#eff6ff' : '#fff';
const statusText = status => status === '주문없음' ? '주문생성' : status;

export default function DistributeImport() {
  const weekInput = useWeekInput('');
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [filter, setFilter] = useState('changed');

  const rows = preview?.rows || [];
  const changedRows = useMemo(() => rows.filter(r => r.status !== '동일'), [rows]);
  const orderlessRows = useMemo(() => changedRows.filter(r => r.status === '주문없음'), [changedRows]);
  const visibleRows = useMemo(() => {
    const base = filter === 'changed' ? changedRows : filter === 'unmatched' ? [] : rows;
    return base.slice(0, 1000);
  }, [rows, changedRows, filter]);

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
      const orderless = (data.changedRows || []).filter(r => r.status === '주문없음').length;
      setMessage(`검증 완료: 변경 ${data.changedRows?.length || 0}건, 주문생성 ${orderless}건, 미매칭 ${data.unmatched?.length || 0}건`);
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
    if (!changedRows.length) {
      setError('적용할 변경분이 없습니다.');
      return;
    }
    const orderCreateText = orderlessRows.length ? `\n주문 미등록 ${orderlessRows.length}건은 주문등록 후 분배합니다.` : '';
    if (!confirm(`${preview.week}차 출고분배 ${changedRows.length}건을 적용하시겠습니까?${orderCreateText}`)) return;
    setApplying(true); setError(''); setMessage('');
    try {
      const res = await fetch('/api/shipment/distribute-import-apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week: preview.week, rows: changedRows }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '적용 실패');
      setMessage(`업로드 적용 완료: 분배 ${data.appliedCount}건, 주문생성 ${data.orderCreatedCount || 0}건`);
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
            <div style={st.sub}>분류프로그램 물량표를 읽어 업체별 품목 수량 기준으로 주문/현재분배/수정수량을 비교합니다.</div>
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
          <span style={st.fileName}>{file ? file.name : '분류프로그램 결과 물량표 엑셀을 선택하세요'}</span>
          <button style={st.primaryBtn} onClick={handlePreview} disabled={loading}>{loading ? '읽는 중...' : '검증하기'}</button>
          <button style={st.applyBtn} onClick={handleApply} disabled={applying || !preview}>{applying ? '적용 중...' : '승인 후 업로드'}</button>
        </div>

        {error && <div style={st.error}>{error}</div>}
        {message && <div style={st.message}>{message}</div>}

        {preview && (
          <>
            <div style={st.kpis}>
              <Kpi label="전체 표시" value={rows.length} />
              <Kpi label="변경" value={changedRows.length} warn />
              <Kpi label="주문생성" value={orderlessRows.length} warn={orderlessRows.length > 0} />
              <Kpi label="미매칭" value={preview.unmatched?.length || 0} danger={(preview.unmatched?.length || 0) > 0} />
              <Kpi label="업체" value={preview.summaryByCustomer?.length || 0} />
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
                    <thead><tr><th>업체</th><th>주문</th><th>현재분배</th><th>수정수량</th><th>증감</th><th>변경라인</th></tr></thead>
                    <tbody>
                      {(preview.summaryByCustomer || []).map(r => (
                        <tr key={r.custName}>
                          <td>{r.custName}</td><td>{fmt(r.orderQty)}</td><td>{fmt(r.currentOutQty)}</td>
                          <td>{fmt(r.uploadQty)}</td><td style={{ color: r.changeQty ? '#b45309' : '#475569' }}>{fmt(r.changeQty)}</td><td>{r.changedLines}</td>
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
                <div style={st.segment}>
                  <button onClick={() => setFilter('changed')} style={filter === 'changed' ? st.segOn : st.seg}>변경만</button>
                  <button onClick={() => setFilter('all')} style={filter === 'all' ? st.segOn : st.seg}>전체</button>
                  <button onClick={() => setFilter('unmatched')} style={filter === 'unmatched' ? st.segOn : st.seg}>미매칭</button>
                </div>
              </div>
              {filter === 'unmatched' ? (
                <SimpleUnmatched rows={preview.unmatched || []} />
              ) : (
                <div style={st.tableWrapLarge}>
                  <table style={st.table}>
                    <thead>
                      <tr><th>상태</th><th>업체</th><th>품목</th><th>단위</th><th>주문</th><th>현재분배</th><th>엑셀수정</th><th>증감</th><th>주문대비</th><th>셀</th></tr>
                    </thead>
                    <tbody>
                      {visibleRows.map(r => (
                        <tr key={r.key} style={{ background: cls(r.status) }}>
                          <td>{statusText(r.status)}</td><td>{r.custName}</td><td>{r.displayName || r.prodName}</td><td>{r.outUnit}</td>
                          <td>{fmt(r.orderQty)}</td><td>{fmt(r.currentOutQty)}</td><td>{fmt(r.uploadQty)}</td>
                          <td>{fmt(r.changeQty)}</td><td>{fmt(r.orderDiffQty)}</td><td>{(r.cells || []).slice(0, 2).join(', ')}</td>
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
  kpis: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(120px, 1fr))', gap: 10, marginBottom: 12 },
  kpi: { background: '#fff', border: '1px solid #dbe3ef', borderRadius: 8, padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  grid: { display: 'grid', gridTemplateColumns: 'minmax(320px, 0.8fr) minmax(460px, 1.2fr)', gap: 12, marginBottom: 12 },
  panel: { border: '1px solid #dbe3ef', borderRadius: 8, background: '#fff', overflow: 'hidden' },
  panelHead: { minHeight: 42, padding: '0 12px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  logBox: { padding: 12, height: 220, overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 12, lineHeight: 1.55, background: '#0f172a', color: '#e2e8f0' },
  tableWrap: { height: 220, overflow: 'auto' },
  tableWrapLarge: { maxHeight: 560, overflow: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  segment: { display: 'flex', gap: 4 },
  seg: { border: '1px solid #cbd5e1', background: '#fff', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' },
  segOn: { border: '1px solid #2563eb', background: '#2563eb', color: '#fff', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' },
};
