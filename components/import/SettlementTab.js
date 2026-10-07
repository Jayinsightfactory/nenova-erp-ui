// components/import/SettlementTab.js — 수입부 통합 허브 "정산" 탭
// 흩어진 입력(송금신청서 확정 / 송금 수기 / 크레딧 / 클레임 수기칸)을 한 화면에 모은다.
// 원칙: 새 API·새 테이블·수식 없음. 각 구역은 옛 화면이 호출하던 바로 그 API를 같은 파라미터로 호출한다.
//   ① 송금신청서 확정  → POST /api/incoming/remit-inbox {action:'confirm'|'reject', key, farmName, weeks, amountUSD?}  (허브 '송금 확인' 탭과 동일)
//   ② 송금 수기 입력   → POST /api/incoming-price/remit {year, weeks, farmName, amountUSD, remitDate, memo}         (pages/incoming-price.js 송금 모달과 동일)
//   ③ 크레딧 입력      → PUT  /api/incoming-price {farmName, orderWeek, creditUSD, memo}                              (pages/incoming-price.js 크레딧 칸과 동일)
//   ④ 클레임 수기칸    → POST /api/stats/pivot-import {week, awb, invoiceNo, farmName, label, refNo, amount}          (pages/stats/pivot-import.js [＋]와 동일)
// 비USD 송금신청서: WebFarmRemit.AmountUSD 는 USD 환산액만 담는다(원통화는 AmountOrig/Currency 에 자동인식 시 이미 저장됨).
//   옛 수기 화면도 사용자가 USD 환산액을 직접 적는 구조이므로, 여기서는 confirm 이 원래 받던 선택 파라미터 amountUSD 에
//   사용자가 적은 USD 환산액을 실어 보낸다(스키마·API 변경 없음). 비워 두면 확정 버튼이 잠긴다.
import { useEffect, useMemo, useState } from 'react';
import { Select, Input, InputNumber, Button, Space, Typography, Table, Tooltip, Tag, Divider, Empty, message } from 'antd';
import { CheckOutlined, CloseOutlined, DeleteOutlined, SaveOutlined } from '@ant-design/icons';

const { Text } = Typography;
const fmt2 = (n) => (n == null || n === '' ? '–' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const api = async (u, o) => { const r = await fetch(u, { credentials: 'include', ...o }); const j = await r.json().catch(() => ({})); if (!r.ok || j.success === false) throw new Error(j.error || `HTTP ${r.status}`); return j; };
const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const H = ({ children, extra }) => <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '8px 0 4px' }}><Text strong>{children}</Text>{extra}</div>;

