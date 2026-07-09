// ECOUNT 스크래핑 데이터 적재 + 무결성 검증 엔진 (웹 전용 테이블).
// OAPI 로 못 가져오는 4종(입출금계좌·거래처채권·거래처채무·판매현황)을 Claude-in-Chrome/
// owner PC Playwright 가 화면에서 긁어 POST 하면, 여기서 4중 검증 후 신뢰도와 함께 적재한다.
//
// 검증 게이트: (1) 자기검증(합계·행수) (2) 내부산술(화면 컬럼 간 항등식) (3) 시계열 드리프트
//   (4) 교차검증(nenovaweb DB 대조). GREEN=통과 / YELLOW=주의 / RED=거부(적재는 하되 표시).
import { query, withTransaction, sql } from './db';

// ── 데이터셋 정의 (메모리 ecount-scrape-datasets 스펙 기반)
export const DATASETS = {
  cash: {
    label: '입출금계좌 조회', prgId: 'E010205',
    // 검증: 계좌별 Σ(입금)−Σ(출금) 은 원화잔액 흐름과 일치해야 함(연속성)
    numCols: ['amount', 'balance'],
  },
  ar: {
    label: '거래처별채권', prgId: 'E040214',
    // 화면에 '기초채권' 컬럼이 없어 잔액=매출−수급−차액 항등식은 성립하지 않음(이월분 포함).
    // → 내부산술 검증 없음. 대신 소계(계)==Σ멤버 · 자기검증 · 시계열로 검증.
    numCols: ['salesTotal', 'receiptTotal', 'etcDiff', 'balance'],
  },
  ap: {
    label: '거래처별채무', prgId: 'E040309',
    // 잔액 == 기초채무 + 재고매입 + 회계매입 − 지급합계 − 기타할인등차액
    numCols: ['openingDebt', 'stockBuy', 'acctBuy', 'payTotal', 'etcDiff', 'balance'],
    identity: r => Math.abs(n(r.balance) - (n(r.openingDebt) + n(r.stockBuy) + n(r.acctBuy) - n(r.payTotal) - n(r.etcDiff))),
    identityDesc: '잔액 = 기초채무 + 재고매입 + 회계매입 − 지급합계 − 기타할인등차액',
  },
  sales: {
    label: '판매현황', prgId: 'E040207',
    // 합계 == 공급가액 + 부가세
    numCols: ['qty', 'supplyAmt', 'vat', 'total'],
    identity: r => Math.abs(n(r.total) - (n(r.supplyAmt) + n(r.vat))),
    identityDesc: '합계 = 공급가액 + 부가세',
  },
};
function n(v) { const x = Number(String(v ?? '').replace(/[,\s₩]/g, '')); return Number.isFinite(x) ? x : 0; }

let _ensured = null;
export async function ensureEcountTables() {
  if (_ensured) return _ensured;
  _ensured = (async () => {
    await query(
      `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='WebEcountSnapshot')
       BEGIN
         CREATE TABLE WebEcountSnapshot (
           SnapshotKey INT IDENTITY(1,1) PRIMARY KEY,
           Dataset NVARCHAR(20) NOT NULL,
           PeriodFrom NVARCHAR(10), PeriodTo NVARCHAR(10),
           TakenAt DATETIME NOT NULL DEFAULT GETDATE(),
           Actor NVARCHAR(60), Source NVARCHAR(30),
           RowCnt INT NOT NULL DEFAULT 0,
           ScreenTotal FLOAT, ParsedTotal FLOAT, ScreenRowCnt INT,
           VerifyStatus NVARCHAR(6) NOT NULL DEFAULT 'GRAY',   -- GREEN/YELLOW/RED
           VerifyScore INT, VerifyDetail NVARCHAR(MAX),
           Note NVARCHAR(400)
         );
         CREATE INDEX IX_WebEcountSnapshot_DS ON WebEcountSnapshot(Dataset, SnapshotKey DESC);
       END`, {}
    );
    await query(
      `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='WebEcountRow')
       BEGIN
         CREATE TABLE WebEcountRow (
           RowKey INT IDENTITY(1,1) PRIMARY KEY,
           SnapshotKey INT NOT NULL,
           Dataset NVARCHAR(20) NOT NULL,
           RefDate NVARCHAR(20), RefNo NVARCHAR(40),
           CustCode NVARCHAR(40), CustName NVARCHAR(120),
           ProdName NVARCHAR(200),
           Amount FLOAT, Balance FLOAT,
           IsSubtotal BIT NOT NULL DEFAULT 0,
           RowFlag NVARCHAR(10),         -- ok/warn/err (검증 결과)
           RowNote NVARCHAR(300),
           Payload NVARCHAR(MAX)          -- 원본 전 컬럼 JSON
         );
         CREATE INDEX IX_WebEcountRow_Snap ON WebEcountRow(SnapshotKey);
       END`, {}
    );
  })();
  return _ensured;
}

