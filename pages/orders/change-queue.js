// pages/orders/change-queue.js
// 카톡 변경 큐 — 영업방 원문에서 변경사항/검역차감/발주추가 메시지를 자동 분류·DB대조하고
// 사람이 [반영됨]/[무시]만 누르는 화면. Layout은 _app.js가 감싼다(자체 래핑 금지).
import { useEffect, useMemo, useState } from 'react';
import { ConfigProvider, Table, Card, Segmented, DatePicker, Select, Tag, Button, Space, Typography, Alert, Statistic, Row, Col, Tooltip, message, theme as antdTheme } from 'antd';
import { ReloadOutlined, CheckOutlined, StopOutlined, UndoOutlined } from '@ant-design/icons';
import koKR from 'antd/locale/ko_KR';
import dayjs from 'dayjs';

const { Text } = Typography;
const { RangePicker } = DatePicker;
const CATEGORIES = ['변경사항', '검역차감', '발주추가'];
const api = async (url, opt) => { const r = await fetch(url, opt); const j = await r.json().catch(() => ({})); if (!r.ok || j.success === false) { const e = new Error(j.error || `HTTP ${r.status}`); e.code = j.code; throw e; } return j; };

function statusTag(status) {
  if (status === 'applied') return <Tag color="green">반영됨</Tag>;
  if (status === 'ignored') return <Tag color="default">무시</Tag>;
  return <Tag color="orange">대기</Tag>;
}

