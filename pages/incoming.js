import { useState, useEffect, useRef } from 'react';
import { apiGetExe } from '../lib/exeParity/client.js';
import { useLang } from '../lib/i18n';
import * as XLSX from 'xlsx';
import { parseWarehousePackingWorkbook } from '../lib/warehousePackingImport.js';

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
    setEndDate(today);
    setUploadMeta(m => ({ ...m, inputDate: today }));
    d.setDate(d.getDate() - 7);
    setStartDate(d.toISOString().slice(0, 10));
  }, []);

  useEffect(() => { if (startDate && endDate) load(); }, [startDate, endDate]);

  const selectMaster = (wk) => {
    const seq = ++detailSeq.current;
    setSelectedKey(wk);
    setDetailLoading(true);
    apiGetExe(`/api/warehouse/${wk}`)
      .then(d => { if (seq === detailSeq.current) setDetails(d.items||[]); })
      .catch(e => { if (seq === detailSeq.current) { setDetails([]); setErr(e.message); } })
      .finally(() => { if (seq === detailSeq.current) setDetailLoading(false); });
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
    <div>
      <div className="filter-bar">
        <span className="filter-label">업로드일자</span>
        <input type="date" className="filter-input" value={startDate} onChange={e=>setStartDate(e.target.value)} />
        <span style={{color:'var(--text3)'}}>~</span>
        <input type="date" className="filter-input" value={endDate} onChange={e=>setEndDate(e.target.value)} />
        <div className="page-actions">
          <button className="btn btn-primary" onClick={load} disabled={loading}>{loading?'조회 중...':t('새로고침')}</button>
          <button className="btn btn-success" disabled={uploading || deleting} onClick={()=>fileRef.current.click()}>📤 업로드 / Subir</button>
          <input type="file" ref={fileRef} style={{display:'none'}} accept=".xlsx,.xls" onChange={handleFileChange} />
          <button className="btn btn-danger" disabled={!selectedKey || deleting || uploading} onClick={handleDelete}>{deleting?'삭제 중...':'🗑️ 원장삭제 / Eliminar Reg.'}</button>
          <button className="btn btn-secondary" disabled={!selectedKey || detailLoading || !details.length} onClick={handleExcel}>📊 선택 상세 엑셀</button>
          <button className="btn btn-secondary" onClick={() => window.opener ? window.close() : history.back()}>✖️ 닫기 / Cerrar</button>
        </div>
      </div>

      {err && <div style={{padding:'8px 14px',background:'var(--red-bg)',color:'var(--red)',borderRadius:8,marginBottom:10,fontSize:13}}>⚠️ {err}</div>}
      {successMsg && <div style={{padding:'8px 14px',background:'var(--green-bg)',color:'var(--green)',borderRadius:8,marginBottom:10,fontSize:13}}>{successMsg}</div>}

      {/* 업로드 형식 안내 */}
      <div style={{padding:'8px 14px',background:'var(--blue-bg)',color:'var(--blue)',borderRadius:8,marginBottom:14,fontSize:12}}>
        📋 nenova.exe와 동일한 <strong>Packing 엑셀(.xlsx/.xls)</strong>만 업로드합니다. 품목 하나라도 정확히 일치하지 않으면 전체 저장이 취소됩니다.
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
                    <th style={{width:32}}>선택</th>
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
                        <td style={{fontSize:12,fontWeight:500}}>{d.DisplayName || d.ProdName}</td>
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
              <button className="btn btn-secondary" disabled={uploading} onClick={()=>{setShowUploadModal(false);setUploadData(null);}}>취소 / Cancelar</button>
              <button className="btn btn-primary" onClick={handleUpload} disabled={uploading}>{uploading?'업로드 중...':'📤 업로드 / Subir'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
