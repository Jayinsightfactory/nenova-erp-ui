// pages/import/freight-calc.js
// AWB 항공운임 계산기 — 가브리엘의 `NN차 콜롬비아 AWB운임비.xlsx`(시트마다 AWB 하나)를 웹으로 재현.
//   입력: AWB 상 운임비(USD)·박스 토탈·박스 중량(kg)·백상 창고비(원/박스)·선율 비용(원)·환율  ← 원본 시트의 노란 입력칸
//   원자료: 해당 차수 원장(WarehouseMaster/Detail)에서 AWB별 농장 × 품목군 박스 수 자동 집계(/api/incoming/insight?view=awbcalc)
//   산식(원본 그대로): 박스당 운임 = 운임비/박스 · 박스당 kg = 중량/박스 · 백상 = 박스×(백상단가) · 선율 = 선율비용×(농장박스/총박스) · 백상+선율
//   ⚠ 통관비(백상 창고료 410/460, 겸역 차감, 국내운송 정액/트럭 공식)의 정본 규칙은 미확정 → 이 화면은 계산만 하고 어디에도 저장하지 않는다.
import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { ConfigProvider, Table, Card, Select, InputNumber, Button, Space, Typography, Alert, Tag, Statistic, Row, Col, theme as antdTheme } from 'antd';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import koKR from 'antd/locale/ko_KR';

const { Text } = Typography;
const fmt = (n, d = 0) => (n == null || Number.isNaN(n) ? '–' : Number(n).toLocaleString(undefined, { maximumFractionDigits: d }));
const GROUPS = ['장미', '카네이션', '알스트로', '루스커스', '수국', '기타'];
const api = async (url) => { const r = await fetch(url); const j = await r.json().catch(() => ({})); if (!r.ok || j.success === false) throw new Error(j.error || `HTTP ${r.status}`); return j; };

