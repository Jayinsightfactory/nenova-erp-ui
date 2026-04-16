import { useState, useEffect, useRef } from 'react';
import { apiGet } from '../lib/useApi';
import { useLang } from '../lib/i18n';
import Head from 'next/head';

// xlsx는 CDN에서 로드 (window.XLSX)
function getXLSX() {
  return typeof window !== 'undefined' ? window.XLSX : null;
}

const fmt = n => Number(n || 0).toLocaleString();

// ── CSV 파싱 유틸
function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.replace(/"/g,'').trim());
  return lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.replace(/"/g,'').trim());
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
    return obj;
  });
}

// ── Packing 양식 엑셀(.xlsx) 파싱
// 구조: Row1=메타(Grower,Weekend,Invoice), Row2=메타(AWB,Date), Row4=헤더, Row5+=데이터
function parsePackingXlsx(buffer) {
  const XLSX = getXLSX();
  if (!XLSX) throw new Error('XLSX 라이브러리가 로드되지 않았습니다.');
  const wb = XLSX.read(buffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (raw.length < 5) return { meta: {}, rows: [] };

  // 메타데이터 파싱 (Row 1, Row 2)
  const meta = {};
  const r1 = raw[1] || [];
  const r2 = raw[2] || [];
  for (let i = 0; i < r1.length; i++) {
    const v = String(r1[i] || '').trim();
    if (v === 'Grower:' || v === 'Grower')   meta.farmName  = String(r1[i+2] || r1[i+1] || '').trim();
    if (v === 'Weekend:' || v === 'Weekend') meta.orderWeek = String(r1[i+2] || r1[i+1] || '').trim();
    if (v === 'Invoice:' || v === 'Invoice') meta.invoiceNo = String(r1[i+2] || r1[i+1] || '').trim();
  }
  for (let i = 0; i < r2.length; i++) {
    const v = String(r2[i] || '').trim();
    if (v === 'AWB:' || v === 'AWB')   meta.awb       = String(r2[i+2] || r2[i+1] || '').trim();
    if (v === 'Date:' || v === 'Date') meta.inputDate = String(r2[i+2] || r2[i+1] || '').trim();
  }

  // 헤더 찾기 (COD 또는 VARIETY 포함하는 행)
  let headerIdx = -1;
  for (let i = 0; i < Math.min(10, raw.length); i++) {
    const row = raw[i].map(c => String(c || '').trim().toUpperCase());
    if (row.includes('COD') || row.some(c => c.includes('VARIETY'))) { headerIdx = i; break; }
  }
  if (headerIdx < 0) return { meta, rows: [] };

  const headers = raw[headerIdx].map(c => String(c || '').replace(/\n/g,' ').trim().toUpperCase());

  // 데이터 행 파싱 (헤더 다음 행부터, 빈 행/합계 행 제외)
  const rows = [];
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const r = raw[i];
    const obj = {};
    headers.forEach((h, j) => { obj[h] = r[j] ?? ''; });
    const name = obj['VARIETY NAME'] || obj['VARIETY'] || '';
    if (!name || typeof name !== 'string' || !name.trim()) continue;
    rows.push({
      '품목명':    name.trim(),
      '박스수량':  Number(obj['BOX'] || obj['BOXES'] || 0),
      '단수량':    Number(obj['TOTAL\nBUNCH'] || obj['TOTAL BUNCH'] || obj['BCH/ST'] || 0),
      '송이수량':  Number(obj['TOTAL STEAM'] || obj['TOTAL STEMS'] || 0),
      '단가':      Number(obj['U.PRICE'] || obj['UPRICE'] || 0),
      '총액':      Number(obj['T.PRICE'] || obj['TPRICE'] || 0),
      '박스당송이': Number(obj['STEAM BOX'] || obj['STEAM/BOX'] || 0),
      '단당송이':  Number(obj['BCH/ST'] || obj['BUNCH/ST'] || 0),
    });
  }
  return { meta, rows };
}

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
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadData, setUploadData] = useState(null);
  const [uploadMeta, setUploadMeta] = useState({ orderYear:'', orderWeek:'', farmName:'', invoiceNo:'', awb:'', inputDate: '', gw:'', cw:'', rate:'', docFee:'' });
  const fileRef = useRef();

  const load = () => {
    setLoading(true);
    apiGet('/api/warehouse', { startDate, endDate })
      .then(d => { setMasters(d.masters||[]); setErr(''); })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const d = new Date();
    const today = d.toISOString().slice(0, 10);
    setEndDate(today);
    setUploadMeta(m => ({ ...m, inputDate: today }));
    d.setDate(d.getDate() - 7);
    setStartDate(d.toISOString().slice(0, 10));
  }, []);

  useEffect(() => { if (startDate && endDate) load(); }, [startDate, endDate]);

  const selectMaster = (wk) => {
    setSelectedKey(wk);
    setDetailLoading(true);
    apiGet(`/api/warehouse/${wk}`)
      .then(d => setDetails(d.items||[]))
      .catch(() => setDetails([]))
      .finally(() => setDetailLoading(false));
  };

  const selected = masters.find(m => m.WarehouseKey === selectedKey);

  // 검색 필터
  const [masterSearch, setMasterSearch] = useState('');
  const [detailSearch, setDetailSearch] = useState('');

  const filteredMasters = masters.filter(m => {
    if (!masterSearch) return true;
    const q = masterSearch.toLowerCase();
    return (m.FarmName||'').toLowerCase().includes(q) ||
           (m.InvoiceNo||'').toLowerCase().includes(q) ||
           (m.AWB||'').toLowerCase().includes(q) ||
           (m.OrderWeek||'').includes(q);
  });

  const filteredDetails = details.filter(d => {
    if (!detailSearch) return true;
    const q = detailSearch.toLowerCase();
    return (d.ProdName||'').toLowerCase().includes(q) ||
           (d.주문코드||'').toLowerCase().includes(q);
  });

  // 파일 업로드 핸들러 (CSV + XLSX Packing 양식 지원)
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'xlsx' || ext === 'xls') {
      // 엑셀 파일 (Packing 양식)
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const { meta, rows } = parsePackingXlsx(new Uint8Array(ev.target.result));
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
    } else {
      // CSV 파일
      const reader = new FileReader();
      reader.onload = (ev) => {
        const rows = parseCSV(ev.target.result);
        if (rows.length === 0) { alert('파일을 읽을 수 없습니다. CSV 형식인지 확인하세요.'); return; }
        setUploadData(rows);
        setUploadMeta(m => ({ ...m, fileName: file.name }));
        setShowUploadModal(true);
      };
      reader.readAsText(file, 'UTF-8');
    }
    e.target.value = '';
  };

  const handleUpload = async () => {
    if (!uploadData || !uploadMeta.orderWeek || !uploadMeta.farmName) {
      alert('차수, 농장명은 필수입니다.'); return;
    }
    setUploading(true);
    try {
      // CSV 컬럼 매핑 (실제 엑셀 형식에 맞게 조정)
      const items = uploadData.map(row => ({
        prodName:    row['품목명'] || row['ProdName'] || row['품목'] || '',
        boxQty:      row['박스수량'] || row['Box'] || row['박스'] || 0,
        bunchQty:    row['단수량'] || row['Bunch'] || row['단'] || 0,
        steamQty:    row['송이수량'] || row['Steam'] || row['송이'] || 0,
        outQty:      row['출고수량'] || row['Out'] || 0,
        estQty:      row['견적수량'] || row['Est'] || 0,
        unitPrice:   row['단가'] || row['UPrice'] || 0,
        totalPrice:  row['총액'] || row['TPrice'] || 0,
        orderCode:   row['주문코드'] || row['OrderCode'] || row['CN'] || '',
        steamOf1Box: row['박스당송이'] || 0,
        steamOf1Bunch: row['단당송이'] || 0,
      })).filter(item => item.prodName);

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
      if (!data.success) throw new Error(data.error);
      setSuccessMsg(`✅ ${data.message}`);
      setShowUploadModal(false); setUploadData(null);
      setTimeout(() => setSuccessMsg(''), 5000);
      load();
    } catch (e) { alert(e.message); } finally { setUploading(false); }
  };

  const handleDelete = async () => {
    if (!selectedKey) { alert('삭제할 원장을 선택하세요.'); return; }
    if (!confirm(`[${selected?.FarmName}] 원장을 삭제하시겠습니까?`)) return;
    try {
      const res = await fetch('/api/warehouse', { method:'DELETE', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ warehouseKey: selectedKey }) });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setSuccessMsg('✅ 원장 삭제 완료');
      setSelectedKey(null); setDetails([]);
      setTimeout(() => setSuccessMsg(''), 3000);
      load();
    } catch(e) { alert(e.message); }
  };

  const handleExcel = () => {
    const rows = [['주문년도','차수','농장명','인보이스','AWB','입력일자','박스합계','단합계','송이합계']];
    masters.forEach(m => rows.push([m.OrderYear,m.OrderWeek,m.FarmName,m.InvoiceNo,m.AWB,m.InputDate,m.totalBox,m.totalBunch,m.totalSteam]));
    const csv = rows.map(r=>r.map(v=>`"${v||''}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF'+csv],{type:'text/csv'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`입고원장.csv`; a.click();
  };

  return (
    <div>
      <Head>
        <script src="https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"></script>
      </Head>
      <div className="filter-bar">
        <span className="filter-label">업로드일자</span>
        <input type="date" className="filter-input" value={startDate} onChange={e=>setStartDate(e.target.value)} />
        <span style={{color:'var(--text3)'}}>~</span>
        <input type="date" className="filter-input" value={endDate} onChange={e=>setEndDate(e.target.value)} />
        <div className="page-actions">
          <button className="btn btn-primary" onClick={load}>{t('새로고침')}</button>
          <button className="btn btn-success" onClick={()=>fileRef.current.click()}>📤 업로드 / Subir</button>
          <input type="file" ref={fileRef} style={{display:'none'}} accept=".csv,.xlsx,.xls" onChange={handleFileChange} />
          <button className="btn btn-danger" onClick={handleDelete}>🗑️ 원장삭제 / Eliminar Reg.</button>
          <button className="btn btn-secondary" onClick={handleExcel}>📊 엑셀 / Excel</button>
          <button className="btn btn-secondary" onClick={() => window.opener ? window.close() : history.back()}>✖️ 닫기 / Cerrar</button>
        </div>
      </div>

      {err && <div style={{padding:'8px 14px',background:'var(--red-bg)',color:'var(--red)',borderRadius:8,marginBottom:10,fontSize:13}}>⚠️ {err}</div>}
      {successMsg && <div style={{padding:'8px 14px',background:'var(--green-bg)',color:'var(--green)',borderRadius:8,marginBottom:10,fontSize:13}}>{successMsg}</div>}

      {/* 업로드 형식 안내 */}
      <div style={{padding:'8px 14px',background:'var(--blue-bg)',color:'var(--blue)',borderRadius:8,marginBottom:14,fontSize:12}}>
        📋 업로드 형식: <strong>Packing 엑셀(.xlsx)</strong> 또는 <strong>CSV</strong> (품목명, 박스수량, 단수량, 송이수량, 단가, 주문코드)
      </div>

      <div className="split-panel">
        {/* 왼쪽: 입고 원장 목록 */}
        <div className="card" style={{overflow:'hidden',display:'flex',flexDirection:'column'}}>
          <div className="card-header">
            <span className="card-title">입고 원장 목록</span>
            <span style={{fontSize:12,color:'var(--text3)'}}>{filteredMasters.length}/{masters.length}건</span>
          </div>
          <div style={{padding:'4px 6px',borderBottom:'1px solid var(--border)',background:'#fff'}}>
            <input className="filter-input" placeholder="농장명, 인보이스, AWB 검색..."
              value={masterSearch} onChange={e=>setMasterSearch(e.target.value)}
              style={{width:'100%',height:22,fontSize:11,border:'1px solid var(--border2)'}} />
          </div>
          <div style={{overflowX:'auto',flex:1}}>
            {loading ? <div className="skeleton" style={{margin:16,height:300,borderRadius:8}}></div> : (
              <table className="tbl" style={{minWidth:600}}>
                <thead>
                  <tr>
                    <th style={{width:32}}><input type="checkbox"/></th>
                    <th>주문년도</th><th>차수</th><th>농장명</th><th>인보이스</th><th>AWB</th><th>입력일자</th>
                    <th style={{textAlign:'right'}}>박스</th><th style={{textAlign:'right'}}>단</th><th style={{textAlign:'right'}}>송이</th>
                    <th style={{textAlign:'right'}}>GW</th><th style={{textAlign:'right'}}>CW</th><th style={{textAlign:'right'}}>Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMasters.length === 0
                    ? <tr><td colSpan={13} style={{textAlign:'center',padding:40,color:'var(--text3)'}}>데이터 없음</td></tr>
                    : filteredMasters.map(m => (
                      <tr key={m.WarehouseKey} className={selectedKey===m.WarehouseKey?'selected':''} onClick={()=>selectMaster(m.WarehouseKey)} style={{cursor:'pointer'}}>
                        <td><input type="checkbox" readOnly checked={selectedKey===m.WarehouseKey}/></td>
                        <td style={{fontFamily:'var(--mono)',fontSize:12}}>{m.OrderYear}</td>
                        <td style={{fontFamily:'var(--mono)',fontWeight:700}}>{m.OrderWeek}</td>
                        <td className="name">{m.FarmName}</td>
                        <td style={{fontFamily:'var(--mono)',fontSize:11,color:'var(--text3)'}}>{m.InvoiceNo}</td>
                        <td style={{fontFamily:'var(--mono)',fontSize:11,color:'var(--text3)'}}>{m.AWB}</td>
                        <td style={{fontFamily:'var(--mono)',fontSize:12}}>{m.InputDate}</td>
                        <td className="num">{fmt(m.totalBox)}</td>
                        <td className="num">{fmt(m.totalBunch)}</td>
                        <td className="num">{fmt(m.totalSteam)}</td>
                        <td className="num" style={{color:m.GrossWeight==null?'var(--text3)':'inherit',fontSize:11}}>{m.GrossWeight ?? '–'}</td>
                        <td className="num" style={{color:m.ChargeableWeight==null?'var(--text3)':'inherit',fontSize:11}}>{m.ChargeableWeight ?? '–'}</td>
                        <td className="num" style={{color:m.FreightRateUSD==null?'var(--text3)':'inherit',fontSize:11}}>{m.FreightRateUSD ?? '–'}</td>
                      </tr>
                    ))}
                </tbody>
                <tfoot>
                  <tr className="foot">
                    <td colSpan={7}>합계</td>
                    <td className="num">{fmt(filteredMasters.reduce((a,b)=>a+(b.totalBox||0),0))}</td>
                    <td className="num">{fmt(filteredMasters.reduce((a,b)=>a+(b.totalBunch||0),0))}</td>
                    <td className="num">{fmt(filteredMasters.reduce((a,b)=>a+(b.totalSteam||0),0))}</td>
                    <td colSpan={3}></td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>

        {/* 오른쪽: 입고 상세 목록 */}
        <div className="card" style={{overflow:'hidden',display:'flex',flexDirection:'column'}}>
          <div className="card-header">
            <span className="card-title">입고 상세 목록</span>
            {selected && <span style={{fontSize:12,color:'var(--blue)',fontWeight:600}}>{selected.FarmName} · {selected.InvoiceNo}</span>}
            <div style={{marginLeft:'auto',display:'flex',gap:6}}>
              <button className="btn btn-success btn-sm">＋ 신규 / Nuevo</button>
              <button className="btn btn-secondary btn-sm">✏️ 수정 / Editar</button>
              <button className="btn btn-danger btn-sm">🗑️ 삭제 / Eliminar</button>
            </div>
          </div>
          {selectedKey && (
            <div style={{padding:'4px 6px',borderBottom:'1px solid var(--border)',background:'#fff'}}>
              <input className="filter-input" placeholder="품목명, 주문코드 검색..."
                value={detailSearch} onChange={e=>setDetailSearch(e.target.value)}
                style={{width:'100%',height:22,fontSize:11,border:'1px solid var(--border2)'}} />
            </div>
          )}
          {!selectedKey ? (
            <div className="empty-state"><div className="empty-icon">📋</div><div className="empty-text">원장을 선택하세요</div></div>
          ) : detailLoading ? (
            <div className="skeleton" style={{margin:16,height:300,borderRadius:8}}></div>
          ) : (
            <div style={{overflowX:'auto',flex:1}}>
              <table className="tbl" style={{minWidth:700}}>
                <thead>
                  <tr>
                    <th>주문코드</th><th>품목명(색상)</th><th>단위</th>
                    <th style={{textAlign:'right'}}>단/송이</th><th style={{textAlign:'right'}}>박스/송이</th>
                    <th style={{textAlign:'right'}}>박스수량</th><th style={{textAlign:'right'}}>단수량</th><th style={{textAlign:'right'}}>송이수량</th>
                    <th style={{textAlign:'right'}}>단가</th><th style={{textAlign:'right'}}>출하단가</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDetails.length === 0
                    ? <tr><td colSpan={10} style={{textAlign:'center',padding:32,color:'var(--text3)'}}>상세 데이터 없음</td></tr>
                    : filteredDetails.map((d,i) => (
                      <tr key={i}>
                        <td style={{fontFamily:'var(--mono)',fontSize:11}}>{d.주문코드}</td>
                        <td style={{fontSize:12,fontWeight:500}}>{d.ProdName}</td>
                        <td style={{fontSize:12}}>{d.단위}</td>
                        <td className="num">{fmt(d.단송이)}</td>
                        <td className="num">{fmt(d.박스송이)}</td>
                        <td className="num">{fmt(d.BoxQuantity)}</td>
                        <td className="num">{fmt(d.BunchQuantity)}</td>
                        <td className="num">{fmt(d.SteamQuantity)}</td>
                        <td className="num">{fmt(d.단가)}</td>
                        <td className="num">{fmt(d.총액)}</td>
                      </tr>
                    ))}
                </tbody>
                <tfoot>
                  <tr className="foot">
                    <td colSpan={5}>합계</td>
                    <td className="num">{fmt(filteredDetails.reduce((a,b)=>a+(b.BoxQuantity||0),0))}</td>
                    <td className="num">{fmt(filteredDetails.reduce((a,b)=>a+(b.BunchQuantity||0),0))}</td>
                    <td className="num">{fmt(filteredDetails.reduce((a,b)=>a+(b.SteamQuantity||0),0))}</td>
                    <td className="num">{fmt(filteredDetails.reduce((a,b)=>a+(b.단가||0),0))}</td>
                    <td className="num">{fmt(filteredDetails.reduce((a,b)=>a+(b.총액||0),0))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>

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
              <button className="btn btn-secondary" onClick={()=>{setShowUploadModal(false);setUploadData(null);}}>취소 / Cancelar</button>
              <button className="btn btn-primary" onClick={handleUpload} disabled={uploading}>{uploading?'업로드 중...':'📤 업로드 / Subir'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