// ① 송금신청서 확정/거절 — 허브 '송금 확인' 탭과 정산 탭이 같이 쓴다. act(body) 는 허브의 remit-inbox POST 그대로.
export function RemitInboxTable({ rows, farms, act, scrollY = 'calc(100vh - 380px)' }) {
  const [edit, setEdit] = useState({});
  const ed = (r) => edit[r.key] || {};
  const cols = [
    { title: '받는 분', dataIndex: 'payee', ellipsis: true, render: (v, r) => <><div><Text strong>{v}</Text></div><Text type="secondary" style={{ fontSize: 11 }}>{r.date} · {r.currency} {Number(r.amountOrig ?? r.amountUSD ?? 0).toLocaleString()}</Text></> },
    { title: '농장 / 차수', key: 'farm', width: 190, render: (_, r) => <Space direction="vertical" size={2} style={{ width: '100%' }}>
      <Select showSearch size="small" style={{ width: '100%' }} placeholder="농장" value={ed(r).farmName ?? (r.farm || undefined)} onChange={(v) => setEdit({ ...edit, [r.key]: { ...ed(r), farmName: v } })} options={(farms || []).map((f) => ({ value: f, label: f }))} />
      <Input size="small" placeholder="차수 38-01,38-02" value={ed(r).weeks ?? r.weeks ?? ''} onChange={(e) => setEdit({ ...edit, [r.key]: { ...ed(r), weeks: e.target.value } })} />
      {r.currency !== 'USD' && <Tooltip title={`${r.currency} ${Number(r.amountOrig ?? 0).toLocaleString()} 의 USD 환산액을 직접 입력 (옛 송금 입력 화면과 같은 방식)`}><InputNumber size="small" style={{ width: '100%' }} prefix="$" placeholder="USD 환산액" min={0} step={0.01} value={ed(r).amountUSD} onChange={(v) => setEdit({ ...edit, [r.key]: { ...ed(r), amountUSD: v } })} status={ed(r).amountUSD > 0 ? '' : 'warning'} /></Tooltip>}
      {r.score != null && <Text type="secondary" style={{ fontSize: 10 }}>자동 매칭 {Math.round(r.score * 100)}%</Text>}
    </Space> },
    { title: '', key: 'act', width: 84, render: (_, r) => { const fv = ed(r).farmName ?? r.farm; const usd = r.currency === 'USD' ? undefined : Number(ed(r).amountUSD); const ok = !!fv && (r.currency === 'USD' || (Number.isFinite(usd) && usd > 0)); return <Space size={2}>
      <Tooltip title={r.currency !== 'USD' && !ok ? 'USD 환산액을 입력하면 확정할 수 있습니다' : '확정 → 잔액 반영'}><Button type="primary" size="small" icon={<CheckOutlined />} disabled={!ok} onClick={() => act({ action: 'confirm', key: r.key, farmName: fv, weeks: ed(r).weeks ?? r.weeks ?? '', ...(r.currency !== 'USD' ? { amountUSD: usd } : {}) })} /></Tooltip>
      <Button size="small" danger icon={<CloseOutlined />} onClick={() => act({ action: 'reject', key: r.key })} /></Space>; } },
  ];
  return <Table size="small" rowKey="key" columns={cols} dataSource={rows} pagination={{ pageSize: 20, size: 'small', simple: true }} scroll={{ y: scrollY }} rowClassName={(r) => (r.farm ? '' : 'nv-warn')} />;
}