export default function FreightCalcPage() {
  const [weeks, setWeeks] = useState([]); const [year, setYear] = useState(''); const [week, setWeek] = useState('');
  const [data, setData] = useState(null); const [awbIdx, setAwbIdx] = useState(0); const [err, setErr] = useState(''); const [loading, setLoading] = useState(false);
  const [inp, setInp] = useState({ freightUSD: 0, boxes: 0, kg: 0, storagePerBox: 370, sunyul: 77000, fx: 1500 });

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    api('/api/incoming/insight?view=weeks').then((j) => { setWeeks(j.weeks); const y = q.get('year'), w = q.get('week'); if (y && w) { setYear(y); setWeek(w); } else if (j.weeks[0]) { setYear(String(j.weeks[0].year)); setWeek(j.weeks[0].week); } }).catch((e) => setErr(e.message));
  }, []);
  const load = () => { if (!year || !week) return; setLoading(true); setErr(''); api(`/api/incoming/insight?view=awbcalc&year=${year}&week=${week}`).then((j) => { setData(j); setAwbIdx(0); }).catch((e) => setErr(e.message)).finally(() => setLoading(false)); };
  useEffect(load, [year, week]); // eslint-disable-line react-hooks/exhaustive-deps
  const awb = data?.awbs?.[awbIdx] || null;
  // AWB를 고르면 원장 값으로 입력칸을 채운다(원장에 운임행·CW가 있으면). 사람이 고친 값은 유지.
  useEffect(() => { if (!awb) return; setInp((p) => ({ ...p, freightUSD: awb.freightUSD || (awb.rate && awb.cw ? Math.round(awb.rate * awb.cw * 100) / 100 : p.freightUSD), boxes: awb.box || p.boxes, kg: awb.gw || awb.cw || p.kg })); }, [awbIdx, data]); // eslint-disable-line react-hooks/exhaustive-deps

  const calc = useMemo(() => {
    if (!awb) return null;
    const boxes = Number(inp.boxes) || 0; const perBoxUSD = boxes ? inp.freightUSD / boxes : 0; const perBoxKg = boxes ? inp.kg / boxes : 0;
    const groupBox = {}; for (const f of awb.farms) for (const [g, n] of Object.entries(f.groups)) groupBox[g] = (groupBox[g] || 0) + n;
    const ledgerBox = Object.values(groupBox).reduce((a, b) => a + b, 0);
    const groups = GROUPS.filter((g) => groupBox[g]).map((g) => { const n = groupBox[g]; const pct = boxes ? n / boxes * 100 : 0; return { group: g, box: n, freightUSD: n * perBoxUSD, kg: n * perBoxKg, storage: n * inp.storagePerBox, pct, sunyul: inp.sunyul * pct / 100 }; });
    const farms = awb.farms.map((f) => { const pct = boxes ? f.box / boxes * 100 : 0; const storage = f.box * inp.storagePerBox; const sunyul = inp.sunyul * pct / 100; return { farm: f.farm, box: f.box, ...Object.fromEntries(GROUPS.map((g) => [g, f.groups[g] || 0])), kg: f.box * perBoxKg, freightUSD: f.box * perBoxUSD, storage, pct, sunyul, total: storage + sunyul, totalUSD: inp.fx ? (storage + sunyul) / inp.fx : 0 }; });
    const checks = [
      { name: 'AWB 박스 = 원장 박스', ok: boxes === ledgerBox, detail: `${fmt(boxes)} vs 원장 ${fmt(ledgerBox)}` },
      { name: '운임 분배 합 = AWB 운임', ok: Math.abs(groups.reduce((a, g) => a + g.freightUSD, 0) - inp.freightUSD) < 0.01, detail: fmt(groups.reduce((a, g) => a + g.freightUSD, 0), 2) },
      { name: '중량 분배 합 = AWB 중량', ok: Math.abs(groups.reduce((a, g) => a + g.kg, 0) - inp.kg) < 0.01, detail: fmt(groups.reduce((a, g) => a + g.kg, 0), 1) },
      { name: '선율 비용 합 = 입력 선율', ok: Math.abs(farms.reduce((a, f) => a + f.sunyul, 0) - inp.sunyul) < 1, detail: fmt(farms.reduce((a, f) => a + f.sunyul, 0)) },
      { name: '비율 합 = 100%', ok: Math.abs(farms.reduce((a, f) => a + f.pct, 0) - 100) < 0.01, detail: fmt(farms.reduce((a, f) => a + f.pct, 0), 2) + '%' },
    ];
    return { perBoxUSD, perBoxKg, groups, farms, ledgerBox, checks, storageTotal: farms.reduce((a, f) => a + f.storage, 0), sunyulTotal: farms.reduce((a, f) => a + f.sunyul, 0) };
  }, [awb, inp]);

  const exportXlsx = () => {
    if (!calc) return;
    const aoa = [['AWB 항공운임 계산기', `${year} ${week}`, awb.awb], [],
      ['AWB 상 운임비(USD)', inp.freightUSD, '', '박스당 운임', calc.perBoxUSD], ['AWB 상 박스 토탈', inp.boxes, '', '박스당 kg', calc.perBoxKg], ['AWB 상 박스 중량', inp.kg], ['백상 창고비(원/박스)', inp.storagePerBox, '', '백상 합계', calc.storageTotal], ['선율 비용(원)', inp.sunyul, '', '선율 합계', calc.sunyulTotal], ['환율', inp.fx], [],
      ['품목군', '박스', '운임(USD)', 'kg', '백상 창고비', '%', '선율 비용'], ...calc.groups.map((g) => [g.group, g.box, g.freightUSD, g.kg, g.storage, g.pct, g.sunyul]), [],
      ['농장', '박스', ...GROUPS, 'kg', '운임(USD)', '백상 창고비', '%', '선율 비용', '백상+선율', 'USD 환산'], ...calc.farms.map((f) => [f.farm, f.box, ...GROUPS.map((g) => f[g]), f.kg, f.freightUSD, f.storage, f.pct, f.sunyul, f.total, f.totalUSD]), [],
      ['오류 확인'], ...calc.checks.map((c) => [c.name, c.ok ? 'true' : 'false', c.detail])];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), `${week} ${awb.awb}`.slice(0, 30)); XLSX.writeFile(wb, `${year}_${week}_AWB운임비_${awb.awb.replace(/[^\d-]/g, '')}.xlsx`);
  };

  const N = (k, step = 1, w = 120) => <InputNumber size="small" style={{ width: w }} value={inp[k]} step={step} onChange={(v) => setInp({ ...inp, [k]: Number(v) || 0 })} formatter={(v) => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} parser={(v) => v.replace(/,/g, '')} />;
  return (
    <ConfigProvider locale={koKR} theme={{ algorithm: antdTheme.defaultAlgorithm, token: { colorPrimary: '#1166BB', borderRadius: 6, fontSize: 12 } }}>
      <div style={{ padding: 8 }}>
        <Space wrap style={{ marginBottom: 8 }}>
          <Text strong style={{ fontSize: 14 }}>AWB 항공운임 계산기</Text>
          <Select size="small" style={{ width: 150 }} value={year && week ? `${year}|${week}` : undefined} onChange={(v) => { const [y, w] = v.split('|'); setYear(y); setWeek(w); }} options={weeks.map((w) => ({ value: `${w.year}|${w.week}`, label: `${w.year} ${w.week} (${w.n})` }))} />
          {data && <Select size="small" style={{ width: 300 }} value={awbIdx} onChange={setAwbIdx} options={data.awbs.map((a, i) => ({ value: i, label: `${a.awb} · 박스 ${fmt(a.box)} · 농장 ${a.farms.length}${a.freightUSD ? ` · 운임행 $${fmt(a.freightUSD, 2)}` : ''}` }))} />}
          <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={load}>새로고침</Button>
          <Button size="small" icon={<DownloadOutlined />} disabled={!calc} onClick={exportXlsx}>엑셀(원본 양식)</Button>
          <Button size="small" href="/import">수입부 통합</Button>
        </Space>
        {err && <Alert type="error" showIcon message={err} style={{ marginBottom: 8 }} />}
        <Alert type="warning" showIcon style={{ marginBottom: 8 }} message="계산 전용 — 어디에도 저장하지 않습니다. 백상 창고료·겸역 차감·국내운송 규칙(통관비 정본)은 확정 전이라 입력값으로만 다룹니다." />
        {awb && calc && (
          <Row gutter={8} wrap={false} style={{ alignItems: 'flex-start' }}>
            <Col flex="0 0 300px">
              <Card size="small" title="입력(원본 시트의 노란 칸)">
                <Space direction="vertical" size={6} style={{ width: '100%' }}>
                  <Space><Text style={{ width: 130, display: 'inline-block' }}>AWB 상 운임비 $</Text>{N('freightUSD', 0.01)}</Space>
                  <Space><Text style={{ width: 130, display: 'inline-block' }}>AWB 상 박스 토탈</Text>{N('boxes')}</Space>
                  <Space><Text style={{ width: 130, display: 'inline-block' }}>AWB 상 박스 중량 kg</Text>{N('kg', 0.1)}</Space>
                  <Space><Text style={{ width: 130, display: 'inline-block' }}>백상 창고비 원/박스</Text>{N('storagePerBox', 10)}</Space>
                  <Space><Text style={{ width: 130, display: 'inline-block' }}>선율 비용 원</Text>{N('sunyul', 1000)}</Space>
                  <Space><Text style={{ width: 130, display: 'inline-block' }}>환율</Text>{N('fx', 10)}</Space>
                </Space>
                <Row gutter={8} style={{ marginTop: 10 }}>
                  <Col span={12}><Statistic title="박스당 운임" value={calc.perBoxUSD} precision={2} prefix="$" valueStyle={{ fontSize: 14 }} /></Col>
                  <Col span={12}><Statistic title="박스당 kg" value={calc.perBoxKg} precision={2} valueStyle={{ fontSize: 14 }} /></Col>
                  <Col span={12}><Statistic title="백상 합계" value={calc.storageTotal} precision={0} suffix="원" valueStyle={{ fontSize: 14 }} /></Col>
                  <Col span={12}><Statistic title="선율 합계" value={calc.sunyulTotal} precision={0} suffix="원" valueStyle={{ fontSize: 14 }} /></Col>
                </Row>
                <div style={{ marginTop: 8 }}><Text type="secondary">원장: GW {fmt(awb.gw, 1)} · CW {fmt(awb.cw, 1)} · Rate {fmt(awb.rate, 2)} · 인보이스 {awb.invoices}</Text></div>
              </Card>
              <Card size="small" title="오류 확인" style={{ marginTop: 8 }}>
                {calc.checks.map((c) => <div key={c.name}><Tag color={c.ok ? 'green' : 'red'}>{c.ok ? 'true' : 'false'}</Tag>{c.name} <Text type="secondary">{c.detail}</Text></div>)}
              </Card>
            </Col>
            <Col flex="1 1 0" style={{ minWidth: 0 }}>
              <Card size="small" title="품목군별 분배" style={{ marginBottom: 8 }}>
                <Table size="small" rowKey="group" pagination={false} dataSource={calc.groups} columns={[{ title: '품목군', dataIndex: 'group' }, { title: '박스', dataIndex: 'box', align: 'right', render: (v) => fmt(v) }, { title: '운임 $', dataIndex: 'freightUSD', align: 'right', render: (v) => fmt(v, 2) }, { title: 'kg', dataIndex: 'kg', align: 'right', render: (v) => fmt(v, 1) }, { title: '백상 창고비', dataIndex: 'storage', align: 'right', render: (v) => fmt(v) }, { title: '%', dataIndex: 'pct', align: 'right', render: (v) => fmt(v, 2) }, { title: '선율 비용', dataIndex: 'sunyul', align: 'right', render: (v) => fmt(v) }]} />
              </Card>
              <Card size="small" title={<Space><Text strong>농장별 분배</Text><Text type="secondary">{calc.farms.length}농장 · 원장 박스 {fmt(calc.ledgerBox)}</Text></Space>}>
                <Table size="small" rowKey="farm" pagination={false} dataSource={calc.farms} scroll={{ x: 1100 }} columns={[
                  { title: '농장', dataIndex: 'farm', fixed: 'left', width: 150 },
                  { title: '박스', dataIndex: 'box', align: 'right', width: 60, render: (v) => fmt(v) },
                  ...GROUPS.filter((g) => calc.groups.some((x) => x.group === g)).map((g) => ({ title: g, dataIndex: g, align: 'right', width: 64, render: (v) => v ? fmt(v) : <Text type="secondary">·</Text> })),
                  { title: 'kg', dataIndex: 'kg', align: 'right', width: 70, render: (v) => fmt(v, 1) },
                  { title: '운임 $', dataIndex: 'freightUSD', align: 'right', width: 80, render: (v) => fmt(v, 2) },
                  { title: '백상 창고비', dataIndex: 'storage', align: 'right', width: 90, render: (v) => fmt(v) },
                  { title: '%', dataIndex: 'pct', align: 'right', width: 60, render: (v) => fmt(v, 2) },
                  { title: '선율 비용', dataIndex: 'sunyul', align: 'right', width: 80, render: (v) => fmt(v) },
                  { title: '백상+선율', dataIndex: 'total', align: 'right', width: 90, render: (v) => <Text strong>{fmt(v)}</Text> },
                  { title: 'USD 환산', dataIndex: 'totalUSD', align: 'right', width: 80, render: (v) => fmt(v, 2) },
                ]} summary={(rows) => <Table.Summary fixed><Table.Summary.Row><Table.Summary.Cell index={0}><Text strong>토탈</Text></Table.Summary.Cell><Table.Summary.Cell index={1} align="right"><Text strong>{fmt(rows.reduce((a, r) => a + r.box, 0))}</Text></Table.Summary.Cell>{GROUPS.filter((g) => calc.groups.some((x) => x.group === g)).map((g, i) => <Table.Summary.Cell key={g} index={2 + i} align="right">{fmt(rows.reduce((a, r) => a + r[g], 0))}</Table.Summary.Cell>)}<Table.Summary.Cell index={20} align="right">{fmt(rows.reduce((a, r) => a + r.kg, 0), 1)}</Table.Summary.Cell><Table.Summary.Cell index={21} align="right">{fmt(rows.reduce((a, r) => a + r.freightUSD, 0), 2)}</Table.Summary.Cell><Table.Summary.Cell index={22} align="right">{fmt(rows.reduce((a, r) => a + r.storage, 0))}</Table.Summary.Cell><Table.Summary.Cell index={23} align="right">{fmt(rows.reduce((a, r) => a + r.pct, 0), 2)}</Table.Summary.Cell><Table.Summary.Cell index={24} align="right">{fmt(rows.reduce((a, r) => a + r.sunyul, 0))}</Table.Summary.Cell><Table.Summary.Cell index={25} align="right"><Text strong>{fmt(rows.reduce((a, r) => a + r.total, 0))}</Text></Table.Summary.Cell><Table.Summary.Cell index={26} align="right">{fmt(rows.reduce((a, r) => a + r.totalUSD, 0), 2)}</Table.Summary.Cell></Table.Summary.Row></Table.Summary>} />
              </Card>
            </Col>
          </Row>
        )}
        {data && !data.awbs.length && <Alert type="info" showIcon message={`${year} ${week} 원장이 없습니다`} />}
      </div>
    </ConfigProvider>
  );
}
