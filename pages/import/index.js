// pages/import/index.js
// 수입부 한 화면 — Ant Design 파일럿(2026-09-22, 사장님 승인으로 antd 도입). 데이터 로직은 이전 버전과 동일(새 API 없음).
//   상단 Statistic KPI / 왼쪽 농장 Table(상태·잔액·D-day·클레임) / 가운데 IncomingInsight(농장 흐름 또는 차수 보드) / 오른쪽 할 일 Tabs(송금 확정·클레임·ETA·미입고)
import { useEffect, useMemo, useState } from 'react';
import { ConfigProvider, Row, Col, Card, Statistic, Table, Tag, Tabs, Button, Input, Select, Space, Typography, Tooltip, Badge, Empty, Segmented, message, theme as antdTheme } from 'antd';
import { CheckOutlined, CloseOutlined, ReloadOutlined, WarningOutlined, DollarOutlined, InboxOutlined, ClockCircleOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import koKR from 'antd/locale/ko_KR';
import { IncomingInsight } from '../incoming/insight';

const { Text } = Typography;
const fmt = (n) => (n == null || n === '' ? '–' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 }));
const ST_C = { 미송금: 'red', 부분송금: 'orange', 완납: 'green', 청구없음: 'default' };
const api = async (u, o) => { const r = await fetch(u, o); const j = await r.json().catch(() => ({})); if (!r.ok || j.success === false) throw new Error(j.error || `HTTP ${r.status}`); return j; };
// 역할 프리셋: import(수입부: 가브리엘·김원빈) / finance(경영지원: 강명훈 — 송금·지급·채권·증빙). 같은 데이터, 기본 탭·KPI·바로가기만 다르다.
const FIN_LINKS = [['/incoming-price', '송금·크레딧 입력'], ['/stats/pivot-import-farm-settings', '결제일 설정'], ['/import/freight-calc', 'AWB 운임 계산기'], ['/sales/ar', '거래처별 채권'], ['/ecount/receivables', 'ECOUNT 채권'], ['/sales/tax-invoice', '세금계산서'], ['/finance/bank', '입/출금 계좌'], ['/finance/exchange', '외화/환율'], ['/sales/profit-report', '주차별 매출이익'], ['/work/drive', '업무 드라이브']];
const LINKS = [['/incoming', '입고 원장'], ['/import/freight-calc', 'AWB 운임 계산기'], ['/incoming-price', '단가·송금 입력'], ['/arrival-cost', '도착원가'], ['/freight', '운송기준원가'], ['/stats/pivot-import', '수입 피벗'], ['/stats/pivot-import-farm-settings', '결제일 설정'], ['/sales/farm-quality', '농장 품질'], ['/incoming/kakao-summary', '카톡 수량집계']];
const DDayTag = ({ pay }) => { if (!pay || !pay.unpaidN) return <Text type="secondary">–</Text>; if (!pay.day) return <a href="/stats/pivot-import-farm-settings"><Tag>결제일 설정</Tag></a>; const d = pay.dday; return <Tooltip title={`매월 ${pay.day}일 · 가장 오래된 미결 ${pay.oldestUnpaid} → 만기 ${pay.nextDue} · 미결 ${pay.unpaidN}건${pay.overdueUSD > 0.5 ? ` · 연체 $${fmt(pay.overdueUSD)}` : ''}`}><Tag color={d < 0 ? 'red' : d <= 7 ? 'orange' : 'green'} style={{ fontWeight: 700 }}>{d < 0 ? `D+${-d}` : d === 0 ? 'D-DAY' : `D-${d}`}</Tag></Tooltip>; };

