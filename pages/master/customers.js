import { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import ui from '../../styles/customerPilot.module.css';
import { apiGet, apiPost } from '../../lib/useApi';
import { downloadCsv, makeDatedFilename } from '../../lib/exportUtils';
import { CUSTOMER_COLUMNS, CUSTOMER_FIELDS, CUSTOMER_WEEKDAYS, customerCell, customerDraft, filterCustomers, validateCustomerDraft } from '../../lib/customerEditor';

export default function Customers() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedKey, setSelectedKey] = useState(null);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({});
  const [sort, setSort] = useState({ key: 'CustKey', direction: 1 });
  const [editor, setEditor] = useState(null);
  const [draft, setDraft] = useState(customerDraft());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const request = useRef(0);
  const saveBusy = useRef(false);
  const returnFocus = useRef(null);
  const [compact, setCompact] = useState(false);
  const load = async (selectAfter) => {
    const sequence = ++request.current;
    setLoading(true); setError('');
    try {
      const response = await apiGet('/api/master/customers');
      if (sequence !== request.current) return;
      setRows(response.data || []);
      if (selectAfter != null) setSelectedKey(selectAfter);
    } catch (e) { if (sequence === request.current) setError(e.message); }
    finally { if (sequence === request.current) setLoading(false); }
  };
  useEffect(() => { load(); return () => { request.current += 1; }; }, []);
  const selected = rows.find(row => row.CustKey === selectedKey);
  const visible = useMemo(() => filterCustomers(rows, search, filters, sort), [rows, search, filters, sort]);
  const dirty = editor && JSON.stringify(draft) !== JSON.stringify(customerDraft(editor.original));
  const closeEditor = () => {
    if (saving) return;
    if (dirty && !window.confirm('저장하지 않은 입력값을 취소할까요?')) return;
    setEditor(null); setError('');
  };
  useEffect(() => {
    if (!editor) return;
    const beforeUnload = event => { if (dirty || saving) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [editor, dirty, saving]);
  const open = row => {
    returnFocus.current = document.activeElement;
    setEditor({ mode: row ? 'update' : 'create', custKey: row?.CustKey, original: customerDraft(row) });
    setDraft(customerDraft(row)); setError(''); setNotice('');
  };
  const save = async event => {
    event.preventDefault();
    if (saveBusy.current) return;
    try { validateCustomerDraft(draft); } catch (e) { setError(e.message); return; }
    saveBusy.current = true;
    setSaving(true); setError('');
    try {
      const result = await apiPost('/api/master/customers', { ...editor, values: draft });
      setEditor(null); setNotice(result.message);
      await load(result.custKey);
    } catch (e) { setError(e.message); }
    finally { saveBusy.current = false; setSaving(false); }
  };
  return <div className={`customer-page ${ui.page}`} data-compact={compact}>
    <div className={ui.heading}><div><span className={ui.eyebrow}>기준정보 / 거래처</span><h1>거래처 관리</h1></div><span className={ui.count}>전체 <strong>{rows.length.toLocaleString()}</strong>개</span></div>
    <div className="customer-toolbar">
      <input className="form-control customer-search" aria-label="거래처 전체 검색" placeholder="거래처명 · 주문코드 · 지역 · 담당자 검색" value={search} onChange={e => setSearch(e.target.value)} />
      <div className="customer-actions">
        <button className="btn btn-secondary" disabled={loading} onClick={() => load()}>새로고침</button>
        <button className="btn btn-success" onClick={() => open()}>신규</button>
        <button className="btn btn-secondary" disabled={!selected || loading} onClick={() => open(selected)}>수정</button>
        <button className="btn btn-secondary" disabled={!visible.length || loading} onClick={() => downloadCsv(makeDatedFilename('거래처목록'), CUSTOMER_COLUMNS.map(([key, label]) => ({ label, value: row => customerCell(row, key) })), visible)}>엑셀</button>
        <button className="btn btn-secondary" onClick={() => { setSearch(''); setFilters({}); setSort({ key: 'CustKey', direction: 1 }); }}>필터 초기화</button>
        <button className="btn btn-secondary" onClick={() => window.opener ? window.close() : window.history.back()}>닫기</button>
      </div>
    </div>
    {error && !editor && <div role="alert" className="customer-error">{error}</div>}
    {notice && <div role="status" className="customer-notice">{notice}</div>}
    <section className={ui.selection} aria-label="선택한 거래처 요약">{selected ? <><strong>{selected.CustName}</strong><span>그룹 {selected.Group1 || '미지정'}</span><span>주문코드 {selected.OrderCode || '미지정'}</span><span>담당자 {selected.Manager || '미지정'}</span><span>품목 {selected.ProductType || '미지정'}</span><span className={ui.note}>비고 {selected.Descr || '없음'}</span></> : <span>거래처를 선택하면 요약 정보가 표시됩니다. 두 번 클릭하거나 ‘수정’을 눌러 편집하세요.</span>}</section>
    <div className="customer-summary"><span role="status">검색 결과 <strong>{visible.length.toLocaleString()}</strong>개 {loading && '· 불러오는 중…'}</span><div className={ui.tableTools}><span>열 제목으로 정렬 · 입력칸으로 필터</span><button type="button" aria-pressed={compact} onClick={() => setCompact(v => !v)}>촘촘히 보기</button></div></div>
    <div className="customer-table-wrap" aria-busy={loading}>
      <table className="tbl customer-table"><thead>
        <tr>{CUSTOMER_COLUMNS.map(([key, label]) => <th key={key} aria-sort={sort.key === key ? sort.direction === 1 ? 'ascending' : 'descending' : 'none'}><button onClick={() => setSort(s => ({ key, direction: s.key === key ? -s.direction : 1 }))}>{label} {sort.key === key ? sort.direction === 1 ? '▲' : '▼' : ''}</button></th>)}</tr>
        <tr>{CUSTOMER_COLUMNS.map(([key, label]) => <th key={key}><input aria-label={`${label} 필터`} value={filters[key] || ''} onChange={e => setFilters(f => ({ ...f, [key]: e.target.value }))} /></th>)}</tr>
      </thead><tbody>{visible.map(row => <tr key={row.CustKey} className={selectedKey === row.CustKey ? 'selected' : ''} tabIndex={0} aria-selected={selectedKey === row.CustKey} onClick={() => setSelectedKey(row.CustKey)} onDoubleClick={() => open(row)} onKeyDown={e => { if (e.key === 'Enter') { setSelectedKey(row.CustKey); open(row); } }}>
        {CUSTOMER_COLUMNS.map(([key]) => <td key={key} title={customerCell(row, key)}>{customerCell(row, key)}</td>)}
      </tr>)}{!loading && !visible.length && <tr><td colSpan={CUSTOMER_COLUMNS.length}>검색 조건에 맞는 거래처가 없습니다.</td></tr>}</tbody></table>
    </div>
    {selected && <section className="customer-detail" aria-label="선택한 거래처 상세"><strong>{selected.CustName} <small>#{selected.CustKey}</small></strong><span>그룹: {selected.Group1 || '—'}</span><span>품목분류: {selected.ProductType || '—'}</span><span>주문코드: {selected.OrderCode || '—'}</span><p>비고: {selected.Descr || '—'}</p></section>}
    <Dialog.Root open={!!editor} onOpenChange={value => { if (!value) closeEditor(); }}>
    {editor && <Dialog.Portal><Dialog.Overlay className={ui.overlay} /><Dialog.Content asChild onInteractOutside={e => e.preventDefault()} onOpenAutoFocus={e => { e.preventDefault(); document.querySelector('[data-customer-name]')?.focus(); }} onCloseAutoFocus={e => { e.preventDefault(); returnFocus.current?.focus(); }} onEscapeKeyDown={e => { e.preventDefault(); closeEditor(); }}><form className={`customer-editor ${ui.editor}`} onSubmit={save}>
      <header><Dialog.Title asChild><strong>{editor.mode === 'create' ? '신규 거래처 등록' : `거래처 수정 · ${editor.original.CustName}`}</strong></Dialog.Title><button type="button" className="btn btn-secondary" disabled={saving} onClick={closeEditor}>닫기</button></header>
      <div className="customer-editor-body">
        <Dialog.Description className={ui.description}>거래처 기본정보를 확인한 뒤 저장하세요. * 표시는 필수 입력입니다.</Dialog.Description>
        <div className="customer-key">거래처번호 <strong>{editor.custKey ?? '저장 시 자동 생성'}</strong></div>
        {error && <div className="customer-error" role="alert">{error}</div>}
        <div className="customer-fields">{CUSTOMER_FIELDS.map(([key, label]) => <label key={key} className={key === 'Descr' || key === 'CustName' ? 'wide' : ''}><span>{label}{key === 'CustName' && ' *'}</span>
          {key === 'BaseOutDay' ? <select aria-label={label} className="form-control" disabled={saving} value={draft[key]} onChange={e => setDraft(d => ({ ...d, [key]: Number(e.target.value) }))}>{CUSTOMER_WEEKDAYS.map((day, idx) => <option key={idx} value={idx}>{day || '미지정'}</option>)}</select>
            : key === 'Descr' ? <textarea aria-label={label} className="form-control" rows={4} disabled={saving} value={draft[key]} onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))} />
              : <input aria-label={label} data-customer-name={key === 'CustName' ? '' : undefined} className="form-control" disabled={saving} required={key === 'CustName'} value={draft[key]} onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))} />}
        </label>)}</div>
      </div><footer><span>{dirty ? '저장하지 않은 변경사항이 있습니다.' : '거래처 정보를 입력해 주세요.'}</span><button type="button" className="btn btn-secondary" disabled={saving} onClick={closeEditor}>취소</button><button className="btn btn-primary" type="submit" disabled={saving}>{saving ? '저장 중…' : '저장'}</button></footer>
    </form></Dialog.Content></Dialog.Portal>}
    </Dialog.Root>
    <style jsx>{`
      .customer-page{min-width:0}.customer-toolbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px}.customer-search{width:330px;max-width:100%}.customer-actions{display:flex;gap:6px;flex-wrap:wrap;margin-left:auto}.customer-summary{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;padding:8px 10px;background:var(--bg2,#eef3f8);font-size:12px}.customer-table-wrap{overflow-x:auto;max-width:100%}.customer-table{width:100%;min-width:1450px;font-size:12px}.customer-table th button{border:0;background:none;color:inherit;font:inherit;font-weight:600;cursor:pointer;padding:5px 0;white-space:nowrap}.customer-table th input{width:100%;min-width:30px;border:1px solid var(--border,#cbd5e1);padding:4px;border-radius:3px}.customer-table td{padding:6px 8px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.customer-table tr{cursor:pointer}.customer-table tr:focus{outline:2px solid #2563eb;outline-offset:-2px}.customer-detail{border:1px solid var(--border,#cbd5e1);padding:12px;display:flex;flex-wrap:wrap;gap:14px;margin-top:10px;font-size:13px}.customer-detail p{width:100%;margin:0;white-space:pre-wrap}.customer-detail small{color:var(--text3)}.customer-notice{padding:10px;background:#e8f5ec;color:#166534;margin-bottom:8px}.customer-error{padding:10px;background:#fff1f2;color:#b91c1c;margin-bottom:8px;white-space:pre-wrap}.customer-editor{width:760px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 32px);display:flex;flex-direction:column;background:var(--surface,#fff);border-radius:10px;box-shadow:0 18px 60px #0004}.customer-editor header,.customer-editor footer{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid var(--border,#ddd)}.customer-editor header button{margin-left:auto}.customer-editor footer{border-bottom:0;border-top:1px solid var(--border,#ddd)}.customer-editor footer span{margin-right:auto;font-size:12px}.customer-editor-body{padding:14px 16px;overflow-y:auto}.customer-key{padding:0 0 12px;font-size:12px}.customer-key strong{margin-left:15px}.customer-fields{display:grid;grid-template-columns:1fr 1fr;gap:12px 20px}.customer-fields label{display:grid;grid-template-columns:100px minmax(0,1fr);align-items:center;gap:8px;font-size:12px}.customer-fields .wide{grid-column:1 / -1}.customer-fields input,.customer-fields select,.customer-fields textarea{width:100%;min-width:0}.customer-fields textarea{resize:vertical}@media(max-width:650px){.customer-fields{grid-template-columns:1fr}.customer-actions{margin-left:0}.customer-editor footer{flex-wrap:wrap}.customer-editor footer span{width:100%}.customer-summary span:last-child{display:none}}
    `}</style>
  </div>;
}