export default function ChangeQueuePage() {
  const [range, setRange] = useState([dayjs().subtract(7, 'day'), dayjs()]);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [statusFilter, setStatusFilter] = useState('대기');
  const [catFilter, setCatFilter] = useState(CATEGORIES);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = () => {
    setLoading(true);
    setErr(null);
    const from = range?.[0]?.format('YYYY-MM-DD');
    const to = range?.[1]?.format('YYYY-MM-DD');
    api(`/api/orders/change-queue?from=${from}&to=${to}&year=${year}`)
      .then(setData)
      .catch((e) => setErr(e))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = data?.rows || [];
  const filtered = useMemo(() => rows.filter((r) => {
    if (!catFilter.includes(r.category)) return false;
    if (statusFilter === '대기' && r.status !== 'pending') return false;
    if (statusFilter === '반영됨' && r.status !== 'applied') return false;
    if (statusFilter === '무시' && r.status !== 'ignored') return false;
    return true;
  }), [rows, catFilter, statusFilter]);

  const today = dayjs().format('YYYY-MM-DD');
  const summary = useMemo(() => ({
    pending: rows.filter((r) => r.status === 'pending').length,
    needReview: rows.filter((r) => r.needReview > 0).length,
    today: rows.filter((r) => String(r.at).slice(0, 10) === today).length,
  }), [rows, today]);

  const decide = async (id, action) => {
    setBusyId(id);
    try {
      await api('/api/orders/change-queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action }) });
      message.success(action === 'reset' ? '되돌렸습니다' : action === 'applied' ? '반영됨으로 표시했습니다' : '무시로 표시했습니다');
      load();
    } catch (e) {
      message.error(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const columns = [
    { title: '시각', dataIndex: 'at', width: 130, render: (v) => String(v || '').slice(0, 16).replace('T', ' ') },
    { title: '보낸 사람', dataIndex: 'sender', width: 90 },
    { title: '분류', dataIndex: 'category', width: 90, render: (v, r) => <Tag color={v === '변경사항' ? 'blue' : v === '검역차감' ? 'purple' : 'gold'}>{v} {Math.round((r.confidence || 0) * 100)}%</Tag> },
    { title: '원문', dataIndex: 'text', render: (v) => <div style={{ maxWidth: 420, whiteSpace: 'pre-wrap' }}>{v}</div> },
    {
      title: '파싱', key: 'parse', width: 220, render: (_, r) => {
        if (!r.parseOk) return <Tag color="red">파싱 실패</Tag>;
        const needReview = r.items.filter((it) => it.status === '확인필요');
        return (
          <Space direction="vertical" size={2}>
            <Text>항목 {r.items.length}건 (추가 {r.items.filter((it) => it.action === '추가').length} · 취소 {r.items.filter((it) => it.action === '취소').length})</Text>
            {needReview.length > 0 && (
              <Tooltip title={needReview.map((it) => `${it.inputCustomer} ${it.inputProduct}: ${it.issues.join(', ')}`).join(' / ')}>
                <Tag color="red">확인필요 {needReview.length}</Tag>
              </Tooltip>
            )}
          </Space>
        );
      },
    },
    { title: '상태', dataIndex: 'status', width: 90, render: (v, r) => (<Space direction="vertical" size={2}>{statusTag(v)}{r.decided && <Text type="secondary" style={{ fontSize: 11 }}>{r.decided.byName || r.decided.by} {String(r.decided.at).slice(0, 16).replace('T', ' ')}</Text>}</Space>) },
    {
      title: '', key: 'actions', width: 190, render: (_, r) => (
        <Space size={4}>
          {r.status === 'pending' ? (
            <>
              <Button size="small" icon={<CheckOutlined />} loading={busyId === r.id} onClick={() => decide(r.id, 'applied')}>반영됨</Button>
              <Button size="small" danger icon={<StopOutlined />} loading={busyId === r.id} onClick={() => decide(r.id, 'ignored')}>무시</Button>
            </>
          ) : (
            <Button size="small" icon={<UndoOutlined />} loading={busyId === r.id} onClick={() => decide(r.id, 'reset')}>되돌리기</Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <ConfigProvider locale={koKR} theme={{ algorithm: antdTheme.defaultAlgorithm, token: { colorPrimary: '#1166BB', borderRadius: 6, fontSize: 12 } }}>
      <div style={{ padding: 12 }}>
        <Space wrap style={{ marginBottom: 8 }}>
          <Text strong style={{ fontSize: 15 }}>카톡 변경 큐</Text>
          <RangePicker size="small" value={range} onChange={setRange} allowClear={false} />
          <Select size="small" style={{ width: 90 }} value={year} onChange={setYear} options={[0, 1, 2].map((d) => { const y = String(new Date().getFullYear() - d); return { value: y, label: y }; })} />
          <Segmented size="small" value={statusFilter} onChange={setStatusFilter} options={['대기', '반영됨', '무시', '전체']} />
          <Select size="small" mode="multiple" style={{ minWidth: 220 }} value={catFilter} onChange={setCatFilter} options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
          <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={load}>새로고침</Button>
        </Space>
        {err && err.code === 'SALES_FEED_NOT_CONFIGURED' && <Alert type="info" showIcon style={{ marginBottom: 8 }} message="영업방 자동 연결 설정이 아직 완료되지 않았습니다." description={err.message} />}
        {err && err.code !== 'SALES_FEED_NOT_CONFIGURED' && <Alert type="error" showIcon style={{ marginBottom: 8 }} message={err.message} />}
        {data && (
          <Row gutter={12} style={{ marginBottom: 8 }}>
            <Col><Statistic title="대기" value={summary.pending} valueStyle={{ fontSize: 18 }} /></Col>
            <Col><Statistic title="확인필요" value={summary.needReview} valueStyle={{ fontSize: 18, color: summary.needReview ? '#cf1322' : undefined }} /></Col>
            <Col><Statistic title="오늘" value={summary.today} valueStyle={{ fontSize: 18 }} /></Col>
          </Row>
        )}
        <Card size="small">
          <Table
            size="small"
            rowKey="id"
            loading={loading}
            dataSource={filtered}
            columns={columns}
            pagination={{ pageSize: 20 }}
            expandable={{
              rowExpandable: (r) => r.items.length > 0,
              expandedRowRender: (r) => (
                <Table
                  size="small"
                  rowKey={(it, i) => `${r.id}-${i}`}
                  pagination={false}
                  dataSource={r.items}
                  columns={[
                    { title: '차수', dataIndex: 'week', width: 70 },
                    { title: '업체', key: 'cust', render: (_, it) => it.custMatch?.CustName || it.inputCustomer },
                    { title: '품목', key: 'prod', render: (_, it) => it.prodMatch?.DisplayName || it.inputProduct },
                    { title: '동작', dataIndex: 'action', width: 60, render: (v) => <Tag color={v === '취소' ? 'red' : 'blue'}>{v}</Tag> },
                    { title: '수량', key: 'qty', width: 70, render: (_, it) => `${it.qty} ${it.unit}` },
                    { title: '주문 DB', key: 'orderQty', width: 80, render: (_, it) => it.db ? it.db.orderQty : '–' },
                    { title: '분배 DB', key: 'shipQty', width: 80, render: (_, it) => it.db ? it.db.shipQty : '–' },
                    { title: '상태', dataIndex: 'status', width: 90, render: (v, it) => <Tooltip title={it.issues?.join(', ')}><Tag color={v === '확인필요' ? 'red' : 'green'}>{v}</Tag></Tooltip> },
                    { title: '', key: 'open', width: 110, render: (_, it) => it.week ? <a href={`/orders?week=${it.week}&year=${year}`} target="_blank" rel="noreferrer">주문관리에서 열기</a> : null },
                  ]}
                />
              ),
            }}
          />
        </Card>
      </div>
    </ConfigProvider>
  );
}