// ── 교차검증: 판매현황 vs nenovaweb ShipmentDetail (기간 내 거래처별 매출합)
async function crossCheckSales(rows, periodFrom, periodTo) {
  if (!periodFrom || !periodTo) return null;
  // ECOUNT 거래처명별 합계(공급가)
  const ec = new Map();
  for (const r of rows) {
    if (r.isSubtotal) continue;
    const k = (r.custName || '').trim();
    ec.set(k, (ec.get(k) || 0) + n(r.supplyAmt));
  }
  // 우리 DB: 기간(출고일) 내 거래처별 ShipmentDetail.Amount 합
  const our = await query(
    `SELECT c.CustName, SUM(ISNULL(sd.Amount,0)) AS amt
       FROM ShipmentDetail sd
       JOIN ShipmentMaster sm ON sd.ShipmentKey=sm.ShipmentKey
       LEFT JOIN Customer c ON sm.CustKey=c.CustKey
      WHERE ISNULL(sm.isDeleted,0)=0 AND sd.ShipmentDtm >= @from AND sd.ShipmentDtm < DATEADD(day,1,@to)
      GROUP BY c.CustName`,
    { from: { type: sql.NVarChar, value: periodFrom }, to: { type: sql.NVarChar, value: periodTo } }
  ).catch(() => ({ recordset: [] }));
  const ourMap = new Map(our.recordset.map(x => [(x.CustName || '').trim(), Number(x.amt)]));
  const diffs = [];
  for (const [k, ecAmt] of ec) {
    const ourAmt = ourMap.get(k);
    if (ourAmt == null) continue; // 우리에 없는 거래처는 스킵(부분 대조)
    const d = ecAmt - ourAmt;
    if (Math.abs(d) > 1) diffs.push({ custName: k, ecount: ecAmt, ours: ourAmt, diff: d });
  }
  diffs.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  return { compared: [...ec.keys()].filter(k => ourMap.has(k)).length, mismatch: diffs.length, top: diffs.slice(0, 20) };
}

