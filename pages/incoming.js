import { useState, useEffect, useRef, useMemo } from 'react';
import { apiGetExe } from '../lib/exeParity/client.js';
import { useLang } from '../lib/i18n';
import * as XLSX from 'xlsx';
import { parseWarehousePackingWorkbook } from '../lib/warehousePackingImport.js';
import WarehousePackingReview from '../components/WarehousePackingReview.js';
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
  const [validation, setValidation] = useState(null);
  const [validating, setValidating] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [confirmUpload, setConfirmUpload] = useState(false);
  const uploadRevision = useRef(0);
  const validateSeq = useRef(0);
  const fileSeq = useRef(0);
  const saveBusy = useRef(false);
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
    if (saveBusy.current || uploading) return;
    const file = e.target.files[0];
    if (!file) return;
    const seq = ++fileSeq.current;
    ++uploadRevision.current;
    ++validateSeq.current;
    setValidation(null); setUploadError(''); setUploadData(null); setValidating(false); setConfirmUpload(false);
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'xlsx' || ext === 'xls') {
      // 엑셀 파일 (Packing 양식)
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (seq !== fileSeq.current) return;
        try {
          const { meta, rows } = parseWarehousePackingWorkbook(new Uint8Array(ev.target.result), XLSX);
          if (rows.length === 0) { alert('엑셀 파일에서 데이터를 찾을 수 없습니다.'); return; }
          setUploadData(rows);
          setUploadMeta({
            orderYear: meta.orderYear || '',
            fileName: file.name,
            farmName: meta.farmName || '', orderWeek: meta.orderWeek || '',
            invoiceNo: meta.invoiceNo || '', awb: meta.awb || '', orderNo: meta.orderNo || '',
            inputDate: meta.inputDate ? meta.inputDate.replace(/\//g, '-') : '',
            gw: '', cw: '', rate: '', docFee: '',
          });
          setShowUploadModal(true);
        } catch (err) { setUploadError('엑셀 파일 파싱 오류: ' + err.message); alert('엑셀 파일 파싱 오류: ' + err.message); }
      };
      reader.onerror = () => { if (seq === fileSeq.current) setUploadError('파일을 읽지 못했습니다. 다시 선택하세요.'); };
      reader.readAsArrayBuffer(file);
    } else alert('nenova.exe Packing 엑셀(.xlsx/.xls) 파일만 업로드할 수 있습니다.');
    e.target.value = '';
  };

  const changeUploadMeta = (key, value) => {
    ++uploadRevision.current; ++validateSeq.current;
    setValidation(previous => previous ? { ...previous, valid: false, stale: true } : null); setUploadError(''); setValidating(false); setConfirmUpload(false);
    setUploadMeta(current => ({ ...current, [key]: value }));
  };

  const selectUploadProduct = (index, prodKey) => {
    ++uploadRevision.current; ++validateSeq.current;
    setValidation(previous => previous ? {
      ...previous, valid: false, stale: true,
      rows: previous.rows?.map((row, rowIndex) => rowIndex === index ? { ...row, status: 'pending', error: '' } : row),
      errors: previous.errors?.filter((error) => error.index == null ? error.row == null || Number(error.row) !== Number(uploadData?.[index]?.sourceRow) : Number(error.index) !== index),
    } : null); setUploadError(''); setValidating(false); setConfirmUpload(false);
    setUploadData(current => current.map((item, rowIndex) => rowIndex === index
      ? (prodKey ? { ...item, selectedProdKey: prodKey } : Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'selectedProdKey')))
      : item));
  };

  const uploadPayload = () => ({ ...uploadMeta,
    gw: uploadMeta.gw === '' ? null : uploadMeta.gw,
    cw: uploadMeta.cw === '' ? null : uploadMeta.cw,
    rate: uploadMeta.rate === '' ? null : uploadMeta.rate,
    docFee: uploadMeta.docFee === '' ? null : uploadMeta.docFee,
    items: uploadData,
  });

  const uploadMetaReady = () => /^\d{4}$/.test(String(uploadMeta.orderYear)) && Number(uploadMeta.orderYear) >= 2026
    && /^\d{2}-\d{2}$/.test(uploadMeta.orderWeek) && !!uploadMeta.farmName?.trim() && !!uploadMeta.inputDate;

  const handleValidate = async () => {
    setConfirmUpload(false);
    if (!uploadData?.length || !uploadMetaReady()) { setUploadError('2026년 이후 주문년도, 세부차수(예: 33-02), 농장명, 입력일자를 확인하세요.'); return; }
    const seq = ++validateSeq.current;
    const revision = uploadRevision.current;
    setValidating(true); setValidation(null); setUploadError('');
    try {
      const res = await fetch('/api/warehouse/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(uploadPayload()),
      });
      const data = await res.json();
      if (seq !== validateSeq.current || revision !== uploadRevision.current) return;
      if (!data.success) { setUploadError(data.error || '검증에 실패했습니다.'); setValidation({ valid: false, rows: data.rows || [], errors: data.errors || [], products: data.products || [] }); return; }
      setValidation({ ...data, revision });
    } catch (e) { if (seq === validateSeq.current && revision === uploadRevision.current) setUploadError(`검증 요청을 확인하지 못했습니다: ${e.message}`); }
    finally { if (seq === validateSeq.current) setValidating(false); }
  };

  const handleUpload = async (confirmed = false) => {
    if (saveBusy.current || uploading || validating) return;
    if (!uploadData?.length || !uploadMetaReady() || !validation?.valid || validation.revision !== uploadRevision.current || validation.rows?.length !== uploadData.length) {
      setConfirmUpload(false); setUploadError('전체 행을 다시 검증한 뒤 저장하세요.'); return;
    }
    if (!confirmed) { setConfirmUpload(true); return; }
    if (!confirmUpload) return;
    saveBusy.current = true;
    setUploading(true); setUploadError(''); setConfirmUpload(false);
    try {
      const res = await fetch('/api/warehouse', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(uploadPayload()),
      });
      const data = await res.json();
      if (!data.success) {
        setValidation(previous => ({ ...(previous || {}), valid: false, rows: data.rows || previous?.rows || [], errors: data.errors || [], products: data.products || previous?.products || [] }));
        setUploadError(data.error || '저장 전 서버 검증에서 실패했습니다. 오류 행을 수정하고 다시 검증하세요.');
        return;
      }
      setSuccessMsg(`✅ ${data.message}`);
      setShowUploadModal(false); setUploadData(null); setValidation(null);
      setTimeout(() => setSuccessMsg(''), 5000);
      load();
    } catch (e) { setUploadError('저장 응답을 확인하지 못했습니다. 원장 목록에서 동일 입고가 등록됐는지 먼저 확인하세요. 자동 재시도하지 않습니다.'); }
    finally { saveBusy.current = false; setUploading(false); }
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
      <Alert type="info" showIcon style={{ marginBottom: 6 }} message={<span><b>Packing 엑셀(.xlsx/.xls)</b>의 전체 행을 검토합니다. 미등록 품목은 활성 ERP 품목을 직접 찾아 선택한 뒤 재검증할 수 있으며, 한 행이라도 검증되지 않으면 전체 저장이 취소됩니다.</span>} />

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
          <div className="modal packing-upload-modal" style={{width:'min(1740px, 96vw)', maxWidth:'none', height:'min(940px, calc(100vh - 32px))', maxHeight:'calc(100vh - 32px)', display:'flex', flexDirection:'column'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">📤 입고 데이터 업로드</span>
            </div>
            <div className="modal-body" style={{flex:'1 1 auto', minHeight:0, maxHeight:'none', overflowY:'auto', padding:'10px 16px'}}>
              <div style={{padding:'6px 10px',background:'var(--blue-bg)',borderRadius:6,fontSize:12,color:'var(--blue)',marginBottom:8}}>
                파일에서 <strong>{uploadData?.length}개</strong> 행을 읽었습니다. 원본 수량은 변경하지 않습니다. 전체 행을 검증한 후 저장하세요.
              </div>
              <div className="packing-meta-grid">
                <div className="form-group"><label className="form-label">주문년도 *</label><input className="form-control" disabled={uploading} value={uploadMeta.orderYear} onChange={e=>changeUploadMeta('orderYear',e.target.value)} placeholder="2026"/></div>
                <div className="form-group"><label className="form-label">차수 *</label><input className="form-control" disabled={uploading} value={uploadMeta.orderWeek} onChange={e=>changeUploadMeta('orderWeek',e.target.value)} placeholder="13-01"/></div>
                <div className="form-group"><label className="form-label">농장명 *</label><input className="form-control" disabled={uploading} value={uploadMeta.farmName} onChange={e=>changeUploadMeta('farmName',e.target.value)} placeholder="FREIGHTWISE"/></div>
                <div className="form-group"><label className="form-label">인보이스</label><input className="form-control" disabled={uploading} value={uploadMeta.invoiceNo} onChange={e=>changeUploadMeta('invoiceNo',e.target.value)} /></div>
                <div className="form-group"><label className="form-label">AWB (BILL No)</label><input className="form-control" disabled={uploading} value={uploadMeta.awb} onChange={e=>changeUploadMeta('awb',e.target.value)} placeholder="123-45678901" /></div>
                <div className="form-group"><label className="form-label">입력일자 *</label><input type="date" className="form-control" disabled={uploading} value={uploadMeta.inputDate} onChange={e=>changeUploadMeta('inputDate',e.target.value)} /></div>
              </div>
              <div style={{ margin:'7px 0 4px', fontSize:11, color:'var(--text3)', borderTop:'1px solid var(--border)', paddingTop:6 }}>
                ✈️ 항공 원가 — AWB 문서 확인 후 입력. 운송기준원가 탭에서 재입력/수정 가능.
              </div>
              <div className="packing-freight-grid">
                <div className="form-group"><label className="form-label">GW 실중량 (kg)</label><input type="number" step="0.01" className="form-control" disabled={uploading} value={uploadMeta.gw} onChange={e=>changeUploadMeta('gw',e.target.value)} placeholder="976" /></div>
                <div className="form-group"><label className="form-label">CW 과금중량 (kg)</label><input type="number" step="0.01" className="form-control" disabled={uploading} value={uploadMeta.cw} onChange={e=>changeUploadMeta('cw',e.target.value)} placeholder="976" /></div>
                <div className="form-group"><label className="form-label">Rate (USD/kg)</label><input type="number" step="0.01" className="form-control" disabled={uploading} value={uploadMeta.rate} onChange={e=>changeUploadMeta('rate',e.target.value)} placeholder="2.85" /></div>
                <div className="form-group"><label className="form-label">서류비 (USD)</label><input type="number" step="0.01" className="form-control" disabled={uploading} value={uploadMeta.docFee} onChange={e=>changeUploadMeta('docFee',e.target.value)} placeholder="90" /></div>
              </div>

              {uploadError && <Alert type="error" showIcon message={uploadError} style={{margin:'10px 0'}} />}
              <WarehousePackingReview items={uploadData} rows={validation?.rows} errors={validation?.errors} products={validation?.products} valid={validation?.valid} stale={validation?.stale} validating={validating} saving={uploading} onSelect={selectUploadProduct} />
            </div>
            <div className="modal-footer" style={{flex:'0 0 auto',background:'#fff',zIndex:2}}>
              {confirmUpload && <div role="group" aria-label="입고 저장 확인" className="packing-confirm-strip">
                <strong>저장 전 확인</strong>
                <span>{uploadMeta.orderYear}년 · {uploadMeta.orderWeek}차 · 농장 1곳 ({uploadMeta.farmName}) · {uploadData?.length || 0}행</span>
                <button className="btn btn-secondary" onClick={() => setConfirmUpload(false)}>돌아가기</button>
                <button className="btn btn-primary" disabled={uploading || validating} onClick={() => handleUpload(true)}>확인 후 입고 저장</button>
              </div>}
              <button className="btn btn-secondary" disabled={uploading} onClick={()=>{++fileSeq.current;++validateSeq.current;setShowUploadModal(false);setUploadData(null);setValidation(null);setUploadError('');setConfirmUpload(false);}}>취소 / Cancelar</button>
              <button className="btn btn-secondary" onClick={handleValidate} disabled={validating || uploading || !uploadData?.length}>{validating?'검증 중...':'전체 행 다시 검증'}</button>
              <button className="btn btn-primary" onClick={() => handleUpload(false)} disabled={uploading || validating || !validation?.valid || validation.revision !== uploadRevision.current}>{uploading?'업로드 중...':'📤 입고 저장 내용 확인'}</button>
            </div>
          </div>
          <style jsx>{`
            .packing-upload-modal .packing-meta-grid { display: grid; grid-template-columns: 110px 110px minmax(190px, 1.7fr) repeat(3, minmax(150px, 1fr)); gap: 8px; }
            .packing-upload-modal .packing-freight-grid { display: grid; grid-template-columns: repeat(4, minmax(130px, 1fr)); gap: 8px; margin-bottom: 8px; }
            .packing-upload-modal .form-group { min-width: 0; }
            .packing-upload-modal .form-control { width: 100%; min-width: 0; }
            .packing-upload-modal .packing-confirm-strip { width: 100%; display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 8px; padding: 7px; border: 1px solid #91caff; border-radius: 6px; background: #e6f4ff; }
            .packing-upload-modal .modal-footer { flex-wrap: wrap; }
            @media (max-width: 900px) {
              .packing-upload-modal .packing-meta-grid, .packing-upload-modal .packing-freight-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
            }
            @media (max-width: 600px) {
              .packing-upload-modal .packing-meta-grid, .packing-upload-modal .packing-freight-grid { grid-template-columns: minmax(0, 1fr); }
            }
          `}</style>
        </div>
      )}
    </div>
    </ConfigProvider>
  );
}
