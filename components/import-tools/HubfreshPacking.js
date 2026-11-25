import { useState } from 'react';
import WorkflowGuide from '../WorkflowGuide';
import { Alert, Button, Select, Space } from 'antd';
import {
  hubfreshItemKey, hubfreshPackingGrid, parseHubfreshInvoice, sumHubfreshRows,
} from '../../lib/hubfreshPacking.js';

const normalize = value => String(value ?? '').normalize('NFKC').trim().toLowerCase();
const quantity = rows => rows.reduce((sum, row) => sum + row.boxes, 0);
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());

export default function HubfreshPacking({ xlsx, onBack, onUpload }) {
  const [data, setData] = useState(null);
  const [products, setProducts] = useState([]);
  const [names, setNames] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [year, setYear] = useState('');
  const [week, setWeek] = useState('');
  const [date, setDate] = useState(today);
  const [awb, setAwb] = useState('');
  const [freight, setFreight] = useState('');
  const [gw, setGw] = useState('');
  const [cw, setCw] = useState('');

  async function load(file) {
    if (!file) return;
    setBusy(true);
    setData(null);
    setError('');
    setNames({});
    setProducts([]);
    try {
      if (!/\.xlsx$/i.test(file.name) || file.size > 50 * 1024 * 1024) throw new Error('50 MiB 이하의 .xlsx 파일을 선택하세요.');
      const workbook = xlsx.read(await file.arrayBuffer(), { type: 'array', sheetRows: 20001 });
      if (workbook.SheetNames.length !== 1) throw new Error('INVOICE 시트 하나가 담긴 원본 상세본을 선택하세요.');
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (xlsx.utils.decode_range(sheet['!fullref'] || sheet['!ref']).e.r >= 20000) throw new Error('20,000행 이하의 상세본을 선택하세요.');
      const parsed = parseHubfreshInvoice(xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '', range: 0 }));
      setData(parsed);
      const period = file.name.match(/[（(](\d{1,2})-(\d{1,2})[）)]/);
      setYear(file.name.match(/\b(20\d{2})(?=-)/)?.[1] || '');
      setWeek(period ? period.slice(1).map(part => part.padStart(2, '0')).join('-') : '');
      const response = await fetch('/api/import/tools/product-matches');
      const catalog = await response.json();
      if (!response.ok || !catalog.success) throw new Error(catalog.error || 'ERP 품목 조회에 실패했습니다.');
      const available = catalog.products.filter(product => product.country === 'CN' && product.selectable && product.legacyExportSafe);
      setProducts(available);
      const suggestions = {};
      for (const row of parsed.nenova) {
        const candidates = available.filter(product => (row.item && [product.ProdCode, product.ProdName].some(value => normalize(value) === normalize(row.item))) ||
          normalize(product.ProdName) === normalize([row.name, row.length].filter(Boolean).join(' ')));
        if (candidates.length === 1) suggestions[hubfreshItemKey(row)] = candidates[0].ProdName;
      }
      setNames(suggestions);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  function addInvoice(workbook, rows, label) {
    const header = ['Item Code', 'Variety Name', 'Size', 'Specification', 'Ctn No', 'Customer Code', 'Boxes', 'Bunches', 'Stems', 'Unit CNY', 'Amount CNY'];
    const summary = sumHubfreshRows(rows).map(row => [row.item, row.name, row.length, row.spec,
      [...row.cartons].join(', '), [...row.codes].join(', '), row.boxes, row.bunches, row.stems, row.price, row.amount]);
    const cartons = rows.map(row => [row.item, row.name, row.length, row.spec, row.carton, row.code,
      row.boxes, row.bunches, row.stems, row.price, row.amount, row.source]);
    for (const [tab, grid] of [
      ['INVOICE', [['HUBFRESH', data.invoice, label], ['상품대금 · 부대비 미포함'], header, ...summary,
        ['TOTAL', '', '', '', '', '', quantity(rows), rows.reduce((sum, row) => sum + row.bunches, 0),
          rows.reduce((sum, row) => sum + row.stems, 0), '', rows.reduce((sum, row) => sum + row.amount, 0)]]],
      ['CARTON DETAIL', [[...header, 'Source Row'], ...cartons]],
    ]) {
      const sheet = xlsx.utils.aoa_to_sheet(grid);
      sheet['!cols'] = [20, 34, 15, 22, 34, 20, 12, 12, 12, 14, 14, 12].map(wch => ({ wch }));
      xlsx.utils.book_append_sheet(workbook, sheet, tab);
    }
  }

  function exportFile(kind) {
    try {
      setError('');
      const workbook = xlsx.utils.book_new();
      if (kind === 'packing') {
        if (!/^\d{4}$/.test(year)) throw new Error('주문년도를 확인하세요.');
        const packing = xlsx.utils.aoa_to_sheet(hubfreshPackingGrid(data.invoice, data.nenova, names, week, date, { awb, freight, gw, cw }));
        xlsx.utils.book_append_sheet(workbook, packing, 'PACKING');
      }
      const rows = kind === 'other' ? data.other : data.nenova;
      addInvoice(workbook, rows, kind === 'other' ? '다른 업체용' : '네노바용');
      const filename = `${data.invoice}_${kind}.xlsx`;
      if (kind === 'packing' && onUpload) {
        onUpload({ file: new File([xlsx.write(workbook, { type: 'array', bookType: 'xlsx' })], filename), year });
      } else {
        xlsx.writeFile(workbook, filename);
      }
    } catch (failure) {
      setError(failure.message);
    }
  }

  const items = [...new Map((data?.nenova || []).map(row => [hubfreshItemKey(row), row])).entries()];
  const unresolved = items.filter(([key]) => !names[key]);
  const mixed = data?.review.some(row => /CL/i.test(row.code));
  return <section aria-label="중국hubfresh" style={{ paddingBottom: 40 }}>
    <Space wrap>
      <Button onClick={onBack}>국가 선택</Button>
      <h2>중국hubfresh</h2>
    </Space>
    <input aria-label="HUBFRESH 상세 인보이스" type="file" accept=".xlsx" disabled={busy || !xlsx}
      onChange={event => { load(event.target.files[0]); event.target.value = ''; }} />
    <p>고객코드와 카톤번호가 각각 표시된 HUBFRESH 상세 인보이스를 선택하세요.</p>
    <WorkflowGuide workflowId="hubfresh-packing" initialRole="수입부" />
    {busy && <p role="status">인보이스와 ERP 품목을 읽는 중입니다.</p>}
    {error && <Alert type="error" message={error} />}
    {data && <>
      <p>네노바 {quantity(data.nenova)}박스 · 다른 업체 {quantity(data.other)}박스 · 확인 필요 {quantity(data.review)}박스</p>
      {data.review.length > 0 && <Alert type="warning" message="고객코드나 카톤번호를 확인해야 하는 품목"
        description={data.review.map(row => `${row.source}행 ${row.name} (${row.code || '코드 없음'}, ${row.carton || '카톤번호 없음'})`).join(' · ')} />}
      <Space wrap>
        <Button disabled={!data.nenova.length || mixed} onClick={() => exportFile('nenova')}>네노바 인보이스</Button>
        <Button disabled={!data.other.length || mixed} onClick={() => exportFile('other')}>다른 업체 인보이스</Button>
      </Space>
      <h3>네노바 입고</h3>
      <Space wrap>
        <label>주문년도 <input value={year} onChange={event => setYear(event.target.value)} placeholder="2026" /></label>
        <label>차수 <input value={week} onChange={event => setWeek(event.target.value)} placeholder="48-01" /></label>
        <label>입고일 <input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
        <label>AWB <input value={awb} onChange={event => setAwb(event.target.value)} placeholder="선택 입력" /></label>
        <label>운송료 (CNY) <input inputMode="decimal" value={freight} onChange={event => setFreight(event.target.value)} placeholder="예: 1169" /></label>
        <label>GW (kg) <input inputMode="decimal" value={gw} onChange={event => setGw(event.target.value)} placeholder="예: 88.13" /></label>
        <label>CW (kg) <input inputMode="decimal" value={cw} onChange={event => setCw(event.target.value)} placeholder="예: 120" /></label>
      </Space>
      <p>ERP 품목 확인 필요 {unresolved.length}건</p>
      {items.map(([key, row]) => <div key={key}>
        <Select aria-label={`${row.name} ${row.length} ERP 품목`} placeholder={`${row.name} ${row.length} ERP 품목 선택`}
          style={{ width: 'min(100%, 520px)', marginBlock: 3 }} showSearch optionFilterProp="label"
          options={products.map(product => ({ value: product.ProdName, label: product.ProdName }))}
          value={names[key]} onChange={value => setNames(previous => ({ ...previous, [key]: value }))} />
      </div>)}
      <Button type="primary" disabled={busy || mixed || !items.length || unresolved.length > 0}
        onClick={() => exportFile('packing')}>{onUpload ? 'HUBFRESH 입고 업로드 열기' : '입고용 파킹리스트 다운로드'}</Button>
    </>}
  </section>;
}