export function ImportOnePage({ initialRole = 'import' } = {}) {
  const [weeks, setWeeks] = useState([]); const [year, setYear] = useState(''); const [week, setWeek] = useState(''); const [months, setMonths] = useState('6');
  const [board, setBoard] = useState(null); const [ledger, setLedger] = useState(null); const [inbox, setInbox] = useState(null); const [eta, setEta] = useState(null);
  const [farm, setFarm] = useState(''); const [view, setView] = useState('board'); const [q, setQ] = useState(''); const [stF, setStF] = useState();
  const [role, setRole] = useState(initialRole);
  const [todo, setTodo] = useState('remit'); const [edit, setEdit] = useState({}); const [tick, setTick] = useState(0); const [loading, setLoading] = useState(false); const [rightOpen, setRightOpen] = useState(true);

  useEffect(() => {
    const u = new URLSearchParams(window.location.search); if (u.get('farm')) setFarm(u.get('farm')); if (u.get('view')) setView(u.get('view'));
    if (u.get('role') === 'finance' || initialRole === 'finance') { setRole('finance'); if (!u.get('view')) setView('ledger'); setTodo('remit'); setRightOpen(true); }
    api('/api/incoming/insight?view=weeks').then((j) => { setWeeks(j.weeks); const w = j.weeks[0]; if (u.get('year') && u.get('week')) { setYear(u.get('year')); setWeek(u.get('week')); } else if (w) { setYear(String(w.year)); setWeek(w.week); } }).catch((e) => message.error(e.message));
  }, []);
  useEffect(() => { if (!year || !week) return; const u = new URLSearchParams({ year, week }); if (farm) u.set('farm', farm); if (view) u.set('view', view); if (role === 'finance') u.set('role', 'finance'); window.history.replaceState(null, '', `${window.location.pathname}?${u}`); }, [year, week, farm, view, role]);
  useEffect(() => {
    setLoading(true);
    Promise.all([year && week ? api(`/api/incoming/insight?view=board&year=${year}&week=${week}`).then(setBoard) : null, api(`/api/incoming/insight?view=ledger&months=${months}`).then(setLedger), api('/api/incoming/remit-inbox').then(setInbox).catch(() => {}), api('/api/incoming/eta').then(setEta).catch(() => {})])
      .catch((e) => message.error(e.message)).finally(() => setLoading(false));
  }, [year, week, months, tick]);

  const farms = useMemo(() => (ledger?.rows || []).filter((r) => (!q || r.farm.toLowerCase().includes(q.toLowerCase())) && (!stF || r.status === stF)), [ledger, q, stF]);
  const pendingClaims = useMemo(() => (ledger?.rows || []).flatMap((r) => r.claims.items.filter((c) => !c.confirmed || c.review).map((c) => ({ ...c, farm: r.farm }))), [ledger]);
  const etaRows = eta?.rows || []; const lateEta = etaRows.filter((r) => r.late); const missing = (board?.items || []).filter((i) => i.tag === '미입고'); const inboxRows = inbox?.rows || [];
  const act = async (body) => { try { await api('/api/incoming/remit-inbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); message.success(body.action === 'confirm' ? '송금 확정 — 잔액에 반영' : '거절 처리'); setTick((t) => t + 1); } catch (e) { message.error(e.message); } };
  const pick = (f) => { setFarm(f); setView('farm'); };
  const centerTab = farm ? 'farm' : view;
  const T = ledger?.totals || {};
  const cur = (ledger?.rows || []).find((r) => r.farm === farm);

  const farmCols = [
    { title: '농장', dataIndex: 'farm', ellipsis: true, render: (v, r) => <Space size={4}><Badge color={{ 미송금: 'red', 부분송금: 'orange', 완납: 'green', 청구없음: '#d9d9d9' }[r.status]} /><a onClick={() => pick(v)}>{v}</a></Space> },
    { title: '잔액 $', dataIndex: 'balance', align: 'right', width: 92, sorter: (a, b) => a.balance - b.balance, defaultSortOrder: 'descend', render: (v) => <Text strong type={v > 0.5 ? 'danger' : 'success'}>{fmt(v)}</Text> },
    { title: 'D-day', key: 'dday', width: 74, sorter: (a, b) => (a.pay?.dday ?? 9999) - (b.pay?.dday ?? 9999), render: (_, r) => <DDayTag pay={r.pay} /> },
    { title: '클레임', key: 'claims', width: 70, align: 'right', sorter: (a, b) => a.claims.pending - b.claims.pending || a.claims.n - b.claims.n, render: (_, r) => r.claims.n ? <Badge count={r.claims.pending} size="small" offset={[6, 0]}><span>{r.claims.n}</span></Badge> : <Text type="secondary">–</Text> },
  ];
  const remitCols = [
    { title: '받는 분', dataIndex: 'payee', ellipsis: true, render: (v, r) => <><div><Text strong>{v}</Text></div><Text type="secondary" style={{ fontSize: 11 }}>{r.date} · {r.currency} {fmt(r.amountOrig ?? r.amountUSD)}</Text></> },
    { title: '농장 / 차수', key: 'farm', width: 190, render: (_, r) => { const ed = edit[r.key] || {}; return <Space direction="vertical" size={2} style={{ width: '100%' }}><Select showSearch size="small" style={{ width: '100%' }} placeholder="농장" value={ed.farmName ?? (r.farm || undefined)} onChange={(v) => setEdit({ ...edit, [r.key]: { ...ed, farmName: v } })} options={(inbox?.farms || []).map((f) => ({ value: f, label: f }))} /><Input size="small" placeholder="차수 38-01,38-02" value={ed.weeks ?? r.weeks ?? ''} onChange={(e) => setEdit({ ...edit, [r.key]: { ...ed, weeks: e.target.value } })} />{r.score != null && <Text type="secondary" style={{ fontSize: 10 }}>자동 매칭 {Math.round(r.score * 100)}%</Text>}</Space>; } },
    { title: '', key: 'act', width: 84, render: (_, r) => { const fv = (edit[r.key] || {}).farmName ?? r.farm; return <Space size={2}><Tooltip title={r.currency !== 'USD' ? 'USD만 자동 확정' : '확정 → 잔액 반영'}><Button type="primary" size="small" icon={<CheckOutlined />} disabled={!fv || r.currency !== 'USD'} onClick={() => act({ action: 'confirm', key: r.key, farmName: fv, weeks: (edit[r.key] || {}).weeks ?? r.weeks ?? '' })} /></Tooltip><Button size="small" danger icon={<CloseOutlined />} onClick={() => act({ action: 'reject', key: r.key })} /></Space>; } },
  ];

  return (
    <ConfigProvider locale={koKR} theme={{ algorithm: antdTheme.defaultAlgorithm, token: { colorPrimary: '#1166BB', borderRadius: 6, fontSize: 12 } }}>
      <div style={{ padding: 4 }}>
        <Row gutter={[6, 6]} align="middle" style={{ marginBottom: 6 }}>
          <Col><Space><Text strong style={{ fontSize: 15 }}>수입부</Text>
            <Select size="small" style={{ width: 130 }} value={year && week ? `${year}|${week}` : undefined} onChange={(v) => { const [y, w] = v.split('|'); setYear(y); setWeek(w); }} options={weeks.map((w) => ({ value: `${w.year}|${w.week}`, label: `${w.year} ${w.week}` }))} />
            <Segmented size="small" value={months} onChange={setMonths} options={[{ label: '3개월', value: '3' }, { label: '6개월', value: '6' }, { label: '12개월', value: '12' }]} />
            <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={() => setTick((t) => t + 1)} /></Space></Col>
          <Col flex="auto" />
          <Col><Space size={4} wrap><Segmented size="small" value={role} onChange={(r) => { setRole(r); if (r === 'finance') { setFarm(''); setView('ledger'); setTodo('remit'); setRightOpen(true); } else { setView('board'); } }} options={[{ label: '수입부', value: 'import' }, { label: '경영지원', value: 'finance' }]} />{(role === 'finance' ? FIN_LINKS : LINKS).map(([h, l]) => <Button key={h} size="small" type="text" href={h}>{l}</Button>)}<Button size="small" onClick={() => setRightOpen(!rightOpen)}>{rightOpen ? '할 일 접기' : '할 일 열기'}</Button></Space></Col>
        </Row>

        {role === 'finance' ? <Row gutter={[6, 6]} style={{ marginBottom: 6 }}>
          <Col flex="1 1 240px"><Card size="small" hoverable onClick={() => { setFarm(''); setView('ledger'); }}><Statistic title="농장 잔액 = 청구 − 크레딧 − 송금 (USD)" value={ledger ? `${fmt(T.balance)}` : '–'} suffix={<Text type="secondary" style={{ fontSize: 12 }}>미송금 {T.unpaid ?? '–'} · 부분 {T.partial ?? '–'}농장</Text>} valueStyle={{ fontSize: 15, color: T.balance > 0 ? '#cf1322' : '#3f8600' }} prefix={<DollarOutlined />} /></Card></Col>
          <Col flex="1 1 170px"><Card size="small" hoverable onClick={() => { setFarm(''); setView('ledger'); }}><Statistic title="결제 연체 / 7일 내 만기" value={`${T.overdueFarms ?? '–'}농장 $${fmt(T.overdueUSD)} / ${T.dueSoon ?? '–'}`} valueStyle={{ fontSize: 15, color: T.overdueFarms ? '#cf1322' : '#3f8600' }} prefix={<ClockCircleOutlined />} /></Card></Col>
          <Col flex="1 1 170px"><Card size="small" hoverable onClick={() => { setTodo('remit'); setRightOpen(true); }}><Statistic title="송금신청서 확인 대기" value={inboxRows.length} suffix={<Text type="secondary" style={{ fontSize: 12 }}>건 · ${fmt(inboxRows.reduce((a, r) => a + (r.amountUSD || 0), 0))}</Text>} valueStyle={{ fontSize: 15, color: inboxRows.length ? '#d46b08' : '#3f8600' }} /></Card></Col>
          <Col flex="1 1 150px"><Card size="small" hoverable onClick={() => { setFarm(''); setView('ledger'); }}><Statistic title="결제일 미설정 농장" value={T.noPayDay ?? '–'} valueStyle={{ fontSize: 15, color: T.noPayDay ? '#d46b08' : '#3f8600' }} prefix={<WarningOutlined />} /></Card></Col>
          <Col flex="1 1 150px"><Card size="small" hoverable onClick={() => { setTodo('claims'); setRightOpen(true); }}><Statistic title="클레임(크레딧 후보)" value={`${pendingClaims.length} / ${T.claims ?? '–'}`} valueStyle={{ fontSize: 15, color: pendingClaims.length ? '#cf1322' : undefined }} prefix={<ExclamationCircleOutlined />} /></Card></Col>
          <Col flex="1 1 170px"><Card size="small"><Statistic title="국내비용(계산기 저장분, 원)" value={ledger ? fmt(ledger.rows.reduce((a, r) => a + (r.domesticKRW || 0), 0)) : '–'} valueStyle={{ fontSize: 15 }} prefix={<InboxOutlined />} /></Card></Col>
        </Row> : <Row gutter={[6, 6]} style={{ marginBottom: 6 }}>
          <Col flex="1 1 200px"><Card size="small" hoverable onClick={() => { setFarm(''); setView('board'); }}><Statistic title={`발주 → 입고 → 분배 (${week})`} value={board ? `${fmt(board.totals.ordered)} → ${fmt(board.totals.received)} → ${fmt(board.totals.shipped)}` : '–'} valueStyle={{ fontSize: 15 }} prefix={<InboxOutlined />} /></Card></Col>
          <Col flex="1 1 120px"><Card size="small" hoverable onClick={() => { setFarm(''); setView('reconcile'); setTodo('missing'); }}><Statistic title="미입고 / 부족 / 초과 품목" value={board ? `${board.totals.missing} / ${board.totals.short} / ${board.totals.over}` : '–'} valueStyle={{ fontSize: 15, color: board?.totals.missing ? '#cf1322' : undefined }} prefix={<WarningOutlined />} /></Card></Col>
          <Col flex="1 1 260px"><Card size="small"><Statistic title="청구 − 크레딧 − 송금 = 잔액 (USD)" value={ledger ? `${fmt(T.billed)} − ${fmt(T.credit)} − ${fmt(T.remit)} = ${fmt(T.balance)}` : '–'} valueStyle={{ fontSize: 15, color: T.balance > 0 ? '#cf1322' : '#3f8600' }} prefix={<DollarOutlined />} /></Card></Col>
          <Col flex="1 1 160px"><Card size="small" hoverable onClick={() => { setTodo('remit'); setRightOpen(true); }}><Statistic title="송금 확인 대기" value={inboxRows.length} suffix={<Text type="secondary" style={{ fontSize: 12 }}>건 · ${fmt(inboxRows.reduce((a, r) => a + (r.amountUSD || 0), 0))}</Text>} valueStyle={{ fontSize: 15, color: inboxRows.length ? '#d46b08' : '#3f8600' }} /></Card></Col>
          <Col flex="1 1 150px"><Card size="small"><Statistic title="결제 연체 / 7일 내 만기" value={`${T.overdueFarms ?? '–'}농장 $${fmt(T.overdueUSD)} / ${T.dueSoon ?? '–'}`} valueStyle={{ fontSize: 15, color: T.overdueFarms ? '#cf1322' : '#3f8600' }} prefix={<ClockCircleOutlined />} /></Card></Col>
          <Col flex="1 1 130px"><Card size="small" hoverable onClick={() => { setTodo('claims'); setRightOpen(true); }}><Statistic title="클레임 수입부 확인" value={`${pendingClaims.length} / ${T.claims ?? '–'}`} valueStyle={{ fontSize: 15, color: pendingClaims.length ? '#cf1322' : undefined }} prefix={<ExclamationCircleOutlined />} /></Card></Col>
        </Row>}

        <Row gutter={6} wrap={false} style={{ alignItems: 'flex-start' }}>
          <Col flex="0 0 300px">
            <Card size="small" title={<Space size={4}><Input.Search size="small" placeholder="농장 검색" allowClear onChange={(e) => setQ(e.target.value)} style={{ width: 150 }} /><Select size="small" allowClear placeholder="상태" style={{ width: 96 }} value={stF} onChange={setStF} options={Object.keys(ST_C).map((s) => ({ value: s, label: s }))} /></Space>} extra={<a onClick={() => { setFarm(''); setView('board'); }}>전체</a>}>
              <Table size="small" rowKey="farm" columns={farmCols} dataSource={farms} loading={loading && !ledger} pagination={{ pageSize: 25, size: 'small', showSizeChanger: false, showTotal: (n) => `${n}곳` }} scroll={{ y: 'calc(100vh - 330px)' }} rowClassName={(r) => (r.farm === farm ? 'ant-table-row-selected' : '')} onRow={(r) => ({ onClick: () => pick(r.farm), style: { cursor: 'pointer' } })} />
            </Card>
          </Col>
          <Col flex="1 1 0" style={{ minWidth: 0 }}>
            <Card size="small" title={farm ? <Space><Text strong>{farm}</Text>{cur && <Tag color={ST_C[cur.status]}>{cur.status}</Tag>}{cur && <DDayTag pay={cur.pay} />}</Space> : <Segmented size="small" value={view} onChange={setView} options={role === 'finance' ? [{ label: '농장 정산·송금', value: 'ledger' }, { label: '차수 보드', value: 'board' }, { label: '발주·입고 비교', value: 'reconcile' }] : [{ label: '차수 보드', value: 'board' }, { label: '발주·입고 비교', value: 'reconcile' }, { label: '품목 추이', value: 'product' }, { label: '입고 예정 칸반', value: 'eta' }]} />} extra={farm && <Button size="small" onClick={() => { setFarm(''); setView('board'); }}>전체로</Button>}>
              <IncomingInsight key={`${centerTab}|${farm}|${year}|${week}|${tick}`} initialTab={centerTab} initialFarm={farm} hideTabs />
            </Card>
          </Col>
          {rightOpen && <Col flex="0 0 380px">
            <Card size="small" styles={{ body: { padding: 6 } }}>
              <Tabs size="small" activeKey={todo} onChange={setTodo} items={[
                { key: 'remit', label: <Badge count={inboxRows.length} size="small" overflowCount={999} offset={[8, 0]}>송금 확인</Badge>, children: inboxRows.length ? <Table size="small" rowKey="key" columns={remitCols} dataSource={inboxRows} pagination={{ pageSize: 20, size: 'small', simple: true }} scroll={{ y: 'calc(100vh - 380px)' }} rowClassName={(r) => (r.farm ? '' : 'nv-warn')} /> : <Empty description="송금 확인 대기 없음 — 경영지원이 '해외건별송금신청' 파일을 저장하면 자동으로 들어옵니다" /> },
                { key: 'claims', label: <Badge count={pendingClaims.length} size="small" offset={[8, 0]}>클레임</Badge>, children: pendingClaims.length ? <div style={{ maxHeight: 'calc(100vh - 360px)', overflow: 'auto' }}>{pendingClaims.map((c) => <Card key={c.key} size="small" style={{ marginBottom: 6, borderColor: '#ffbb96' }}><Space direction="vertical" size={0}><Space><a onClick={() => pick(c.farm)}><Text strong>{c.farm}</Text></a><Tag>{c.week}</Tag></Space><Text>{c.cust} · {c.prod}{c.color ? ` (${c.color})` : ''} · {fmt(c.qty)} {c.unit}</Text>{c.note && <Text type="secondary">{c.note}</Text>}<Button size="small" href={`/sales/defect-deductions?year=${c.week.split('-')[0]}&week=${c.week.split('-').slice(1).join('-')}`}>불량차감 원장에서 확인</Button></Space></Card>)}</div> : <Empty description="수입부 확인 대기 클레임 없음" /> },
                { key: 'eta', label: <Badge count={lateEta.length} size="small" offset={[8, 0]}>ETA {etaRows.length}</Badge>, children: etaRows.length ? <div style={{ maxHeight: 'calc(100vh - 360px)', overflow: 'auto' }}>{etaRows.map((r) => <Card key={r.id} size="small" style={{ marginBottom: 6, borderColor: r.late ? '#ff7875' : undefined }}><Space direction="vertical" size={0}><Space><a onClick={() => pick(r.farm)}><Text strong>{r.farm}</Text></a><Tag color={r.stage === '입고등록' ? 'green' : r.late ? 'red' : 'blue'}>{r.stage}</Tag></Space><Text>{r.year} {r.week}{r.country ? ' · ' + r.country : ''} · ETA {r.eta || '미정'}{r.late ? ' · 지연' : ''}{r.awb ? ' · ' + r.awb : ''}</Text>{r.note && <Text type="secondary">{r.note}</Text>}</Space></Card>)}</div> : <Empty description="등록된 입고 예정 없음 — 가운데 '입고 예정 칸반'에서 등록" /> },
                { key: 'missing', label: <Badge count={missing.length} size="small" overflowCount={999} offset={[8, 0]}>미입고</Badge>, children: missing.length ? <Table size="small" rowKey="prodKey" dataSource={missing} pagination={false} scroll={{ y: 'calc(100vh - 360px)' }} columns={[{ title: '품목', dataIndex: 'name', ellipsis: true, render: (v, r) => <><div>{v}</div><Text type="secondary" style={{ fontSize: 11 }}>{r.country} · {r.flower}</Text></> }, { title: '발주', dataIndex: 'ordered', align: 'right', width: 70, render: fmt }]} /> : <Empty description="미입고 품목 없음" /> },
              ]} />
            </Card>
          </Col>}
        </Row>
      </div>
      <style jsx global>{`.nv-warn td{background:#fff7e6 !important}`}</style>
    </ConfigProvider>
  );
}

export default function ImportOnePageDefault() { return <ImportOnePage />; }