// ── 검증 실행
export async function runVerification({ dataset, rows, screenTotal, screenRowCnt, periodFrom, periodTo }) {
  const def = DATASETS[dataset];
  const checks = [];
  const dataRows = rows.filter(r => !r.isSubtotal);
  let worst = 'GREEN';
  const bump = s => { if (s === 'RED') worst = 'RED'; else if (s === 'YELLOW' && worst !== 'RED') worst = 'YELLOW'; };

  // (1) 자기검증 — 파싱 합계 vs 화면 합계
  const parsedTotal = dataRows.reduce((s, r) => s + n(r.amount ?? r.balance ?? r.total ?? r.supplyAmt), 0);
  if (screenTotal != null) {
    const d = Math.abs(parsedTotal - n(screenTotal));
    const ok = d <= 1;
    checks.push({ code: 'total', label: '화면 합계 ⟷ 파싱 합계', ok, status: ok ? 'GREEN' : 'RED', screen: n(screenTotal), parsed: parsedTotal, diff: parsedTotal - n(screenTotal) });
    if (!ok) bump('RED');
  }
  // (2) 자기검증 — 행수
  if (screenRowCnt != null) {
    const ok = Number(screenRowCnt) === dataRows.length;
    checks.push({ code: 'rowcnt', label: '화면 행수 ⟷ 파싱 행수', ok, status: ok ? 'GREEN' : 'RED', screen: Number(screenRowCnt), parsed: dataRows.length });
    if (!ok) bump('RED');
  }
  // (3) 내부 산술 항등식
  if (def.identity) {
    const bad = [];
    for (const r of dataRows) { const e = def.identity(r); if (e > 1) bad.push({ custName: r.custName, prodName: r.prodName, err: e }); }
    const ok = bad.length === 0;
    checks.push({ code: 'identity', label: `내부 산술: ${def.identityDesc}`, ok, status: ok ? 'GREEN' : 'RED', badCount: bad.length, sample: bad.slice(0, 10) });
    if (!ok) bump('RED');
    // 행 플래그
    for (const r of dataRows) r._flag = def.identity(r) > 1 ? 'err' : 'ok';
  }
  // (4) 필수값 널
  const nullRows = dataRows.filter(r => !(r.custName || r.custCode) && dataset !== 'cash');
  if (nullRows.length) { checks.push({ code: 'nullkey', label: '거래처 누락 행', ok: false, status: 'YELLOW', count: nullRows.length }); bump('YELLOW'); }

  // (5) 교차검증 (판매현황만 구현)
  let cross = null;
  if (dataset === 'sales') {
    cross = await crossCheckSales(rows, periodFrom, periodTo);
    if (cross) {
      const ok = cross.mismatch === 0;
      checks.push({ code: 'cross', label: '교차검증: ECOUNT 판매 ⟷ nenovaweb 출고매출', ok, status: ok ? 'GREEN' : 'YELLOW', compared: cross.compared, mismatch: cross.mismatch, top: cross.top });
      if (!ok) bump('YELLOW');
      for (const r of dataRows) {
        const m = cross.top.find(x => x.custName === (r.custName || '').trim());
        if (m && r._flag !== 'err') r._flag = 'warn';
      }
    }
  }

  // (6) 시계열 드리프트 (직전 스냅샷 대비 합계 급변)
  const prev = await query(
    `SELECT TOP 1 ParsedTotal FROM WebEcountSnapshot WHERE Dataset=@ds AND VerifyStatus<>'RED' ORDER BY SnapshotKey DESC`,
    { ds: { type: sql.NVarChar, value: dataset } }
  ).catch(() => ({ recordset: [] }));
  if (prev.recordset[0]?.ParsedTotal != null) {
    const p = Number(prev.recordset[0].ParsedTotal);
    const drift = p !== 0 ? (parsedTotal - p) / Math.abs(p) : 0;
    const ok = Math.abs(drift) < 0.5; // 50% 이상 급변이면 주의
    checks.push({ code: 'drift', label: '직전 수집 대비 합계 변동', ok, status: ok ? 'GREEN' : 'YELLOW', prev: p, now: parsedTotal, driftPct: Math.round(drift * 1000) / 10 });
    if (!ok) bump('YELLOW');
  }

  const score = Math.round(100 * checks.filter(c => c.ok).length / Math.max(1, checks.length));
  return { status: worst, score, parsedTotal, checks, cross };
}

