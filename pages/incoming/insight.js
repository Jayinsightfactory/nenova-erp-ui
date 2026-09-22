// pages/incoming/insight.js
// 입고 인사이트 — Ant Design 통일판(2026-09-22). 데이터 로직·API는 이전과 동일, 표시만 antd(Table·Card·Statistic·Tag·Progress·Segmented).
//   차수 보드 / 발주·입고 비교 / 농장 정산·송금(+송금 자동 인식 대기함) / 농장 / 품목 / 입고 예정
// 근거: Orbit 실측(수입부가 엑셀·카톡·WhatsApp으로 손대사·ETA 추적) — docs 기획 2026-09-22
import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { ConfigProvider, Table, Card, Statistic, Tag, Progress, Segmented, Select, Input, Button, Space, Typography, Tooltip, Alert, Empty, Row, Col, DatePicker, Modal, Popconfirm, message, theme as antdTheme } from 'antd';
import { DownloadOutlined, ReloadOutlined, CheckOutlined, CloseOutlined, HistoryOutlined, MergeCellsOutlined, FileExcelOutlined } from '@ant-design/icons';
import koKR from 'antd/locale/ko_KR';
import dayjs from 'dayjs';

const { Text } = Typography;
const fmt = (n) => (n == null || n === '' ? '–' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }));
const TAG_C = { 미입고: 'red', 부족: 'volcano', 초과: 'gold', 일치: 'green', 미발주: 'purple' };
const ST_C = { 미송금: 'red', 부분송금: 'orange', 완납: 'green', 청구없음: 'default' };
const STAGE_C = ['blue', 'green', 'orange', 'purple', 'red', 'gold', 'cyan', 'default'];
export const TABS = [['board', '차수 보드'], ['reconcile', '발주·입고 비교'], ['ledger', '농장 정산·송금'], ['farm', '농장'], ['product', '품목'], ['eta', '입고 예정']];
const api = async (url, opt) => { const r = await fetch(url, opt); const j = await r.json().catch(() => ({})); if (!r.ok || j.success === false) throw new Error(j.error || `HTTP ${r.status}`); return j; };
const pct = (v, ok = [90, 110]) => v == null ? <Text type="secondary">–</Text> : <Progress percent={Math.min(100, v)} size="small" format={() => `${v}%`} status={v < ok[0] ? 'exception' : 'normal'} strokeColor={v < ok[0] ? '#ea580c' : v > ok[1] ? '#ca8a04' : '#16a34a'} style={{ minWidth: 90, margin: 0 }} />;
export const DDay = ({ pay, small }) => {
  if (!pay) return null;
  if (!pay.unpaidN) return <Text type="secondary">{small ? '' : '미결 없음'}</Text>;
  if (!pay.day) return <a href="/stats/pivot-import-farm-settings"><Tag>결제일 설정</Tag></a>;
  const d = pay.dday;
  return <Tooltip title={`결제일 매월 ${pay.day}일 · 가장 오래된 미결 ${pay.oldestUnpaid} → 만기 ${pay.nextDue} · 미결 ${pay.unpaidN}건${pay.overdueUSD > 0.5 ? ` · 연체 $${fmt(pay.overdueUSD)}` : ''}`}>
    <Space size={4}><Tag color={d < 0 ? 'red' : d <= 7 ? 'orange' : 'green'} style={{ fontWeight: 700, margin: 0 }}>{d < 0 ? `D+${-d}` : d === 0 ? 'D-DAY' : `D-${d}`}</Tag>{!small && <Text type="secondary" style={{ fontSize: 11 }}>{pay.nextDue.slice(5)}</Text>}</Space></Tooltip>;
};
const Sparks = ({ rows }) => { const m = Math.max(1, ...rows.map((r) => r.qty)); return <span style={{ display: 'inline-flex', alignItems: 'flex-end', gap: 2, height: 22 }}>{rows.map((r, i) => <Tooltip key={i} title={`${r.week}: ${fmt(r.qty)}${r.uprice != null ? ' · ' + fmt(r.uprice) : ''}`}><i style={{ display: 'inline-block', width: 7, background: '#1166BB', opacity: .55, borderRadius: '2px 2px 0 0', height: `${Math.max(8, 100 * r.qty / m)}%` }} /></Tooltip>)}</span>; };
const exportRows = (rows, name) => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name.slice(0, 30)); XLSX.writeFile(wb, `${name}.xlsx`); };

