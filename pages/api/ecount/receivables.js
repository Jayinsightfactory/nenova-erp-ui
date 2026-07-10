// GET /api/ecount/receivables — ECOUNT 채권(미수) 현황: 거래처별 미수 잔액 + 미수개월(aging).
//   웹엔 없는 정보(누가 얼마를 얼마나 오래 안 갚았나)를 ECOUNT 기준으로 제공. 장기미수 경고.
import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

// "2 개월" / "12 개월" → 숫자. 없으면 0.
const agingNum = (s) => { const m = String(s || '').match(/-?\d+/); return m ? Number(m[0]) : 0; };

// aging 버킷 (미수 경과 개월)
const BUCKETS = [
  { key: 'b1', label: '1개월 이하', min: -999, max: 1, color: '#16a34a' },
  { key: 'b2', label: '2~3개월', min: 2, max: 3, color: '#ca8a04' },
  { key: 'b3', label: '4~6개월', min: 4, max: 6, color: '#ea580c' },
  { key: 'b4', label: '7~12개월', min: 7, max: 12, color: '#dc2626' },
  { key: 'b5', label: '13개월 이상', min: 13, max: 9999, color: '#7f1d1d' },
];
const bucketOf = (mon) => BUCKETS.find((b) => mon >= b.min && mon <= b.max) || BUCKETS[0];

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  try {
    const snap = req.query.snapshotKey
      ? { SnapshotKey: Number(req.query.snapshotKey) }
      : (await query(`SELECT TOP 1 SnapshotKey, CONVERT(varchar(19),TakenAt,120) AS takenAt FROM WebEcountSnapshot WHERE Dataset='ar' ORDER BY SnapshotKey DESC`)).recordset[0];
    if (!snap) return res.status(200).json({ success: true, noEcount: true, rows: [] });

    const meta = (await query(`SELECT CONVERT(varchar(19),TakenAt,120) AS takenAt FROM WebEcountSnapshot WHERE SnapshotKey=@sk`, { sk: { type: sql.Int, value: snap.SnapshotKey } })).recordset[0];
    const ec = await query(
      `SELECT CustName, Payload FROM WebEcountRow WHERE SnapshotKey=@sk AND ISNULL(IsSubtotal,0)=0`,
      { sk: { type: sql.Int, value: snap.SnapshotKey } });

    const round = (v) => Math.round(Number(v || 0));
    const rows = [];
    for (const r of ec.recordset) {
      let o; try { o = JSON.parse(r.Payload); } catch { continue; }
      const balance = round(o.balance);
      if (balance === 0 && round(o.salesTotal) === 0 && round(o.receiptTotal) === 0) continue;
      const mon = agingNum(o.agingMonth);
      const b = bucketOf(mon);
      rows.push({
        name: r.CustName || o.custName || '(미지정)',
        sales: round(o.salesTotal), receipt: round(o.receiptTotal),
        balance, agingMonths: mon, agingRaw: o.agingMonth || '',
        bucket: b.key, bucketLabel: b.label, color: b.color,
      });
    }
    rows.sort((a, b) => b.balance - a.balance);

    // aging 버킷 집계 (미수 잔액 > 0 인 것만)
    const aging = BUCKETS.map((b) => {
      const inb = rows.filter((r) => r.bucket === b.key && r.balance > 0);
      return { key: b.key, label: b.label, color: b.color, count: inb.length, amount: inb.reduce((a, r) => a + r.balance, 0) };
    });

    const posBal = rows.filter((r) => r.balance > 0);
    const overdue = (min) => { const f = posBal.filter((r) => r.agingMonths >= min); return { count: f.length, amount: f.reduce((a, r) => a + r.balance, 0) }; };

    return res.status(200).json({
      success: true,
      snapshotKey: snap.SnapshotKey, takenAt: meta?.takenAt || '',
      summary: {
        totalBalance: rows.reduce((a, r) => a + r.balance, 0),
        posCount: posBal.length,
        overdue4: overdue(4), overdue7: overdue(7), overdue13: overdue(13),
      },
      aging,
      rows,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