export function SettlementTab({ year, week, weeks, farm: hubFarm, inboxRows, inboxFarms, act, onChanged }) {
  const [wk, setWk] = useState(week || '');
  const [farm, setFarm] = useState(hubFarm || '');
  const [price, setPrice] = useState(null);     // GET /api/incoming-price?weeks&year  (farms/totals/creditsRaw)
  const [remits, setRemits] = useState([]);     // GET /api/incoming-price/remit?year
  const [pivot, setPivot] = useState(null);     // GET /api/stats/pivot-import?weekStart&weekEnd (rows/adjustments)
  const [tick, setTick] = useState(0); const [busy, setBusy] = useState('');
  const [remit, setRemit] = useState({ date: today(), amount: '', memo: '', weeks: '' });
  const [credit, setCredit] = useState({ creditUSD: '', memo: '' });
  const [adj, setAdj] = useState({ target: undefined, scope: 'invoice', label: 'Claim', refNo: '', amount: '' });
  useEffect(() => { if (week) setWk(week); }, [week]);
  useEffect(() => { if (hubFarm) setFarm(hubFarm); }, [hubFarm]);

  useEffect(() => {
    if (!year || !wk) return;
    const ws = `${year}-${wk}`;
    Promise.all([
      api(`/api/incoming-price?weeks=${encodeURIComponent(wk)}&year=${year}`).then(setPrice),
      api(`/api/incoming-price/remit?year=${year}`).then((j) => setRemits(j.remits || [])),
      api(`/api/stats/pivot-import?weekStart=${ws}&weekEnd=${ws}`).then(setPivot).catch(() => setPivot(null)),
    ]).catch((e) => message.error(e.message));
  }, [year, wk, tick]);

  const farmOptions = useMemo(() => [...new Set([...(price?.farms || []), ...(inboxFarms || [])])].sort().map((f) => ({ value: f, label: f })), [price, inboxFarms]);
  // 옛 화면(incoming-price.js)과 같은 산식: 소계(운송료 제외) − 크레딧 = 송금액, 기송금 = 선택 차수와 겹치는 WebFarmRemit 합
  const creditRows = useMemo(() => (price?.creditsRaw || []).filter((c) => c.farmName === farm && c.orderWeek === wk), [price, farm, wk]);
  useEffect(() => { const c = creditRows[0]; setCredit({ creditUSD: c?.creditUSD ?? '', memo: c?.memo ?? '' }); }, [creditRows]);
  const farmRemits = useMemo(() => remits.filter((r) => r.farmName === farm && String(r.weeks || '').split(/[,\s]+/).filter(Boolean).includes(wk)), [remits, farm, wk]);
  const total = price?.totals?.[farm]?.subtotal || 0; const creditSum = creditRows.reduce((s, c) => s + (Number(c.creditUSD) || 0), 0); const net = total - creditSum;
  const remitTotal = farmRemits.reduce((s, r) => s + (Number(r.amountUSD) || 0), 0); const remain = Math.max(0, Math.round((net - remitTotal) * 100) / 100);
  useEffect(() => { setRemit((p) => ({ ...p, amount: price && farm ? remain.toFixed(2) : '', weeks: wk })); }, [price, farm, wk, remain]);
  const pivotRows = useMemo(() => (pivot?.rows || []).filter((r) => !farm || r.farmName === farm), [pivot, farm]);
  const adjRows = useMemo(() => (pivot?.adjustments || []).filter((a) => !farm || a.farmName === farm), [pivot, farm]);
  const inboxForFarm = useMemo(() => (inboxRows || []).filter((r) => !farm || r.farm === farm || !r.farm), [inboxRows, farm]);

  const run = async (key, fn, ok) => { setBusy(key); try { await fn(); message.success(ok); setTick((t) => t + 1); onChanged?.(); } catch (e) { message.error(e.message); } finally { setBusy(''); } };
  const saveRemit = () => { const amt = parseFloat(remit.amount); if (!farm) return message.warning('농장을 선택하세요'); if (Number.isNaN(amt)) return message.warning('송금액(USD)을 입력하세요');
    return run('remit', () => api('/api/incoming-price/remit', json('POST', { year, weeks: remit.weeks || wk, farmName: farm, amountUSD: amt, remitDate: remit.date, memo: remit.memo || '' })), `💸 ${farm} 송금 기록 저장`); };
  const delRemit = (rm) => run('remit', () => api('/api/incoming-price/remit', json('DELETE', { key: rm.key })), '송금 기록 삭제');
  const saveCredit = () => { if (!farm) return message.warning('농장을 선택하세요'); return run('credit', () => api('/api/incoming-price', json('PUT', { farmName: farm, orderWeek: wk, creditUSD: Number(credit.creditUSD) || 0, memo: credit.memo || '' })), `${farm} ${wk} 크레딧 저장`); };
  const delCredit = () => run('credit', () => api('/api/incoming-price', json('DELETE', { farmName: farm, orderWeek: wk })), '크레딧 삭제');
  const saveAdj = () => { const row = pivotRows.find((r) => `${r.week}|${r.awb}|${r.billNo}` === adj.target); const amt = parseFloat(adj.amount);
    if (!row) return message.warning('대상 AWB/인보이스를 선택하세요'); if (!adj.label.trim()) return message.warning('구분(텍스트)을 입력하세요. 예: Claim, 은행수수료'); if (Number.isNaN(amt)) return message.warning('금액을 입력하세요 (음수 가능, 예: -28.80)');
    return run('adj', () => api('/api/stats/pivot-import', json('POST', { week: row.week, awb: row.awb, invoiceNo: adj.scope === 'invoice' ? row.billNo : '', farmName: row.farmName, label: adj.label.trim(), refNo: adj.refNo.trim(), amount: amt })), '수기항목 저장'); };
  const delAdj = (a) => run('adj', () => api('/api/stats/pivot-import', json('DELETE', { key: a.key })), '수기항목 삭제');

  const ymd = String(year || '').slice(0, 4); const sub = wk ? wk.split('-') : [];
  return (
    <div style={{ maxHeight: 'calc(100vh - 330px)', overflow: 'auto', paddingRight: 2 }}>
      <Space wrap size={4} style={{ marginBottom: 4 }}>
        <Select size="small" style={{ width: 110 }} value={wk || undefined} placeholder="차수" onChange={setWk} options={(weeks || []).filter((w) => String(w.year) === ymd).map((w) => ({ value: w.week, label: `${w.year} ${w.week}` }))} />
        <Select size="small" showSearch allowClear style={{ width: 200 }} value={farm || undefined} placeholder="농장 선택" onChange={(v) => setFarm(v || '')} options={farmOptions} />
      </Space>
      {farm && price && <div style={{ background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 6, padding: '4px 8px', fontSize: 12 }}>
        소계 <b>{fmt2(total)}</b> − 크레딧 <b>{fmt2(creditSum)}</b> = 송금액 <b>{fmt2(net)}</b> · 기송금 <b>{fmt2(remitTotal)}</b> · 잔여 <b style={{ color: remain > 0 ? '#cf1322' : '#3f8600' }}>{fmt2(remain)}</b>
        <Text type="secondary" style={{ fontSize: 10, display: 'block' }}>입고단가 화면과 같은 산식(운송료 제외). 상세는 <a href={`/incoming-price`}>입고단가/송금 화면</a></Text></div>}

      <H extra={<Text type="secondary" style={{ fontSize: 10 }}>자동인식 대기 {inboxForFarm.length}건</Text>}>① 송금신청서 확정</H>
      {inboxForFarm.length ? <RemitInboxTable rows={inboxForFarm} farms={inboxFarms} act={act} scrollY={220} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={farm ? `${farm} 대기 없음` : '송금 확인 대기 없음'} />}

      <Divider style={{ margin: '6px 0' }} />
      <H extra={<Text type="secondary" style={{ fontSize: 10 }}>WebFarmRemit · 옛 송금 모달과 동일</Text>}>② 송금 수기 입력</H>
      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        <Space size={4}><Input size="small" type="date" style={{ width: 130 }} value={remit.date} onChange={(e) => setRemit({ ...remit, date: e.target.value })} /><Input size="small" style={{ width: 120 }} placeholder="차수 41-01,41-02" value={remit.weeks} onChange={(e) => setRemit({ ...remit, weeks: e.target.value })} /></Space>
        <Space size={4}><InputNumber size="small" style={{ width: 130 }} prefix="$" step={0.01} placeholder="송금액 (USD)" value={remit.amount === '' ? undefined : Number(remit.amount)} onChange={(v) => setRemit({ ...remit, amount: v == null ? '' : String(v) })} /><Input size="small" style={{ width: 120 }} placeholder="비고 (은행, 참조번호…)" value={remit.memo} onChange={(e) => setRemit({ ...remit, memo: e.target.value })} /><Button size="small" type="primary" icon={<SaveOutlined />} loading={busy === 'remit'} disabled={!farm} onClick={saveRemit}>저장</Button></Space>
        {farmRemits.map((rm) => <div key={rm.key} style={{ display: 'flex', gap: 6, fontSize: 12, alignItems: 'center' }}><span style={{ flex: 1 }}>💸 {rm.remitDate || String(rm.createDtm || '').slice(0, 10)} · {fmt2(rm.amountUSD)}{rm.memo ? ` · ${rm.memo}` : ''}</span><Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => delRemit(rm)} /></div>)}
      </Space>

      <Divider style={{ margin: '6px 0' }} />
      <H extra={<Text type="secondary" style={{ fontSize: 10 }}>FarmCredit · 농장×차수 1건</Text>}>③ 크레딧 차감 (불량/반품)</H>
      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        <Input.TextArea rows={2} placeholder="비고 입력…" value={credit.memo} onChange={(e) => setCredit({ ...credit, memo: e.target.value })} />
        <Space size={4}><InputNumber size="small" style={{ width: 130 }} prefix="$" min={0} step={0.01} placeholder="0.00" value={credit.creditUSD === '' ? undefined : Number(credit.creditUSD)} onChange={(v) => setCredit({ ...credit, creditUSD: v == null ? '' : String(v) })} /><Button size="small" type="primary" icon={<SaveOutlined />} loading={busy === 'credit'} disabled={!farm || !wk} onClick={saveCredit}>저장</Button><Button size="small" danger icon={<DeleteOutlined />} disabled={!farm || !creditRows.length} onClick={delCredit}>삭제</Button><a href="/incoming-price/credit-history?popup=1" target="_blank" rel="noreferrer" style={{ fontSize: 11 }}>📋 기록</a></Space>
      </Space>

      <Divider style={{ margin: '6px 0' }} />
      <H extra={<a href={`/sales/defect-deductions?year=${ymd}&week=${sub.join('-')}`} style={{ fontSize: 11 }}>불량차감 원장</a>}>④ 클레임 수기칸 (정산서)</H>
      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        <Select size="small" style={{ width: '100%' }} placeholder={pivot ? '대상 AWB · 인보이스 선택' : '피벗 로딩…'} value={adj.target} onChange={(v) => setAdj({ ...adj, target: v })} options={pivotRows.map((r) => ({ value: `${r.week}|${r.awb}|${r.billNo}`, label: `${r.week} · AWB ${r.awb || '(미상)'} · ${r.billNo || '(인보이스 없음)'} · ${r.farmName || '(농장미상)'} · ${fmt2(r.inTotal)}` }))} />
        <Space size={4} wrap>
          <Select size="small" style={{ width: 110 }} value={adj.scope} onChange={(v) => setAdj({ ...adj, scope: v })} options={[{ value: 'invoice', label: '인보이스에' }, { value: 'awb', label: 'AWB 전체에' }]} />
          <Input size="small" style={{ width: 100 }} list="nv-adj-labels" placeholder="구분" value={adj.label} onChange={(e) => setAdj({ ...adj, label: e.target.value })} />
          <datalist id="nv-adj-labels"><option value="Claim" /><option value="은행수수료" /><option value="SERVICE FEE" /></datalist>
          <Input size="small" style={{ width: 90 }} placeholder="참조번호" value={adj.refNo} onChange={(e) => setAdj({ ...adj, refNo: e.target.value })} />
          <InputNumber size="small" style={{ width: 110 }} prefix="$" step={0.01} placeholder="-28.80" value={adj.amount === '' ? undefined : Number(adj.amount)} onChange={(v) => setAdj({ ...adj, amount: v == null ? '' : String(v) })} />
          <Button size="small" type="primary" icon={<SaveOutlined />} loading={busy === 'adj'} onClick={saveAdj}>저장</Button>
        </Space>
        {adjRows.map((a) => <div key={a.key} style={{ display: 'flex', gap: 6, fontSize: 12, alignItems: 'center', background: '#fff8e1', padding: '2px 6px', borderRadius: 4 }}><Tag style={{ margin: 0 }}>{a.label}</Tag><span style={{ flex: 1 }}>{a.week} · {a.awb || '(AWB미상)'}{a.invoiceNo ? ` · ${a.invoiceNo}` : ''}{a.refNo ? ` · ${a.refNo}` : ''} · <b>{fmt2(a.amount)}</b></span><Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => delAdj(a)} /></div>)}
        <Text type="secondary" style={{ fontSize: 10 }}>수입 피벗 [＋]와 같은 저장(WebImportPivotAdj). 정산서는 <a href="/stats/pivot-import">수입 피벗</a>에서 출력</Text>
      </Space>
    </div>
  );
}
