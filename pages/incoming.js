import { useState, useEffect, useRef, useMemo } from 'react';
import { apiGetExe } from '../lib/exeParity/client.js';
import { useLang } from '../lib/i18n';
import * as XLSX from 'xlsx';
import { parseWarehousePackingWorkbook } from '../lib/warehousePackingImport.js';
import { ConfigProvider, Table, Card, Tag, Select, Input, Button, Space, Typography, Alert, Empty, Row, Col, DatePicker, theme as antdTheme } from 'antd';
import { ReloadOutlined, UploadOutlined, DeleteOutlined, DownloadOutlined, DashboardOutlined } from '@ant-design/icons';
import koKR from 'antd/locale/ko_KR';
import dayjs from 'dayjs';
const { Text } = Typography;

const fmt = n => Number(n || 0).toLocaleString();


export default function Warehouse() {
  const { t } = useLang();
  const [masters, setMasters] = useState([]);
  const [selectedKey, setSelectedKey] = useState(null);
  const [details, setDetails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [err, setErr] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadData, setUploadData] = useState(null);
  const [uploadMeta, setUploadMeta] = useState({ orderYear:'', orderWeek:'', farmName:'', invoiceNo:'', awb:'', inputDate: '', gw:'', cw:'', rate:'', docFee:'' });
  // [2026-09-22] 입고 원장 탐색 보강 — nenova.exe에서 농장명 컬럼 필터를 반복 클릭하던 작업(Orbit 실측)을 웹에서 끝내기 위해:
  //   컬럼 정렬 · 농장/차수 드롭다운 · 최근 본 농장 칩 · 필터 상태 URL 유지 · 원장 목록 엑셀
  const [sortKey, setSortKey] = useState('InputDate');
  const [sortDir, setSortDir] = useState(-1);
  const [farmFilter, setFarmFilter] = useState('');
  const [weekFilter, setWeekFilter] = useState('');
  const [recentFarms, setRecentFarms] = useState([]);
  const [masterSearch, setMasterSearch] = useState('');
  const [detailSearch, setDetailSearch] = useState('');
  const urlApplied = useRef(false);
  const fileRef = useRef();
  const loadSeq = useRef(0);
  const detailSeq = useRef(0);

  const load = () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    apiGetExe('/api/warehouse', { startDate, endDate })
      .then(d => { if (seq === loadSeq.current) { setMasters(d.masters||[]); setErr(''); } })
      .catch(e => { if (seq === loadSeq.current) setErr(e.message); })
      .finally(() => { if (seq === loadSeq.current) setLoading(false); });
  };

  useEffect(() => {
    const d = new Date();
    const today = d.toISOString().slice(0, 10);
    const q = new URLSearchParams(window.location.search);
    setEndDate(q.get('to') || today);
    setUploadMeta(m => ({ ...m, inputDate: today }));
    d.setDate(d.getDate() - 7);
    setStartDate(q.get('from') || d.toISOString().slice(0, 10));
    if (q.get('farm')) setFarmFilter(q.get('farm'));
    if (q.get('week')) setWeekFilter(q.get('week'));
    if (q.get('q')) setMasterSearch(q.get('q'));
    try { setRecentFarms(JSON.parse(localStorage.getItem('incoming.recentFarms') || '[]')); } catch {}
    urlApplied.current = true;
  }, []);

  // 필터 상태를 URL에 유지 (새로고침·공유·뒤로가기 후에도 같은 화면)
  useEffect(() => {
    if (!urlApplied.current || !startDate || !endDate) return;
    const q = new URLSearchParams();
    q.set('from', startDate); q.set('to', endDate);
    if (farmFilter) q.set('farm', farmFilter);
    if (weekFilter) q.set('week', weekFilter);
    if (masterSearch) q.set('q', masterSearch);
    const next = `${window.location.pathname}?${q.toString()}`;
    if (next !== window.location.pathname + window.location.search) window.history.replaceState(null, '', next);
  }, [startDate, endDate, farmFilter, weekFilter, masterSearch]);

  useEffect(() => { if (startDate && endDate) load(); }, [startDate, endDate]);

  const selectMaster = (wk) => {
    const seq = ++detailSeq.current;
    setSelectedKey(wk);
    const fm = (masters.find(m => m.WarehouseKey === wk) || {}).FarmName;
    if (fm) { const next = [fm, ...recentFarms.filter(f => f !== fm)].slice(0, 6); setRecentFarms(next); try { localStorage.setItem('incoming.recentFarms', JSON.stringify(next)); } catch {} }
    setDetailLoading(true);
    apiGetExe(`/api/warehouse/${wk}`)
      .then(d => { if (seq === detailSeq.current) setDetails(d.items||[]); })
      .catch(e => { if (seq === detailSeq.current) { setDetails([]); setErr(e.message); } })
      .finally(() => { if (seq === detailSeq.current) setDetailLoading(false); });
  };

  const selected = masters.find(m => m.WarehouseKey === selectedKey);

  const farmOptions = useMemo(() => [...new Set(masters.map(m => m.FarmName).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [masters]);
  const weekOptions = useMemo(() => [...new Set(masters.map(m => m.OrderWeek).filter(Boolean))].sort().reverse(), [masters]);
  // 정렬은 antd Table sorter로 이동(2026-09-22); sortKey/sortDir는 필터 정렬 기본값에만 사용

  const filteredMasters = useMemo(() => {
    const q = masterSearch.toLowerCase();
    const list = masters.filter(m => {
      if (farmFilter && m.FarmName !== farmFilter) return false;
      if (weekFilter && m.OrderWeek !== weekFilter) return false;
      if (!q) return true;
      return (m.FarmName||'').toLowerCase().includes(q) ||
             (m.InvoiceNo||'').toLowerCase().includes(q) ||
             (m.AWB||'').toLowerCase().includes(q) ||
             (m.OrderWeek||'').includes(q);
    });
    const val = (m) => { const v = m[sortKey]; return v == null ? '' : v; };
    return list.sort((a, b) => { const x = val(a), y = val(b); if (typeof x === 'number' && typeof y === 'number') return (x - y) * sortDir; return String(x).localeCompare(String(y), 'ko') * sortDir; });
  }, [masters, masterSearch, farmFilter, weekFilter, sortKey, sortDir]);

  // 농장/차수를 고르면 첫 원장을 자동 선택해 상세까지 한 번에
  useEffect(() => {
    if (!farmFilter && !weekFilter) return;
    const first = filteredMasters[0];
    if (first && first.WarehouseKey !== selectedKey) selectMaster(first.WarehouseKey);
  }, [farmFilter, weekFilter, masters]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleMasterExcel = () => {
    if (!filteredMasters.length) { alert('내보낼 원장이 없습니다.'); return; }
    const rows = filteredMasters.map(m => ({ 주문년도:m.OrderYear, 차수:m.OrderWeek, 농장명:m.FarmName, 인보이스:m.InvoiceNo, AWB:m.AWB, 입력일자:m.InputDate,
      박스:m.totalBox, 단:m.totalBunch, 송이:m.totalSteam, GW:m.GrossWeight, CW:m.ChargeableWeight, Rate:m.FreightRateUSD }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), '입고원장');
    XLSX.writeFile(wb, `입고원장_${startDate}_${endDate}${farmFilter ? '_' + farmFilter : ''}.xlsx`);
  };

  const filteredDetails = details.filter(d => {
    if (!detailSearch) return true;
    const q = detailSearch.toLowerCase();
    return (d.ProdName||'').toLowerCase().includes(q) ||
           (d.주문코드||'').toLowerCase().includes(q);
  });

  // nenova.exe ExcelLoadingPackingList와 같은 Packing 엑셀만 허용한다.
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'xlsx' || ext === 'xls') {
      // 엑셀 파일 (Packing 양식)
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const { meta, rows } = parseWarehousePackingWorkbook(new Uint8Array(ev.target.result), XLSX);
          if (rows.length === 0) { alert('엑셀 파일에서 데이터를 찾을 수 없습니다.'); return; }
          setUploadData(rows);
          setUploadMeta(m => ({
            ...m,
            fileName: file.name,
            farmName:  meta.farmName  || m.farmName,
            orderWeek: meta.orderWeek || m.orderWeek,
            invoiceNo: meta.invoiceNo || m.invoiceNo,
            awb:       meta.awb       || m.awb,
            inputDate: meta.inputDate ? meta.inputDate.replace(/\//g, '-') : m.inputDate,
          }));
          setShowUploadModal(true);
        } catch (err) { alert('엑셀 파일 파싱 오류: ' + err.message); }
      };
      reader.readAsArrayBuffer(file);
    } else alert('nenova.exe Packing 엑셀(.xlsx/.xls) 파일만 업로드할 수 있습니다.');
    e.target.value = '';
  };

  const handleUpload = async () => {
    if (!uploadData || !/^\d{4}$/.test(uploadMeta.orderYear) || !/^\d{2}-\d{2}$/.test(uploadMeta.orderWeek) || !uploadMeta.farmName || !uploadMeta.inputDate) {
      alert('주문년도, 차수(예: 33-02), 농장명, 입력일자는 필수입니다.'); return;
    }
    setUploading(true);
    try {
      const items = uploadData;

      const res = await fetch('/api/warehouse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...uploadMeta,
          gw:     uploadMeta.gw     === '' ? null : uploadMeta.gw,
          cw:     uploadMeta.cw     === '' ? null : uploadMeta.cw,
          rate:   uploadMeta.rate   === '' ? null : uploadMeta.rate,
          docFee: uploadMeta.docFee === '' ? null : uploadMeta.docFee,
          items,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error([data.error, ...(data.errors || []).map(x => `${x.prodName || `${x.row}행`}: ${x.error}`)].join('\n'));
      setSuccessMsg(`✅ ${data.message}`);
      setShowUploadModal(false); setUploadData(null);
      setTimeout(() => setSuccessMsg(''), 5000);
      load();
    } catch (e) { alert(e.message); } finally { setUploading(false); }
  };

  const handleDelete = async () => {
    if (!selectedKey) { alert('삭제할 원장을 선택하세요.'); return; }
    if (!confirm(`[${selected?.FarmName}] 원장을 삭제하시겠습니까?`)) return;
    setDeleting(true);
    try {
      const res = await fetch('/api/warehouse', { method:'DELETE', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ warehouseKey: selectedKey }) });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setSuccessMsg('✅ 원장 삭제 완료');
      setSelectedKey(null); setDetails([]);
      setTimeout(() => setSuccessMsg(''), 3000);
      load();
    } catch(e) { alert(e.message); } finally { setDeleting(false); }
  };

  const handleExcel = () => {
    if (!selected || !details.length) { alert('상세를 내보낼 입고 원장을 선택하세요.'); return; }
    const rows = details.map(d => ({ 주문코드:d.주문코드, 품목명:d.DisplayName || d.ProdName, 단위:d.단위,
      박스수량:d.BoxQuantity, 단수량:d.BunchQuantity, 송이수량:d.SteamQuantity, 단가:d.단가, 총액:d.총액 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), '입고상세');
    XLSX.writeFile(wb, `입고상세_${selected.OrderYear}_${selected.OrderWeek}_${selected.FarmName || ''}.xlsx`);
  };

  return (
    <ConfigProvider locale={koKR} theme={{ algorithm: antdTheme.defaultAlgorithm, token: { colorPrimary: '#1166BB', borderRadius: 6, fontSize: 12 } }}>
    <div>
      <Space wrap style={{ marginBottom: 6, background: '#fff', border: '1px solid var(--border)', padding: '6px 8px', width: '100%' }}>
        <Text type="secondary">업로드일자</Text>
        <DatePicker.RangePicker size="small" allowClear={false} value={[startDate ? dayjs(startDate) : null, endDate ? dayjs(endDate) : null]} onChange={(v) => { if (v && v[0] && v[1]) { setStartDate(v[0].format('YYYY-MM-DD')); setEndDate(v[1].format('YYYY-MM-DD')); } }} presets={[{ label: '최근 7일', value: [dayjs().subtract(7, 'day'), dayjs()] }, { label: '최근 30일', value: [dayjs().subtract(30, 'day'), dayjs()] }, { label: '최근 90일', value: [dayjs().subtract(90, 'day'), dayjs()] }]} />
        <Text type="secondary">농장</Text>
        <Select size="small" showSearch allowClear placeholder={`전체 (${farmOptions.length})`} style={{ width: 220 }} value={farmFilter || undefined} onChange={(v) => setFarmFilter(v || '')} options={farmOptions.map((f) => ({ value: f, label: f }))} />
        <Text type="secondary">차수</Text>
        <Select size="small" allowClear placeholder="전체" style={{ width: 100 }} value={weekFilter || undefined} onChange={(v) => setWeekFilter(v || '')} options={weekOptions.map((w) => ({ value: w, label: w }))} />
        <Input.Search size="small" allowClear placeholder="농장명·인보이스·AWB·차수" value={masterSearch} onChange={(e) => setMasterSearch(e.target.value)} style={{ width: 220 }} />
        <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={load}>{t('새로고침')}</Button>
        <Button size="small" type="primary" icon={<UploadOutlined />} disabled={uploading || deleting} onClick={() => fileRef.current.click()}>업로드 / Subir</Button>
        <input type="file" ref={fileRef} style={{ display: 'none' }} accept=".xlsx,.xls" onChange={handleFileChange} />
        <Button size="small" danger icon={<DeleteOutlined />} disabled={!selectedKey || deleting || uploading} onClick={handleDelete} loading={deleting}>원장삭제</Button>
        <Button size="small" href="/import" icon={<DashboardOutlined />} title="차수 보드·발주 입고 비교·농장 정산·입고 예정">수입부 통합</Button>
        <Button size="small" icon={<DownloadOutlined />} disabled={!filteredMasters.length} onClick={handleMasterExcel}>원장 목록 엑셀</Button>
        <Button size="small" icon={<DownloadOutlined />} disabled={!selectedKey || detailLoading || !details.length} onClick={handleExcel}>선택 상세 엑셀</Button>
        <Button size="small" onClick={() => window.opener ? window.close() : history.back()}>닫기 / Cerrar</Button>
      </Space>

      {err && <Alert type="error" showIcon message={err} style={{ marginBottom: 6 }} closable onClose={() => setErr('')} />}
      {successMsg && <Alert type="success" showIcon message={successMsg} style={{ marginBottom: 6 }} />}
      <Alert type="info" showIcon style={{ marginBottom: 6 }} message={<span>nenova.exe와 동일한 <b>Packing 엑셀(.xlsx/.xls)</b>만 업로드합니다. 품목 하나라도 정확히 일치하지 않으면 전체 저장이 취소됩니다.</span>} />

      <Row gutter={6} wrap={false} style={{ alignItems: 'flex-start' }}>
        <Col flex="1 1 0" style={{ minWidth: 0 }}>
          <Card size="small" title={<Space><Text strong>입고 원장 목록</Text><Text type="secondary">{filteredMasters.length}/{masters.length}건</Text>{recentFarms.length > 0 && <Space size={4}><Text type="secondary" style={{ fontSize: 11 }}>최근</Text>{recentFarms.map((f) => <Tag.CheckableTag key={f} checked={farmFilter === f} onChange={() => setFarmFilter(farmFilter === f ? '' : f)}>{f}</Tag.CheckableTag>)}</Space>}</Space>}>
            <Table size="small" rowKey="WarehouseKey" loading={loading} dataSource={filteredMasters} scroll={{ x: 1000, y: 'calc(100vh - 330px)' }} pagination={{ pageSize: 50, size: 'small', showSizeChanger: true, pageSizeOptions: [50, 100, 500], showTotal: (n) => `${n}건` }}
              rowClassName={(m) => (selectedKey === m.WarehouseKey ? 'ant-table-row-selected' : '')} onRow={(m) => ({ onClick: () => selectMaster(m.WarehouseKey), style: { cursor: 'pointer' } })}
              summary={(rows) => <Table.Summary fixed><Table.Summary.Row><Table.Summary.Cell index={0} colSpan={6}><Text strong>합계</Text></Table.Summary.Cell><Table.Summary.Cell index={6} align="right"><Text strong>{fmt(rows.reduce((a, b) => a + (b.totalBox || 0), 0))}</Text></Table.Summary.Cell><Table.Summary.Cell index={7} align="right"><Text strong>{fmt(rows.reduce((a, b) => a + (b.totalBunch || 0), 0))}</Text></Table.Summary.Cell><Table.Summary.Cell index={8} align="right"><Text strong>{fmt(rows.reduce((a, b) => a + (b.totalSteam || 0), 0))}</Text></Table.Summary.Cell><Table.Summary.Cell index={9} colSpan={3} /></Table.Summary.Row></Table.Summary>}
              columns={[
                { title: '주문년도', dataIndex: 'OrderYear', width: 80, sorter: (a, b) => String(a.OrderYear).localeCompare(String(b.OrderYear)) },
                { title: '차수', dataIndex: 'OrderWeek', width: 70, sorter: (a, b) => String(a.OrderWeek).localeCompare(String(b.OrderWeek)), render: (v) => <Text strong>{v}</Text> },
                { title: '농장명', dataIndex: 'FarmName', ellipsis: true, sorter: (a, b) => String(a.FarmName || '').localeCompare(String(b.FarmName || ''), 'ko'), filterSearch: true, filters: farmOptions.map((f) => ({ text: f, value: f })), onFilter: (v, r) => r.FarmName === v },
                { title: '인보이스', dataIndex: 'InvoiceNo', width: 110, ellipsis: true, render: (v) => <Text type="secondary" style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{v}</Text> },
                { title: 'AWB', dataIndex: 'AWB', width: 120, ellipsis: true, render: (v) => <Text type="secondary" style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{v}</Text> },
                { title: '입력일자', dataIndex: 'InputDate', width: 100, sorter: (a, b) => String(a.InputDate || '').localeCompare(String(b.InputDate || '')), defaultSortOrder: 'descend' },
                { title: '박스', dataIndex: 'totalBox', align: 'right', width: 70, render: fmt, sorter: (a, b) => (a.totalBox || 0) - (b.totalBox || 0) },
                { title: '단', dataIndex: 'totalBunch', align: 'right', width: 70, render: fmt, sorter: (a, b) => (a.totalBunch || 0) - (b.totalBunch || 0) },
                { title: '송이', dataIndex: 'totalSteam', align: 'right', width: 70, render: fmt, sorter: (a, b) => (a.totalSteam || 0) - (b.totalSteam || 0) },
                { title: 'GW', dataIndex: 'GrossWeight', align: 'right', width: 70, render: (v) => v ?? <Text type="secondary">–</Text>, sorter: (a, b) => (a.GrossWeight || 0) - (b.GrossWeight || 0) },
                { title: 'CW', dataIndex: 'ChargeableWeight', align: 'right', width: 70, render: (v) => v ?? <Text type="secondary">–</Text> },
                { title: 'Rate', dataIndex: 'FreightRateUSD', align: 'right', width: 70, render: (v) => v ?? <Text type="secondary">–</Text> },
              ]} />
          </Card>
        </Col>
        <Col flex="0 0 46%" style={{ minWidth: 0 }}>
          <Card size="small" title={<Space><Text strong>입고 상세 목록</Text>{selected && <Tag color="blue">{selected.FarmName} · {selected.InvoiceNo}</Tag>}</Space>} extra={selectedKey && <Input.Search size="small" allowClear placeholder="품목명·주문코드" value={detailSearch} onChange={(e) => setDetailSearch(e.target.value)} style={{ width: 180 }} />}>
            {!selectedKey ? <Empty description="원장을 선택하세요" /> : (
              <Table size="small" rowKey={(d, i) => d.WdetailKey ?? i} loading={detailLoading} dataSource={filteredDetails} pagination={false} scroll={{ x: 800, y: 'calc(100vh - 330px)' }}
                summary={(rows) => <Table.Summary fixed><Table.Summary.Row><Table.Summary.Cell index={0} colSpan={5}><Text strong>합계</Text></Table.Summary.Cell>{['BoxQuantity', 'BunchQuantity', 'SteamQuantity'].map((k, i) => <Table.Summary.Cell key={k} index={5 + i} align="right"><Text strong>{fmt(rows.reduce((a, b) => a + (b[k] || 0), 0))}</Text></Table.Summary.Cell>)}<Table.Summary.Cell index={8} /><Table.Summary.Cell index={9} align="right"><Text strong>{fmt(rows.reduce((a, b) => a + (b.총액 || 0), 0))}</Text></Table.Summary.Cell></Table.Summary.Row></Table.Summary>}
                columns={[
                  { title: '주문코드', dataIndex: '주문코드', width: 90, render: (v) => <Text style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{v}</Text> },
                  { title: '품목명(색상)', key: 'name', ellipsis: true, render: (_, d) => <Text strong>{d.DisplayName || d.ProdName}</Text> },
                  { title: '단위', dataIndex: '단위', width: 56 },
                  { title: '단/송이', dataIndex: '단송이', align: 'right', width: 66, render: fmt },
                  { title: '박스/송이', dataIndex: '박스송이', align: 'right', width: 74, render: fmt },
                  { title: '박스수량', dataIndex: 'BoxQuantity', align: 'right', width: 74, render: fmt },
                  { title: '단수량', dataIndex: 'BunchQuantity', align: 'right', width: 70, render: fmt },
                  { title: '송이수량', dataIndex: 'SteamQuantity', align: 'right', width: 74, render: fmt },
                  { title: '단가', dataIndex: '단가', align: 'right', width: 70, render: fmt },
                  { title: '출하단가', dataIndex: '총액', align: 'right', width: 80, render: fmt },
                ]} />
            )}
          </Card>
        </Col>
      </Row>

      {/* 업로드 모달 */}
      {showUploadModal && (
        <div className="modal-overlay" onClick={()=>{}}>
          <div className="modal" style={{maxWidth:620}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">📤 입고 데이터 업로드</span>
            </div>
            <div className="modal-body">
              <div style={{padding:'8px 12px',background:'var(--blue-bg)',borderRadius:6,fontSize:12,color:'var(--blue)',marginBottom:14}}>
                파일에서 <strong>{uploadData?.length}개</strong> 행을 읽었습니다. 아래 정보를 입력 후 저장하세요.
              </div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">주문년도 *</label><input className="form-control" value={uploadMeta.orderYear} onChange={e=>setUploadMeta(m=>({...m,orderYear:e.target.value}))} placeholder="2026"/></div>
                <div className="form-group"><label className="form-label">차수 *</label><input className="form-control" value={uploadMeta.orderWeek} onChange={e=>setUploadMeta(m=>({...m,orderWeek:e.target.value}))} placeholder="13-01"/></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">농장명 *</label><input className="form-control" value={uploadMeta.farmName} onChange={e=>setUploadMeta(m=>({...m,farmName:e.target.value}))} placeholder="FREIGHTWISE"/></div>
                <div className="form-group"><label className="form-label">인보이스</label><input className="form-control" value={uploadMeta.invoiceNo} onChange={e=>setUploadMeta(m=>({...m,invoiceNo:e.target.value}))} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">AWB (BILL No)</label><input className="form-control" value={uploadMeta.awb} onChange={e=>setUploadMeta(m=>({...m,awb:e.target.value}))} placeholder="123-45678901" /></div>
                <div className="form-group"><label className="form-label">입력일자</label><input type="date" className="form-control" value={uploadMeta.inputDate} onChange={e=>setUploadMeta(m=>({...m,inputDate:e.target.value}))} /></div>
              </div>
              <div style={{ margin:'8px 0 4px', fontSize:11, color:'var(--text3)', borderTop:'1px solid var(--border)', paddingTop:8 }}>
                ✈️ 항공 원가 — AWB 문서 확인 후 입력. 운송기준원가 탭에서 재입력/수정 가능.
              </div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">GW 실중량 (kg)</label><input type="number" step="0.01" className="form-control" value={uploadMeta.gw} onChange={e=>setUploadMeta(m=>({...m,gw:e.target.value}))} placeholder="976" /></div>
                <div className="form-group"><label className="form-label">CW 과금중량 (kg)</label><input type="number" step="0.01" className="form-control" value={uploadMeta.cw} onChange={e=>setUploadMeta(m=>({...m,cw:e.target.value}))} placeholder="976" /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">Rate (USD/kg)</label><input type="number" step="0.01" className="form-control" value={uploadMeta.rate} onChange={e=>setUploadMeta(m=>({...m,rate:e.target.value}))} placeholder="2.85" /></div>
                <div className="form-group"><label className="form-label">서류비 (USD)</label><input type="number" step="0.01" className="form-control" value={uploadMeta.docFee} onChange={e=>setUploadMeta(m=>({...m,docFee:e.target.value}))} placeholder="90" /></div>
              </div>

              {/* 미리보기 */}
              <div style={{marginTop:12}}>
                <div style={{fontSize:12,fontWeight:600,marginBottom:6,color:'var(--text2)'}}>데이터 미리보기 (상위 5개)</div>
                <div style={{overflowX:'auto',border:'1px solid var(--border)',borderRadius:6}}>
                  <table className="tbl" style={{fontSize:11,minWidth:400}}>
                    <thead>
                      <tr>{uploadData?.[0] && Object.keys(uploadData[0]).slice(0,6).map(k=><th key={k}>{k}</th>)}</tr>
                    </thead>
                    <tbody>
                      {uploadData?.slice(0,5).map((row,i)=>(
                        <tr key={i}>{Object.values(row).slice(0,6).map((v,j)=><td key={j} style={{maxWidth:120,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{v}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" disabled={uploading} onClick={()=>{setShowUploadModal(false);setUploadData(null);}}>취소 / Cancelar</button>
              <button className="btn btn-primary" onClick={handleUpload} disabled={uploading}>{uploading?'업로드 중...':'📤 업로드 / Subir'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
    </ConfigProvider>
  );
}