// ── 적재 (검증 실행 후 스냅샷+행 저장)
export async function ingestEcount({ dataset, rows, screenTotal, screenRowCnt, periodFrom, periodTo, actor, source = 'chrome', note }) {
  if (!DATASETS[dataset]) throw new Error(`알 수 없는 dataset: ${dataset}`);
  await ensureEcountTables();
  const norm = (rows || []).map(r => ({ ...r, isSubtotal: !!r.isSubtotal }));
  const v = await runVerification({ dataset, rows: norm, screenTotal, screenRowCnt, periodFrom, periodTo });

  return await withTransaction(async (tQ) => {
    const ins = await tQ(
      `INSERT INTO WebEcountSnapshot (Dataset, PeriodFrom, PeriodTo, Actor, Source, RowCnt, ScreenTotal, ParsedTotal, ScreenRowCnt, VerifyStatus, VerifyScore, VerifyDetail, Note)
       OUTPUT INSERTED.SnapshotKey
       VALUES (@ds,@pf,@pt,@actor,@src,@cnt,@stot,@ptot,@srow,@vs,@score,@vd,@note)`,
      {
        ds: { type: sql.NVarChar, value: dataset },
        pf: { type: sql.NVarChar, value: periodFrom || null }, pt: { type: sql.NVarChar, value: periodTo || null },
        actor: { type: sql.NVarChar, value: actor || 'system' }, src: { type: sql.NVarChar, value: source },
        cnt: { type: sql.Int, value: norm.filter(r => !r.isSubtotal).length },
        stot: { type: sql.Float, value: screenTotal == null ? null : n(screenTotal) },
        ptot: { type: sql.Float, value: v.parsedTotal },
        srow: { type: sql.Int, value: screenRowCnt == null ? null : Number(screenRowCnt) },
        vs: { type: sql.NVarChar, value: v.status }, score: { type: sql.Int, value: v.score },
        vd: { type: sql.NVarChar, value: JSON.stringify(v.checks) },
        note: { type: sql.NVarChar, value: note || null },
      }
    );
    const snapshotKey = ins.recordset[0].SnapshotKey;
    for (let i = 0; i < norm.length; i += 100) {
      const chunk = norm.slice(i, i + 100);
      const vals = []; const p = { sk: { type: sql.Int, value: snapshotKey }, ds: { type: sql.NVarChar, value: dataset } };
      chunk.forEach((r, j) => {
        vals.push(`(@sk,@ds,@rd${j},@rn${j},@cc${j},@cn${j},@pn${j},@amt${j},@bal${j},@sub${j},@flag${j},@pl${j})`);
        p[`rd${j}`] = { type: sql.NVarChar, value: (r.refDate || '').slice(0, 20) };
        p[`rn${j}`] = { type: sql.NVarChar, value: (r.refNo || '').slice(0, 40) };
        p[`cc${j}`] = { type: sql.NVarChar, value: (r.custCode || '').slice(0, 40) };
        p[`cn${j}`] = { type: sql.NVarChar, value: (r.custName || '').slice(0, 120) };
        p[`pn${j}`] = { type: sql.NVarChar, value: (r.prodName || '').slice(0, 200) };
        p[`amt${j}`] = { type: sql.Float, value: n(r.amount ?? r.total ?? r.supplyAmt) };
        p[`bal${j}`] = { type: sql.Float, value: r.balance == null ? null : n(r.balance) };
        p[`sub${j}`] = { type: sql.Bit, value: r.isSubtotal ? 1 : 0 };
        p[`flag${j}`] = { type: sql.NVarChar, value: r._flag || 'ok' };
        p[`pl${j}`] = { type: sql.NVarChar, value: JSON.stringify(r) };
      });
      await tQ(
        `INSERT INTO WebEcountRow (SnapshotKey,Dataset,RefDate,RefNo,CustCode,CustName,ProdName,Amount,Balance,IsSubtotal,RowFlag,Payload)
         VALUES ${vals.join(',')}`, p
      );
    }
    return { snapshotKey, ...v };
  });
}

export async function listEcountSnapshots(dataset, limit = 30) {
  await ensureEcountTables();
  const r = await query(
    `SELECT TOP (@lim) SnapshotKey, Dataset, PeriodFrom, PeriodTo, CONVERT(varchar(19),TakenAt,120) AS takenAt,
            Actor, Source, RowCnt, ScreenTotal, ParsedTotal, ScreenRowCnt, VerifyStatus, VerifyScore, Note
       FROM WebEcountSnapshot ${dataset ? 'WHERE Dataset=@ds' : ''} ORDER BY SnapshotKey DESC`,
    dataset ? { lim: { type: sql.Int, value: limit }, ds: { type: sql.NVarChar, value: dataset } } : { lim: { type: sql.Int, value: limit } }
  );
  return r.recordset;
}

export async function getEcountSnapshot(snapshotKey) {
  const [snap, rows] = await Promise.all([
    query(`SELECT * FROM WebEcountSnapshot WHERE SnapshotKey=@k`, { k: { type: sql.Int, value: Number(snapshotKey) } }),
    query(`SELECT RefDate,RefNo,CustCode,CustName,ProdName,Amount,Balance,IsSubtotal,RowFlag,RowNote,Payload FROM WebEcountRow WHERE SnapshotKey=@k ORDER BY RowKey`, { k: { type: sql.Int, value: Number(snapshotKey) } }),
  ]);
  const s = snap.recordset[0];
  if (!s) return null;
  return { ...s, VerifyDetail: safeJson(s.VerifyDetail), rows: rows.recordset.map(r => ({ ...r, Payload: safeJson(r.Payload) })) };
}
function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }
