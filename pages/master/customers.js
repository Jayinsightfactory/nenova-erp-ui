import { useState, useEffect } from 'react';
import { apiGet, apiPost } from '../../lib/useApi';
import { useLang } from '../../lib/i18n';

const OUTDAY_MAP = { 0: '', 4: '수요일', 5: '목요일', 6: '금요일', 7: '토요일', 1: '일요일', 2: '월요일', 3: '화요일' };

export default function Customers() {
  const { t } = useLang();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({});
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const load = () => {
    setLoading(true);
    apiGet('/api/master', { entity: 'customers' })
      .then(d => { setCustomers(d.data || []); setErr(''); })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const filtered = customers.filter(c =>
    !search || c.CustName?.includes(search) || c.Manager?.includes(search) || c.CustCode?.includes(search)
  );

  const openNew = () => { setForm({}); setSelected(null); setShowModal(true); };
  const openEdit = c => { setForm({ ...c }); setSelected(c); setShowModal(true); };

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiPost('/api/master?entity=customers', form);
      setShowModal(false);
      load();
    } catch (e) { alert(e.message); } finally { setSaving(false); }
  };

  return (
    <div>
      <div className="filter-bar">
        <input className="filter-input" placeholder="거래처명 / 코드 / 담당자" value={search} onChange={e => setSearch(e.target.value)} style={{ minWidth: 200 }} />
        <div className="page-actions">
          <button className="btn btn-primary" onClick={load}>{t('새로고침')}</button>
          <button className="btn btn-success" onClick={openNew}>＋ 신규 / Nuevo</button>
          <button className="btn btn-secondary" onClick={() => selected && openEdit(selected)}>✏️ 수정 / Editar</button>
          <button className="btn btn-secondary">📊 엑셀 / Excel</button>
          <button className="btn btn-secondary" onClick={() => window.opener ? window.close() : history.back()}>✖️ 닫기 / Cerrar</button>
        </div>
      </div>
      {err && <div style={{ padding: '10px 14px', background: 'var(--red-bg)', color: 'var(--red)', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>⚠️ {err}</div>}
      <div className="table-wrap">
        {loading ? <div className="skeleton" style={{ height: 300, borderRadius: 0 }}></div> : (
          <table className="tbl">
            <thead>
              <tr><th>#</th><th>거래처코드</th><th>거래처명</th><th>지역</th><th>대표자</th><th>담당자</th><th>전화</th><th>모바일</th><th>기본출고요일</th><th>주문코드</th></tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => (
                <tr key={c.CustKey} className={selected?.CustKey === c.CustKey ? 'selected' : ''} onClick={() => setSelected(c)} onDoubleClick={() => openEdit(c)} style={{ cursor: 'pointer' }}>
                  <td style={{ fontFamily: 'var(--mono)', color: 'var(--text3)', fontSize: 12 }}>{i + 1}</td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{c.CustCode}</td>
                  <td className="name">{c.CustName}</td>
                  <td>{c.CustArea ? <span className="badge badge-blue">{c.CustArea}</span> : '—'}</td>
                  <td style={{ fontSize: 12 }}>{c.CEO || '—'}</td>
                  <td style={{ fontSize: 12 }}>{c.Manager || '—'}</td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{c.Tel || '—'}</td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{c.Mobile || '—'}</td>
                  <td>{c.BaseOutDay ? <span className="badge badge-gray">{OUTDAY_MAP[c.BaseOutDay]}</span> : '—'}</td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{c.OrderCode || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><span className="modal-title">{selected ? '거래처 수정' : '신규 거래처 등록'}</span><button className="btn btn-secondary btn-sm" onClick={() => setShowModal(false)}>✕</button></div>
            <div className="modal-body">
              <div style={{fontWeight:'bold',fontSize:12,marginBottom:10,borderBottom:'1px solid var(--border)',paddingBottom:6}}>■ 거래처 정보</div>
              {/* 테이블 레이아웃 — 기존 프로그램과 동일 */}
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                <tbody>
                  <tr>
                    <td style={{width:90,padding:'4px 6px',textAlign:'right',fontWeight:'bold',color:'var(--text2)'}}>No.</td>
                    <td style={{padding:'4px 6px'}}><input className="form-control" value={form.CustKey||'자동생성'} readOnly style={{width:100,background:'#F0F0F0'}}/></td>
                    <td style={{width:90,padding:'4px 6px',textAlign:'right',fontWeight:'bold',color:'var(--text2)'}}>거래처코드</td>
                    <td style={{padding:'4px 6px'}}><input className="form-control" style={{width:'100%'}} value={form.custCode||form.CustCode||''} onChange={e=>setForm(f=>({...f,custCode:e.target.value}))}/></td>
                  </tr>
                  <tr>
                    <td style={{padding:'4px 6px',textAlign:'right',fontWeight:'bold',color:'var(--text2)'}}>거래처명</td>
                    <td colSpan={3} style={{padding:'4px 6px'}}><input className="form-control" style={{width:'100%',background:'#FFFFC0'}} value={form.custName||form.CustName||''} onChange={e=>setForm(f=>({...f,custName:e.target.value}))}/></td>
                  </tr>
                  <tr>
                    <td style={{padding:'4px 6px',textAlign:'right',fontWeight:'bold',color:'var(--text2)'}}>거래처그룹</td>
                    <td style={{padding:'4px 6px'}}><input className="form-control" style={{width:'100%'}} value={form.custGroup||form.Group1||''} onChange={e=>setForm(f=>({...f,custGroup:e.target.value}))}/></td>
                    <td style={{padding:'4px 6px',textAlign:'right',fontWeight:'bold',color:'var(--text2)'}}>거래처지역</td>
                    <td style={{padding:'4px 6px'}}>
                      <select className="form-control" style={{width:'100%'}} value={form.custArea||form.CustArea||''} onChange={e=>setForm(f=>({...f,custArea:e.target.value}))}>
                        <option value="">선택</option><option>경부선</option><option>양재동</option><option>지방</option><option>호남선</option>
                      </select>
                    </td>
                  </tr>
                  <tr>
                    <td style={{padding:'4px 6px',textAlign:'right',fontWeight:'bold',color:'var(--text2)'}}>사업자번호</td>
                    <td style={{padding:'4px 6px'}}><input className="form-control" style={{width:'100%'}} value={form.businessNumber||form.BusinessNumber||''} onChange={e=>setForm(f=>({...f,businessNumber:e.target.value}))}/></td>
                    <td style={{padding:'4px 6px',textAlign:'right',fontWeight:'bold',color:'var(--text2)'}}>대표자명</td>
                    <td style={{padding:'4px 6px'}}><input className="form-control" style={{width:'100%'}} value={form.ceo||form.CEO||''} onChange={e=>setForm(f=>({...f,ceo:e.target.value}))}/></td>
                  </tr>
                  <tr>
                    <td style={{padding:'4px 6px',textAlign:'right',fontWeight:'bold',color:'var(--text2)'}}>담당자</td>
                    <td style={{padding:'4px 6px'}}>
                      <select className="form-control" style={{width:'100%'}} value={form.manager||form.Manager||''} onChange={e=>setForm(f=>({...f,manager:e.target.value}))}>
                        <option value="">선택</option><option>김원영</option><option>박성수</option><option>변진형</option><option>정재훈</option>
                      </select>
                    </td>
                    <td style={{padding:'4px 6px',textAlign:'right',fontWeight:'bold',color:'var(--text2)'}}>품목분류</td>
                    <td style={{padding:'4px 6px'}}><input className="form-control" style={{width:'100%'}} value={form.useType||form.UseType||''} onChange={e=>setForm(f=>({...f,useType:e.target.value}))}/></td>
                  </tr>
                  <tr>
                    <td style={{padding:'4px 6px',textAlign:'right',fontWeight:'bold',color:'var(--text2)'}}>전화</td>
                    <td style={{padding:'4px 6px'}}><input className="form-control" style={{width:'100%'}} value={form.tel||form.Tel||''} onChange={e=>setForm(f=>({...f,tel:e.target.value}))}/></td>
                    <td style={{padding:'4px 6px',textAlign:'right',fontWeight:'bold',color:'var(--text2)'}}>모바일</td>
                    <td style={{padding:'4px 6px'}}><input className="form-control" style={{width:'100%'}} value={form.mobile||form.Mobile||''} onChange={e=>setForm(f=>({...f,mobile:e.target.value}))}/></td>
                  </tr>
                  <tr>
                    <td style={{padding:'4px 6px',textAlign:'right',fontWeight:'bold',color:'var(--text2)'}}>거래처주문코드</td>
                    <td style={{padding:'4px 6px'}}><input className="form-control" style={{width:'100%'}} value={form.orderCode||form.OrderCode||''} onChange={e=>setForm(f=>({...f,orderCode:e.target.value}))} placeholder="예: CL2"/></td>
                    <td style={{padding:'4px 6px',textAlign:'right',fontWeight:'bold',color:'var(--text2)'}}>기본출고요일</td>
                    <td style={{padding:'4px 6px'}}>
                      <select className="form-control" style={{width:'100%'}} value={form.baseOutDay||form.BaseOutDay||''} onChange={e=>setForm(f=>({...f,baseOutDay:e.target.value}))}>
                        <option value="">선택</option>
                        <option value={1}>일요일</option><option value={2}>월요일</option><option value={3}>화요일</option>
                        <option value={4}>수요일</option><option value={5}>목요일</option><option value={6}>금요일</option><option value={7}>토요일</option>
                      </select>
                    </td>
                  </tr>
                  <tr>
                    <td style={{padding:'4px 6px',textAlign:'right',fontWeight:'bold',color:'var(--text2)',verticalAlign:'top',paddingTop:8}}>비고</td>
                    <td colSpan={3} style={{padding:'4px 6px'}}>
                      <textarea className="form-control" rows={3} style={{width:'100%'}} value={form.descr||form.Descr||''} onChange={e=>setForm(f=>({...f,descr:e.target.value}))}/>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>취소 / Cancelar</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? '저장 중... / Guardando' : '💾 저장 / Guardar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