export function IncomingInsight({ initialTab, hideTabs, initialFarm } = {}) {
  const [tab, setTab] = useState(initialTab || 'board');
  const [ledger, setLedger] = useState(null); const [inbox, setInbox] = useState(null); const [inboxOpen, setInboxOpen] = useState(false); const [inboxEdit, setInboxEdit] = useState({}); const [ledgerF, setLedgerF] = useState('');
  const [weeks, setWeeks] = useState([]); const [year, setYear] = useState(''); const [week, setWeek] = useState('');
  const [err, setErr] = useState(''); const [loading, setLoading] = useState(false);
  const [board, setBoard] = useState(null); const [tagF, setTagF] = useState('');
  const [farmName, setFarmName] = useState(initialFarm || ''); const [farmData, setFarmData] = useState(null);
  const [prodQ, setProdQ] = useState(''); const [prodData, setProdData] = useState(null);
  const [months, setMonths] = useState('6');
  const [aliasOpen, setAliasOpen] = useState(false); const [alias, setAlias] = useState(null); const [aliasForm, setAliasForm] = useState({ alias: '', canonical: '' });
  const [eta, setEta] = useState(null); const [etaForm, setEtaForm] = useState({ farm: '', country: '', awb: '', eta: '', stage: '발주', note: '' }); const [etaScope, setEtaScope] = useState('active');

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (!initialTab && q.get('tab')) setTab(q.get('tab'));
    if (!initialFarm && q.get('farm')) setFarmName(q.get('farm'));
    if (q.get('q')) setProdQ(q.get('q'));
    api('/api/incoming/insight?view=weeks').then((j) => { setWeeks(j.weeks); const y = q.get('year'), w = q.get('week'); if (y && w) { setYear(y); setWeek(w); } else if (j.weeks[0]) { setYear(String(j.weeks[0].year)); setWeek(j.weeks[0].week); } }).catch((e) => setErr(e.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!year || !week || hideTabs) return;
    const q = new URLSearchParams({ tab, year, week }); if (farmName) q.set('farm', farmName); if (prodQ) q.set('q', prodQ);
    window.history.replaceState(null, '', `${window.location.pathname}?${q}`);
  }, [tab, year, week, farmName, prodQ, hideTabs]);

  const run = async (fn) => { setLoading(true); setErr(''); try { await fn(); } catch (e) { setErr(e.message); } finally { setLoading(false); } };
  const loadBoard = () => year && week && run(async () => setBoard(await api(`/api/incoming/insight?view=board&year=${year}&week=${week}`)));
  const loadFarm = (f = farmName) => f && run(async () => setFarmData(await api(`/api/incoming/insight?view=farm&farm=${encodeURIComponent(f)}&months=${months}`)));
  const loadProd = (q = prodQ) => q && run(async () => setProdData(await api(`/api/incoming/insight?view=product&q=${encodeURIComponent(q)}&months=${months}`)));
  const loadLedger = () => run(async () => setLedger(await api(`/api/incoming/insight?view=ledger&months=${months}`)));
  const loadInbox = async () => { try { setInbox(await api('/api/incoming/remit-inbox')); } catch (e) { setErr(e.message); } };
  const loadEta = () => run(async () => setEta(await api(`/api/incoming/eta${etaScope === 'week' && year && week ? `?year=${year}&week=${week}` : ''}`)));
  const inboxAct = async (body) => { try { await api('/api/incoming/remit-inbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); message.success(body.action === 'confirm' ? '송금 확정 — 잔액에 반영' : '거절 처리'); await loadInbox(); await loadLedger(); } catch (e) { message.error(e.message); } };
  const rescan = () => run(async () => { const r = await api('/api/incoming/remit-inbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'rescan' }) }); message.info(`파일 ${r.files} · 행 ${r.parsed} · 새로 ${r.inserted} · 갱신 ${r.updated} · 농장 미매칭 ${r.unmatched}`); await loadInbox(); await loadLedger(); });
  const saveEta = async (row) => { try { await api('/api/incoming/eta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ year, week, ...row }) }); setEtaForm({ farm: '', country: '', awb: '', eta: '', stage: '발주', note: '' }); loadEta(); } catch (e) { message.error(e.message); } };
  const loadAlias = async () => { try { setAlias(await api('/api/incoming/farm-alias')); } catch (e) { message.error(e.message); } };
  const aliasPost = async (body, ok) => { try { await api('/api/incoming/farm-alias', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); message.success(ok || '저장'); await loadAlias(); loadLedger(); } catch (e) { message.error(e.message); } };
  // 가브리엘 lista 엑셀(농장 클레임 리스트) — 불량차감 원장에서 그대로 생성. 파일명·시트명·헤더는 원본 규칙(nenova_26-1_lista.xlsx / 'Lista 26-1차')
  const exportLista = async () => {
    if (!year || !week) return message.warning('차수를 선택하세요');
    try {
      const j = await api(`/api/incoming/insight?view=lista&year=${year}&week=${week}`);
      if (!j.rows.length) return message.info(`${year} ${week} 불량차감(클레임) 없음`);
      const short = week.replace(/^(\d{1,2})-0?(\d)$/, '$1-$2');
      const aoa = [[`네노바 주문/클레임 리스트 — ${short}차 (${year})`], ['Lote', 'Farm', 'Variedad', 'Cantidad', 'Unidad', 'Nombre (한글)', 'Observación', '유형', '수입부확인'], ...j.rows.map((r) => [r.lote, r.farm || r.farmRaw, r.variedad, r.cantidad, r.unidad, r.nombre, r.observacion, r.tipo, r.confirmed ? 'Y' : ''])];
      const wb = XLSX.utils.book_new(); const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = [{ wch: 8 }, { wch: 18 }, { wch: 22 }, { wch: 9 }, { wch: 8 }, { wch: 14 }, { wch: 40 }, { wch: 8 }, { wch: 8 }];
      XLSX.utils.book_append_sheet(wb, ws, `Lista ${short}차`); XLSX.writeFile(wb, `nenova_${short}_lista.xlsx`);
      message.success(`${j.rows.length}행 · 농장 ${j.farms}${j.noFarm ? ` · 농장 미지정 ${j.noFarm}` : ''}`);
    } catch (e) { message.error(e.message); }
  };

  useEffect(() => { if (tab === 'board' || tab === 'reconcile') loadBoard(); }, [year, week, tab === 'board' || tab === 'reconcile']); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === 'farm' && farmName && !farmData) loadFarm(); }, [tab, farmName]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === 'product' && prodQ && !prodData) loadProd(); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === 'eta') loadEta(); }, [tab, etaScope, year, week]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === 'ledger') { loadLedger(); loadInbox(); } }, [tab, months]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = useMemo(() => (board?.items || []).filter((i) => !tagF || i.tag === tagF), [board, tagF]);
  const goFarm = (f) => { setFarmName(f); setFarmData(null); setTab('farm'); setTimeout(() => loadFarm(f), 0); };
  const goProd = (q) => { setProdQ(q); setProdData(null); setTab('product'); setTimeout(() => loadProd(q), 0); };
  const stages = eta?.stages || ['발주', '선적', '통관중', '도착', '입고등록'];
  const curLabel = year && week ? `${year} ${week}` : '';
  const sc = board ? Object.fromEntries((board.items || []).reduce((m, i) => { m.set(i.tag, (m.get(i.tag) || 0) + 1); return m; }, new Map())) : {};
  const stageOrder = ['발주', '입고', '원가·운임', '출고', '견적·거래처', '송금·경영', '품질', '미분류'];
  const stageColor = (s) => STAGE_C[stageOrder.indexOf(s)] || 'default';

  const recCols = [
    { title: '국가', dataIndex: 'country', width: 80, filters: [...new Set(items.map((i) => i.country))].filter(Boolean).map((c) => ({ text: c, value: c })), onFilter: (v, r) => r.country === v },
    { title: '꽃', dataIndex: 'flower', width: 90, ellipsis: true },
    { title: '품목', dataIndex: 'name', ellipsis: true, render: (v) => <a onClick={() => goProd(v)}>{v}</a> },
    { title: '발주', dataIndex: 'ordered', align: 'right', width: 70, sorter: (a, b) => a.ordered - b.ordered, render: fmt },
    { title: '입고', dataIndex: 'received', align: 'right', width: 70, sorter: (a, b) => a.received - b.received, render: fmt },
    { title: '차이', dataIndex: 'diff', align: 'right', width: 70, sorter: (a, b) => a.diff - b.diff, render: (v) => <Text strong type={v < 0 ? 'warning' : v > 0 ? 'secondary' : undefined} style={v < 0 ? { color: '#ea580c' } : v > 0 ? { color: '#ca8a04' } : {}}>{v > 0 ? '+' : ''}{fmt(v)}</Text> },
    { title: '입고율', dataIndex: 'fill', width: 110, sorter: (a, b) => (a.fill ?? -1) - (b.fill ?? -1), render: (v) => pct(v) },
    { title: '분배', dataIndex: 'shipped', align: 'right', width: 70, render: fmt },
    { title: '분배율', dataIndex: 'shipRate', width: 110, render: (v) => pct(v, [0, 101]) },
    { title: '판정', dataIndex: 'tag', width: 78, filters: Object.keys(TAG_C).map((t) => ({ text: t, value: t })), onFilter: (v, r) => r.tag === v, render: (t) => <Tag color={TAG_C[t]}>{t}</Tag> },
    { title: '입고 농장 (수량@단가)', dataIndex: 'farms', render: (fs) => <Space size={[4, 2]} wrap>{fs.map((f) => <a key={f.farm} onClick={() => goFarm(f.farm)}>{f.farm} <Text type="secondary">{fmt(f.qty)}{f.uprice != null ? '@' + fmt(f.uprice) : ''}</Text></a>)}</Space> },
  ];
  const ledCols = [
    { title: '농장', dataIndex: 'farm', ellipsis: true, fixed: 'left', width: 180, render: (v) => <a onClick={() => goFarm(v)}>{v}</a> },
    { title: '인보이스', dataIndex: 'invoices', align: 'right', width: 70, sorter: (a, b) => a.invoices - b.invoices },
    { title: '상품 금액', dataIndex: 'goods', align: 'right', width: 100, render: fmt, sorter: (a, b) => a.goods - b.goods },
    { title: '운임', dataIndex: 'freight', align: 'right', width: 90, render: fmt },
    { title: '청구 합계', dataIndex: 'billed', align: 'right', width: 100, render: (v) => <Text strong>{fmt(v)}</Text>, sorter: (a, b) => a.billed - b.billed },
    { title: '크레딧', dataIndex: 'credit', align: 'right', width: 80, render: fmt },
    { title: '송금', dataIndex: 'remit', align: 'right', width: 100, render: (v, r) => <>{fmt(v)}{r.pendingN ? <div><Text type="warning" style={{ fontSize: 10 }}>대기 {r.pendingN}건 {fmt(r.pendingRemit)}</Text></div> : null}</> },
    { title: '잔액', dataIndex: 'balance', align: 'right', width: 100, defaultSortOrder: 'descend', sorter: (a, b) => a.balance - b.balance, render: (v) => <Text strong type={v > 0.5 ? 'danger' : v < -0.5 ? 'warning' : 'success'}>{fmt(v)}</Text> },
    { title: '지급률', dataIndex: 'paidRate', width: 100, render: (v) => pct(v, [100, 100]) },
    { title: '상태', dataIndex: 'status', width: 80, filters: Object.keys(ST_C).map((s) => ({ text: s, value: s })), onFilter: (v, r) => r.status === v, render: (s) => <Tag color={ST_C[s]}>{s}</Tag> },
    { title: '결제 D-day', key: 'dday', width: 120, sorter: (a, b) => (a.pay?.dday ?? 9999) - (b.pay?.dday ?? 9999), render: (_, r) => <><DDay pay={r.pay} />{r.pay?.overdueUSD > 0.5 && <div><Text type="danger" style={{ fontSize: 10 }}>연체 {fmt(r.pay.overdueUSD)}</Text></div>}</> },
    { title: '클레임', key: 'claims', width: 90, align: 'right', sorter: (a, b) => a.claims.n - b.claims.n, render: (_, r) => r.claims.n ? <Tooltip title={`수량 ${fmt(r.claims.qty)} · 크레딧 반영 ${r.claims.credited} · 수입부 확인 대기 ${r.claims.pending}`}>{r.claims.n}건{r.claims.pending ? <Text type="danger"> (대기 {r.claims.pending})</Text> : null}</Tooltip> : <Text type="secondary">–</Text> },
    { title: '마지막 입고', dataIndex: 'lastInput', width: 120, render: (v, r) => <>{v}{r.pay?.lastInputDays != null && <Text type="secondary" style={{ fontSize: 10 }}> ({r.pay.lastInputDays}일 전)</Text>}</> },
    { title: '마지막 송금', dataIndex: 'lastRemit', width: 120, render: (v, r) => <>{v || '–'}{r.pay?.lastRemitDays != null && <Text type="secondary" style={{ fontSize: 10 }}> ({r.pay.lastRemitDays}일 전)</Text>}</> },
  ];
  const inboxCols = [
    { title: '송금(예정)일', dataIndex: 'date', width: 100 },
    { title: '받는 분(법인명)', dataIndex: 'payee', ellipsis: true },
    { title: '금액', key: 'amt', align: 'right', width: 110, render: (_, r) => `${r.currency} ${fmt(r.amountOrig ?? r.amountUSD)}` },
    { title: '농장 (제안 · 신뢰도)', key: 'farm', width: 240, render: (_, r) => { const ed = inboxEdit[r.key] || {}; return <Space size={4}><Select showSearch size="small" style={{ width: 180 }} placeholder="농장명" value={ed.farmName ?? (r.farm || undefined)} onChange={(v) => setInboxEdit({ ...inboxEdit, [r.key]: { ...ed, farmName: v } })} options={(inbox?.farms || []).map((f) => ({ value: f, label: f }))} />{r.score != null && <Text type="secondary" style={{ fontSize: 11 }}>{Math.round(r.score * 100)}%</Text>}</Space>; } },
    { title: '차수', key: 'weeks', width: 130, render: (_, r) => { const ed = inboxEdit[r.key] || {}; return <Input size="small" value={ed.weeks ?? r.weeks ?? ''} placeholder="38-01,38-02" onChange={(e) => setInboxEdit({ ...inboxEdit, [r.key]: { ...ed, weeks: e.target.value } })} />; } },
    { title: '출처 파일', dataIndex: 'fileName', ellipsis: true, render: (v) => <Text type="secondary" style={{ fontSize: 11 }}>{v}</Text> },
    { title: '', key: 'act', width: 90, render: (_, r) => { const fv = (inboxEdit[r.key] || {}).farmName ?? r.farm; return <Space size={2}><Tooltip title={r.currency !== 'USD' ? 'USD만 자동 확정(다른 통화는 송금 입력 화면에서)' : '확정 → 잔액 반영'}><Button type="primary" size="small" icon={<CheckOutlined />} disabled={!fv || r.currency !== 'USD'} onClick={() => inboxAct({ action: 'confirm', key: r.key, farmName: fv, weeks: (inboxEdit[r.key] || {}).weeks ?? r.weeks ?? '' })} /></Tooltip><Button size="small" danger icon={<CloseOutlined />} onClick={() => inboxAct({ action: 'reject', key: r.key })} /></Space>; } },
  ];

  const body = (
    <div>
      {!hideTabs && (
        <Space wrap style={{ marginBottom: 8 }}>
          <Select size="small" style={{ width: 150 }} value={year && week ? `${year}|${week}` : undefined} onChange={(v) => { const [y, w] = v.split('|'); setYear(y); setWeek(w); }} options={weeks.map((w) => ({ value: `${w.year}|${w.week}`, label: `${w.year} ${w.week} (${w.n})` }))} />
          <Segmented size="small" value={months} onChange={setMonths} options={[{ label: '3개월', value: '3' }, { label: '6개월', value: '6' }, { label: '12개월', value: '12' }, { label: '24개월', value: '24' }]} />
          <Segmented size="small" value={tab} onChange={setTab} options={TABS.map(([k, l]) => ({ value: k, label: l }))} />
          <Button size="small" href={`/incoming?from=${dayjs().subtract(30, 'day').format('YYYY-MM-DD')}&to=${dayjs().format('YYYY-MM-DD')}`}>원장으로</Button>
        </Space>
      )}
      {err && <Alert type="error" showIcon message={err} style={{ marginBottom: 8 }} />}

      {/* ── 차수 보드 ── */}
      {tab === 'board' && board && (
        <>
          <Row gutter={[8, 8]} style={{ marginBottom: 8 }}>
            {[['발주 수량', board.totals.ordered], ['입고 수량', board.totals.received], ['분배(출고) 수량', board.totals.shipped], ['미입고 품목', board.totals.missing, '#cf1322'], ['부족', board.totals.short, '#ea580c'], ['초과', board.totals.over, '#ca8a04'], ['미발주 입고', board.totals.unordered, '#7c3aed']].map(([t, v, c]) => <Col key={t} flex="1 1 110px"><Card size="small"><Statistic title={t} value={v} valueStyle={{ fontSize: 16, color: c }} /></Card></Col>)}
            <Col><Button icon={<DownloadOutlined />} onClick={() => exportRows(board.items.map((i) => ({ 국가: i.country, 꽃: i.flower, 품목: i.name, 발주: i.ordered, 입고: i.received, 분배: i.shipped, 차이: i.diff, 판정: i.tag, 농장: i.farms.map((f) => `${f.farm}(${f.qty})`).join(', ') })), `차수보드_${year}_${week}`)}>엑셀</Button></Col>
          </Row>
          <Row gutter={[8, 8]}>
            {board.cards.map((c) => (
              <Col key={c.country} xs={24} md={12} xl={8} xxl={6}>
                <Card size="small" hoverable title={<Space><Text strong>{c.country}</Text><Text type="secondary">{c.products}품목</Text>{c.missing ? <Tag color="red">미입고 {c.missing}</Tag> : null}</Space>} onClick={() => { setTab('reconcile'); setTagF(''); }}>
                  <Row gutter={8}>{[['발주', c.ordered], ['입고', c.received], ['분배', c.shipped]].map(([t, v]) => <Col span={8} key={t}><Statistic title={t} value={v} valueStyle={{ fontSize: 14 }} /></Col>)}</Row>
                  <div style={{ marginTop: 6 }}><Text type="secondary" style={{ fontSize: 11 }}>입고율</Text> {pct(c.fill)} <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>분배율</Text> {pct(c.shipRate, [0, 101])}</div>
                  <Space size={[4, 4]} wrap style={{ marginTop: 6 }}>{c.farms.slice(0, 6).map((f) => <Tag key={f.farm} style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); goFarm(f.farm); }}>{f.farm} <Text type="secondary">{fmt(f.qty)}</Text></Tag>)}{c.farms.length > 6 && <Text type="secondary">+{c.farms.length - 6}</Text>}{c.farms.length === 0 && <Text type="secondary">입고 없음</Text>}</Space>
                </Card>
              </Col>))}
            {board.cards.length === 0 && <Col span={24}><Empty description="이 차수에 발주·입고 데이터가 없습니다" /></Col>}
          </Row>
        </>
      )}

      {/* ── 발주·입고 비교 ── */}
      {tab === 'reconcile' && board && (
        <Card size="small" title={<Space wrap><Text strong>발주·입고 비교 · {curLabel}</Text>{['', ...Object.keys(TAG_C)].map((t) => <Tag.CheckableTag key={t} checked={tagF === t} onChange={() => setTagF(t)}>{t || '전체'} {t ? sc[t] || 0 : board.items.length}</Tag.CheckableTag>)}</Space>} extra={<Button size="small" icon={<DownloadOutlined />} onClick={() => exportRows(items.map((i) => ({ 국가: i.country, 꽃: i.flower, 품목: i.name, 발주: i.ordered, 입고: i.received, 차이: i.diff, 입고율: i.fill, 분배: i.shipped, 분배율: i.shipRate, 판정: i.tag, 농장: i.farms.map((f) => `${f.farm}(${f.qty}${f.uprice != null ? '@' + f.uprice : ''})`).join(', ') })), `발주입고비교_${year}_${week}`)}>엑셀</Button>}>
          <Table size="small" rowKey="prodKey" columns={recCols} dataSource={items} loading={loading} pagination={{ pageSize: 50, size: 'small', showTotal: (n) => `${n}품목` }} scroll={{ x: 1100 }} />
        </Card>
      )}

      {/* ── 농장 정산·송금 ── */}
      {tab === 'ledger' && inbox && (
        <Alert type={inbox.rows.length ? 'warning' : 'success'} showIcon style={{ marginBottom: 8 }}
          message={<Space wrap><Text strong>송금 자동 인식</Text>{inbox.rows.length ? <Text>확인 대기 <Text strong type="warning">{inbox.rows.length}건</Text> · {fmt(inbox.rows.reduce((a, r) => a + (r.amountUSD || 0), 0))} USD{inbox.rows.some((r) => !r.farm) ? ` · 농장 미매칭 ${inbox.rows.filter((r) => !r.farm).length}` : ''}</Text> : <Text type="secondary">대기 없음 — 경영지원이 '해외건별송금신청' 파일을 저장하면 자동으로 들어옵니다</Text>}</Space>}
          action={<Space>{inbox.rows.length > 0 && <Button size="small" type="primary" onClick={() => setInboxOpen(!inboxOpen)}>{inboxOpen ? '접기' : '확인하기'}</Button>}<Button size="small" icon={<HistoryOutlined />} onClick={rescan}>과거 파일 소급</Button></Space>}
          description={inboxOpen && inbox.rows.length > 0 ? <Table size="small" rowKey="key" columns={inboxCols} dataSource={inbox.rows} pagination={{ pageSize: 20, size: 'small' }} scroll={{ x: 900 }} rowClassName={(r) => (r.farm ? '' : 'nv-warn')} style={{ marginTop: 8 }} /> : null} />
      )}
      {tab === 'ledger' && ledger && (
        <Card size="small" title={<Space wrap><Text strong>농장 정산·송금 ({months}개월 입고 기준)</Text>{['', '미송금', '부분송금', '완납'].map((t) => <Tag.CheckableTag key={t} checked={ledgerF === t} onChange={() => setLedgerF(t)}>{t || '전체'} {t ? ledger.rows.filter((r) => r.status === t).length : ledger.rows.length}</Tag.CheckableTag>)}
            <Text type="secondary"><Text strong type={ledger.totals.overdueFarms ? 'danger' : 'success'}>연체 {ledger.totals.overdueFarms}농장 {fmt(ledger.totals.overdueUSD)}</Text> · 7일 내 만기 {ledger.totals.dueSoon} · 결제일 미설정 {ledger.totals.noPayDay} · 클레임 {ledger.totals.claims}건(대기 {ledger.totals.claimsPending}) · 청구 {fmt(ledger.totals.billed)} · 크레딧 {fmt(ledger.totals.credit)} · 송금 {fmt(ledger.totals.remit)} · <Text strong type={ledger.totals.balance > 0 ? 'danger' : 'success'}>잔액 {fmt(ledger.totals.balance)}</Text> USD</Text></Space>}
          extra={<Space><Button size="small" icon={<MergeCellsOutlined />} onClick={() => { setAliasOpen(true); loadAlias(); }}>농장 별칭</Button><Button size="small" icon={<FileExcelOutlined />} onClick={exportLista} title="선택 차수의 불량차감을 농장용 스페인어 클레임 리스트(lista)로 내려받기">lista 엑셀 {week}</Button><Button size="small" href="/import/freight-calc">AWB 운임 계산기</Button><Button size="small" href="/incoming-price">송금·크레딧 입력</Button><Button size="small" icon={<DownloadOutlined />} onClick={() => exportRows(ledger.rows.map((r) => ({ 농장: r.farm, 인보이스: r.invoices, 상품금액: r.goods, 운임: r.freight, 청구: r.billed, 크레딧: r.credit, 송금: r.remit, 잔액: r.balance, 상태: r.status, 결제일: r.pay.day, 다음만기: r.pay.nextDue, Dday: r.pay.dday, 연체USD: r.pay.overdueUSD, 미결인보이스: r.pay.unpaidN, 클레임건수: r.claims.n, 클레임수량: r.claims.qty, 클레임확인대기: r.claims.pending, 마지막입고: r.lastInput, 마지막송금: r.lastRemit })), `농장정산_${months}개월`)}>엑셀</Button></Space>}>
          <Table size="small" rowKey="farm" columns={ledCols} dataSource={ledger.rows.filter((r) => !ledgerF || r.status === ledgerF)} loading={loading} pagination={{ pageSize: 50, size: 'small', showTotal: (n) => `${n}농장` }} scroll={{ x: 1500 }} />
        </Card>
      )}

      {/* ── 농장 프로필 ── */}
      {tab === 'farm' && (
        <>
          {!hideTabs && <Space style={{ marginBottom: 8 }}><Input style={{ width: 280 }} value={farmName} onChange={(e) => setFarmName(e.target.value)} onPressEnter={() => loadFarm()} placeholder="농장명 (예: American Flowers Medellin S.A.S)" /><Button type="primary" onClick={() => loadFarm()}>조회</Button><Text type="secondary">차수 보드·비교 탭의 농장 이름을 눌러도 옵니다</Text></Space>}
          {farmData && (
            <Row gutter={[8, 8]}>
              <Col xs={24} xl={12}>
                {farmData.ledger && (
                  <Card size="small" style={{ marginBottom: 8 }} title={<Space><Text strong>정산</Text><Tag color={ST_C[farmData.ledger.status]}>{farmData.ledger.status}</Tag><DDay pay={farmData.ledger.pay} />{farmData.ledger.pay?.day && <Text type="secondary">매월 {farmData.ledger.pay.day}일</Text>}</Space>} extra={<Button size="small" href="/incoming-price">송금·크레딧 입력</Button>}>
                    <Row gutter={8}>{[['청구(상품+운임) USD', farmData.ledger.billed], ['크레딧', farmData.ledger.credit], ['송금', farmData.ledger.remit], ['잔액', farmData.ledger.balance, farmData.ledger.balance > 0.5 ? '#cf1322' : '#3f8600']].map(([t, v, c]) => <Col span={6} key={t}><Statistic title={t} value={fmt(v)} valueStyle={{ fontSize: 14, color: c }} /></Col>)}</Row>
                    {farmData.ledger.pay?.unpaidN > 0 && <div style={{ marginTop: 8 }}><Text strong>미결 인보이스 {farmData.ledger.pay.unpaidN}건</Text> <Space size={[4, 4]} wrap>{farmData.ledger.pay.unpaid.map((u) => { const late = u.due && u.due < dayjs().format('YYYY-MM-DD'); return <Tag key={u.key} color={late ? 'red' : 'default'}>{u.date} · {fmt(u.amount)}{u.due ? ` · 만기 ${u.due.slice(5)}` : ''}</Tag>; })}</Space></div>}
                    {farmData.ledger.remits.length > 0 && <div style={{ marginTop: 8 }}><Text strong>송금 기록</Text> <Space size={[4, 4]} wrap>{farmData.ledger.remits.slice(0, 8).map((r) => <Tag key={r.key} color="blue">{r.date} · {fmt(r.amount)} USD{r.weeks ? ` (${r.weeks})` : ''}</Tag>)}</Space></div>}
                    {farmData.ledger.claims.n > 0 && <div style={{ marginTop: 8 }}><Space><Text strong>클레임 {farmData.ledger.claims.n}건</Text><Text type="secondary">수량 {fmt(farmData.ledger.claims.qty)} · 크레딧 반영 {farmData.ledger.claims.credited} · 수입부 확인 대기 {farmData.ledger.claims.pending}</Text><a href="/sales/farm-quality">농장 품질 화면</a></Space>
                      <Table size="small" rowKey="key" style={{ marginTop: 4 }} pagination={false} dataSource={farmData.ledger.claims.items} columns={[{ title: '차수', dataIndex: 'week', width: 80 }, { title: '거래처', dataIndex: 'cust', ellipsis: true }, { title: '품목', key: 'p', ellipsis: true, render: (_, c) => `${c.prod}${c.color ? ` (${c.color})` : ''}` }, { title: '수량', key: 'q', align: 'right', width: 80, render: (_, c) => `${fmt(c.qty)} ${c.unit}` }, { title: '크레딧', dataIndex: 'credited', width: 70, render: (v) => v ? <Tag color="green">반영</Tag> : <Tag color="orange">미반영</Tag> }, { title: '수입부', key: 'c', width: 70, render: (_, c) => c.confirmed && !c.review ? <Tag color="green">확인</Tag> : <Tag color="red">대기</Tag> }, { title: '메모', dataIndex: 'note', ellipsis: true }]} /></div>}
                  </Card>
                )}
                <Card size="small" title={`${farmData.farm} · 차수별 입고 (${months}개월)`} extra={<Text type="secondary">{farmData.invoices.length}건 인보이스</Text>}>
                  {farmData.weeks.map((w) => <div key={w.week} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 80px', gap: 8, alignItems: 'center', fontSize: 11 }}><span>{w.week}</span><Progress percent={Math.round(100 * w.qty / Math.max(1, ...farmData.weeks.map((x) => x.qty)))} size="small" showInfo={false} /><Text style={{ textAlign: 'right' }}>{fmt(w.qty)} <Text type="secondary">{w.products}품목</Text></Text></div>)}
                  {farmData.weeks.length === 0 && <Empty description="입고 없음" />}
                </Card>
                <Card size="small" style={{ marginTop: 8 }} title="인보이스 · 운임" extra={<Button size="small" icon={<DownloadOutlined />} onClick={() => exportRows(farmData.invoices, `농장_${farmData.farm}`)}>엑셀</Button>}>
                  <Table size="small" rowKey="WarehouseKey" dataSource={farmData.invoices} pagination={{ pageSize: 20, size: 'small' }} scroll={{ x: 800 }} columns={[{ title: '차수', key: 'w', width: 90, render: (_, v) => `${v.OrderYear} ${v.OrderWeek}` }, { title: '인보이스', dataIndex: 'InvoiceNo', width: 110 }, { title: 'AWB', dataIndex: 'AWB', width: 120 }, { title: '입력일', dataIndex: 'InputDate', width: 100 }, { title: '박스', dataIndex: 'Box', align: 'right', width: 70, render: fmt }, { title: '금액', dataIndex: 'Amount', align: 'right', width: 100, render: fmt }, { title: 'GW', dataIndex: 'GrossWeight', align: 'right', width: 70, render: fmt }, { title: 'CW', dataIndex: 'ChargeableWeight', align: 'right', width: 70, render: fmt }, { title: 'Rate', dataIndex: 'FreightRateUSD', align: 'right', width: 70, render: fmt }, { title: '운임(USD)', dataIndex: 'freightUSD', align: 'right', width: 90, render: fmt }]} />
                </Card>
              </Col>
              <Col xs={24} xl={12}>
                <Card size="small" title="품목 구성 · 단가 흐름">
                  <Table size="small" rowKey="prodKey" dataSource={farmData.products} pagination={{ pageSize: 25, size: 'small' }} columns={[{ title: '품목', dataIndex: 'name', ellipsis: true, render: (v) => <a onClick={() => goProd(v)}>{v}</a> }, { title: '꽃', dataIndex: 'flower', width: 90, ellipsis: true }, { title: '수량', dataIndex: 'qty', align: 'right', width: 80, render: fmt, sorter: (a, b) => a.qty - b.qty, defaultSortOrder: 'descend' }, { title: '박스', dataIndex: 'box', align: 'right', width: 70, render: fmt }, { title: '차수별 수량', key: 's', width: 140, render: (_, p) => <Sparks rows={p.weeks} /> }, { title: '최근 단가', key: 'l', align: 'right', width: 80, render: (_, p) => { const u = p.weeks.filter((w) => w.uprice != null); return u.length ? fmt(u[u.length - 1].uprice) : '–'; } }, { title: '이전', key: 'pv', align: 'right', width: 70, render: (_, p) => { const u = p.weeks.filter((w) => w.uprice != null); return <Text type="secondary">{u.length > 1 ? fmt(u[u.length - 2].uprice) : '–'}</Text>; } }]} />
                </Card>
              </Col>
            </Row>
          )}
        </>
      )}

      {/* ── 품목 추이 ── */}
      {tab === 'product' && (
        <>
          <Space style={{ marginBottom: 8 }} wrap><Input style={{ width: 280 }} value={prodQ} onChange={(e) => setProdQ(e.target.value)} onPressEnter={() => loadProd()} placeholder="품목명·꽃 이름 일부 (예: Hydrangea, 장미)" /><Button type="primary" onClick={() => loadProd()}>조회</Button>{prodData && <Button icon={<DownloadOutlined />} onClick={() => exportRows(prodData.products.flatMap((p) => p.rows.map((r) => ({ 품목: p.name, 국가: p.country, 차수: r.week, 농장: r.farm, 수량: r.qty, 박스: r.box, 평균단가: r.uprice, 최저: r.min, 최고: r.max }))), `품목추이_${prodQ}`)}>엑셀</Button>}</Space>
          {prodData && <Row gutter={[8, 8]}>{prodData.products.map((p) => (
            <Col key={p.prodKey} xs={24} md={12} xl={8}>
              <Card size="small" title={<Space><Text strong>{p.name}</Text><Text type="secondary">{p.country} · 농장 {p.farms.length} · 수량 {fmt(p.totalQty)}</Text></Space>}>
                <Row gutter={8}><Col span={8}><Statistic title="최근 단가" value={fmt(p.lastPrice)} valueStyle={{ fontSize: 14 }} /></Col><Col span={8}><Statistic title="이전" value={fmt(p.prevPrice)} valueStyle={{ fontSize: 14 }} /></Col><Col span={8}><Statistic title="변동" value={p.changePct == null ? '–' : `${p.changePct > 0 ? '+' : ''}${p.changePct}%`} valueStyle={{ fontSize: 14, color: p.changePct > 0 ? '#ea580c' : p.changePct < 0 ? '#16a34a' : undefined }} /></Col></Row>
                <Table size="small" rowKey={(r, i) => i} pagination={false} dataSource={p.rows.slice(-8)} style={{ marginTop: 6 }} columns={[{ title: '차수', dataIndex: 'week', width: 90 }, { title: '농장', dataIndex: 'farm', ellipsis: true, render: (v) => <a onClick={() => goFarm(v)}>{v}</a> }, { title: '수량', dataIndex: 'qty', align: 'right', width: 70, render: fmt }, { title: '단가', dataIndex: 'uprice', align: 'right', width: 70, render: fmt }]} />
              </Card>
            </Col>))}{prodData.products.length === 0 && <Col span={24}><Empty description="해당 품목 입고 없음" /></Col>}</Row>}
        </>
      )}

      {/* ── 입고 예정 보드 ── */}
      {tab === 'eta' && (
        <>
          <Space style={{ marginBottom: 8 }} wrap><Segmented size="small" value={etaScope} onChange={setEtaScope} options={[{ value: 'active', label: '진행 중 전체' }, { value: 'week', label: `${curLabel}만` }]} /><Text type="secondary">카톡·WhatsApp·엑셀에 흩어진 ETA를 한 줄씩 등록하면 원장이 올라오는 순간 자동으로 '입고등록'으로 바뀝니다</Text></Space>
          <Card size="small" style={{ marginBottom: 8 }}>
            <Space wrap>
              <Text type="secondary">{curLabel}</Text>
              <Input placeholder="농장명*" value={etaForm.farm} onChange={(e) => setEtaForm({ ...etaForm, farm: e.target.value })} style={{ width: 200 }} />
              <Input placeholder="국가" value={etaForm.country} onChange={(e) => setEtaForm({ ...etaForm, country: e.target.value })} style={{ width: 90 }} />
              <Input placeholder="AWB" value={etaForm.awb} onChange={(e) => setEtaForm({ ...etaForm, awb: e.target.value })} style={{ width: 130 }} />
              <Input placeholder="항공사" value={etaForm.airline || ''} onChange={(e) => setEtaForm({ ...etaForm, airline: e.target.value })} style={{ width: 110 }} />
              <Input placeholder="편명·도착시각" value={etaForm.flight || ''} onChange={(e) => setEtaForm({ ...etaForm, flight: e.target.value })} style={{ width: 130 }} />
              <DatePicker value={etaForm.eta ? dayjs(etaForm.eta) : null} onChange={(d) => setEtaForm({ ...etaForm, eta: d ? d.format('YYYY-MM-DD') : '' })} placeholder="ETA" />
              <Select value={etaForm.stage} onChange={(v) => setEtaForm({ ...etaForm, stage: v })} options={stages.filter((s) => s !== '입고등록').map((s) => ({ value: s, label: s }))} style={{ width: 100 }} />
              <Input placeholder="메모(예: 통관 지연, 9/29 도착 예정)" value={etaForm.note} onChange={(e) => setEtaForm({ ...etaForm, note: e.target.value })} style={{ width: 260 }} />
              <Button type="primary" disabled={!etaForm.farm} onClick={() => saveEta(etaForm)}>등록</Button>
            </Space>
          </Card>
          {eta && (eta.suggested || []).length > 0 && (
            <Alert type="info" showIcon style={{ marginBottom: 8 }} message={<span><b>드라이브에서 자동 인식된 선적 {eta.suggested.length}건</b> — 수입부 운임 시트(<code>차수_포워더_AWB_번호.xlsx</code>) 파일명 기준. 등록하면 보드에 오르고, 원장이 올라오면 자동으로 '입고등록'이 됩니다.</span>}
              description={<Table size="small" rowKey="id" dataSource={eta.suggested} pagination={eta.suggested.length > 8 ? { pageSize: 8, size: 'small' } : false} columns={[
                { title: '차수', key: 'w', width: 90, render: (_, s) => `${s.year} ${s.week}` },
                { title: '포워더', dataIndex: 'farm', width: 140 },
                { title: 'AWB', dataIndex: 'awb', width: 130, render: (v) => <Text style={{ fontFamily: 'var(--mono)' }}>{v}</Text> },
                { title: '항공사', dataIndex: 'airline', width: 120, render: (v) => v || <Text type="secondary">—</Text> },
                { title: '파일일자', dataIndex: 'fileAt', width: 100 },
                { title: '파일', dataIndex: 'note', ellipsis: true, render: (v) => <Text type="secondary" style={{ fontSize: 11 }}>{v.replace('드라이브 자동 인식 · ', '')}</Text> },
                { title: '', key: 'a', width: 150, render: (_, s) => <Space size={4}><Button size="small" type="primary" onClick={() => saveEta({ year: s.year, week: s.week, farm: s.farm, country: s.country, awb: s.awb, airline: s.airline, stage: '선적', note: s.note })}>등록</Button><Button size="small" onClick={() => api('/api/incoming/eta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dismiss: true, awb: s.awb }) }).then(loadEta)}>무시</Button></Space> },
              ]} />} />
          )}
          {eta && <Row gutter={8} wrap={false} style={{ overflowX: 'auto' }}>
            {stages.map((s, i) => { const rows = eta.rows.filter((r) => r.stage === s); return (
              <Col key={s} flex="0 0 250px"><Card size="small" title={<Space><Tag color={STAGE_C[i]}>{s}</Tag><Text type="secondary">{rows.length}</Text></Space>} styles={{ body: { padding: 6, background: '#f5f6f8' } }}>
                {rows.map((r) => (
                  <Card key={r.id} size="small" style={{ marginBottom: 6, borderColor: r.late ? '#ff7875' : undefined }}>
                    <div><Text strong>{r.farm}</Text> <Text type="secondary">{r.year} {r.week}{r.country ? ' · ' + r.country : ''}</Text></div>
                    <div style={{ fontSize: 11 }}>{r.eta ? <Text type={r.late ? 'danger' : undefined}>ETA {r.eta}{r.late ? ' · 지연' : ''}</Text> : <Text type="secondary">ETA 미정</Text>}{r.awb && <Text> · AWB {r.awb}</Text>}{r.airline && <Text type="secondary"> · {r.airline}</Text>}{r.flight && <Text type="secondary"> {r.flight}</Text>}</div>
                    {r.note && <div style={{ fontSize: 11 }}>{r.note}</div>}
                    {r.matched && <Text type="success" style={{ fontSize: 11 }}>원장 {r.matched.n}건 · 마지막 입력 {r.matched.lastInput}</Text>}
                    {s !== '입고등록' && <Space size={4} style={{ marginTop: 6 }}><Select size="small" value={r.stage} onChange={(v) => saveEta({ ...r, stage: v })} options={stages.filter((x) => x !== '입고등록').map((x) => ({ value: x, label: x }))} style={{ width: 90 }} /><DatePicker size="small" value={r.eta ? dayjs(r.eta) : null} onChange={(d) => saveEta({ ...r, eta: d ? d.format('YYYY-MM-DD') : '' })} /><Button size="small" danger icon={<CloseOutlined />} onClick={() => api('/api/incoming/eta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: r.id, deleted: true }) }).then(loadEta)} /></Space>}
                  </Card>))}
                {rows.length === 0 && <Text type="secondary">—</Text>}
              </Card></Col>); })}
          </Row>}
        </>
      )}
      <Modal title="농장명 별칭 사전 — 표기 변형을 한 농장으로" open={aliasOpen} onCancel={() => setAliasOpen(false)} footer={null} width={860}>
        <Alert type="info" showIcon style={{ marginBottom: 8 }} message="전산 원장의 농장명은 바꾸지 않습니다. 정산·송금 매칭·클레임 집계에서만 대표명으로 합산됩니다." />
        {alias && <>
          <Card size="small" title={<Text strong>자동 제안 {alias.suggestions.length}그룹</Text>} style={{ marginBottom: 8 }}>
            {alias.suggestions.length === 0 ? <Text type="secondary">겹치는 표기가 없습니다</Text> : <Table size="small" rowKey="key" pagination={false} dataSource={alias.suggestions} columns={[
              { title: '대표명(짧은 이름)', dataIndex: 'canonical', width: 200, render: (v, g) => <Select size="small" style={{ width: 190 }} value={v} onChange={(nv) => setAlias({ ...alias, suggestions: alias.suggestions.map((x) => x.key === g.key ? { ...x, canonical: nv } : x) })} options={g.names.map((n) => ({ value: n, label: n }))} /> },
              { title: '표기들', dataIndex: 'names', render: (ns) => <Space wrap size={4}>{ns.map((n) => <Tag key={n}>{n}</Tag>)}</Space> },
              { title: '', key: 'a', width: 90, render: (_, g) => <Button size="small" type="primary" onClick={() => aliasPost({ group: g.names.filter((n) => n !== g.canonical), canonical: g.canonical }, `${g.names.length}개 → ${g.canonical}`)}>합치기</Button> },
            ]} />}
          </Card>
          <Card size="small" title={<Space><Text strong>등록된 별칭 {alias.aliases.length}</Text><Input size="small" placeholder="별칭(원장 표기)" value={aliasForm.alias} onChange={(e) => setAliasForm({ ...aliasForm, alias: e.target.value })} style={{ width: 200 }} /><Select size="small" showSearch allowClear placeholder="대표 농장" value={aliasForm.canonical || undefined} onChange={(v) => setAliasForm({ ...aliasForm, canonical: v || '' })} style={{ width: 200 }} options={alias.farms.map((f) => ({ value: f.farm, label: `${f.farm} (${f.n})` }))} /><Button size="small" disabled={!aliasForm.alias || !aliasForm.canonical} onClick={() => aliasPost({ alias: aliasForm.alias, canonical: aliasForm.canonical }).then(() => setAliasForm({ alias: '', canonical: '' }))}>추가</Button></Space>}>
            <Table size="small" rowKey="alias" pagination={{ pageSize: 10, size: 'small' }} dataSource={alias.aliases} columns={[{ title: '별칭', dataIndex: 'alias' }, { title: '→ 대표명', dataIndex: 'canonical' }, { title: '등록', dataIndex: 'at', width: 100, render: (v) => String(v || '').slice(0, 10) }, { title: '', key: 'd', width: 60, render: (_, a) => <Popconfirm title="별칭 삭제?" onConfirm={() => aliasPost({ alias: a.alias, deleted: true }, '삭제')}><Button size="small" danger icon={<CloseOutlined />} /></Popconfirm> }]} />
          </Card>
        </>}
      </Modal>
      <style jsx global>{`.nv-warn td{background:#fff7e6 !important}`}</style>
    </div>
  );
  return hideTabs ? body : <ConfigProvider locale={koKR} theme={{ algorithm: antdTheme.defaultAlgorithm, token: { colorPrimary: '#1166BB', borderRadius: 6, fontSize: 12 } }}>{body}</ConfigProvider>;
}

export default function IncomingInsightPage() { return <IncomingInsight />; }
