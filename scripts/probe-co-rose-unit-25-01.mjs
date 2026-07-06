/**
 * 25-01 콜롬비아 장미 — 단→박스(또는 박스 단위) 저장 의심 조회
 * node scripts/probe-co-rose-unit-25-01.mjs [week]
 */
import fs from 'fs';
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}
const { query, sql } = await import('../lib/db.js');
const { computeBunchAsBoxRepair } = await import('../lib/unitMismatchAudit.js');

const week = process.argv[2] || '25-01';

const products = await query(
  `SELECT ProdKey, ProdName, OutUnit, EstUnit, ISNULL(BunchOf1Box,0) AS B1B,
          ISNULL(SteamOf1Box,0) AS S1B, ISNULL(SteamOf1Bunch,0) AS S1Bu
   FROM Product
   WHERE isDeleted=0
     AND CounName=N'콜롬비아' AND FlowerName=N'장미'
   ORDER BY ProdName`,
);

console.log(`=== ${week} 콜롬비아 장미 품목 (${products.recordset.length}개) ===`);
const outUnits = {};
products.recordset.forEach(p => { outUnits[p.OutUnit] = (outUnits[p.OutUnit] || 0) + 1; });
console.log('OutUnit 분포:', outUnits);

const rows = await query(
  `SELECT c.CustKey, c.CustName, p.ProdKey, p.ProdName, p.OutUnit, p.EstUnit,
          ISNULL(p.BunchOf1Box,0) AS B1B, ISNULL(p.SteamOf1Box,0) AS S1B,
          ISNULL(od.OutQuantity,0) AS orderOut,
          ISNULL(od.BoxQuantity,0) AS orderBox,
          ISNULL(od.BunchQuantity,0) AS orderBunch,
          ISNULL(od.SteamQuantity,0) AS orderSteam,
          ISNULL(sd.OutQuantity,0) AS shipOut,
          ISNULL(sd.BoxQuantity,0) AS shipBox,
          ISNULL(sd.BunchQuantity,0) AS shipBunch,
          ISNULL(sd.SteamQuantity,0) AS shipSteam,
          ISNULL(sd.EstQuantity,0) AS shipEst,
          sd.ShipmentKey, sd.ProdKey,
          ISNULL(sd.Descr,'') AS shipDescr
   FROM ShipmentDetail sd
   JOIN ShipmentMaster sm ON sd.ShipmentKey=sm.ShipmentKey AND sm.isDeleted=0
   JOIN Customer c ON sm.CustKey=c.CustKey
   JOIN Product p ON sd.ProdKey=p.ProdKey AND p.isDeleted=0
   LEFT JOIN OrderMaster om ON om.CustKey=sm.CustKey AND om.OrderWeek=sm.OrderWeek AND om.isDeleted=0
   LEFT JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey AND od.ProdKey=sd.ProdKey AND od.isDeleted=0
   WHERE sm.OrderWeek=@wk AND sd.OutQuantity>0
     AND p.CounName=N'콜롬비아' AND p.FlowerName=N'장미'
   ORDER BY c.CustName, p.ProdName`,
  { wk: { type: sql.NVarChar, value: week } },
);

console.log(`\n=== 분배 행 ${rows.recordset.length}건 ===\n`);

const suspects = [];
const patterns = { audit: 0, ratio: 0, boxAsUnit: 0, orderUnit단: 0 };

for (const r of rows.recordset) {
  const prod = {
    OutUnit: r.OutUnit,
    EstUnit: r.EstUnit,
    BunchOf1Box: r.B1B,
    SteamOf1Box: r.S1B,
    SteamOf1Bunch: r.S1Bu,
  };
  const orderBox = Number(r.orderBox || 0);
  const orderBunch = Number(r.orderBunch || r.orderOut || 0);
  const shipOut = Number(r.shipOut);
  const shipBunch = Number(r.shipBunch);
  const b1b = Number(r.B1B);

  if (r.OutUnit === '박스' && b1b > 1) {
    const auditRow = {
      OutQuantity: r.shipOut,
      BoxQuantity: r.shipBox,
      BunchQuantity: r.shipBunch,
      orderQty: orderBox || orderBunch / b1b,
    };
    const fix = computeBunchAsBoxRepair(auditRow, prod);
    if (fix) {
      patterns.audit += 1;
      suspects.push({ ...r, kind: 'STORED_BUNCH_AS_BOX', ratio: fix.ratio, fix });
      continue;
    }
    if (orderBox > 0) {
      const ratio = shipOut / orderBox;
      if (ratio >= b1b * 0.85 && ratio <= b1b * 1.15) {
        patterns.ratio += 1;
        suspects.push({ ...r, kind: 'RATIO_B1B', ratio, orderBox, shipOut });
      }
    }
  }

  // OutUnit=단 (콜롬비아 장미 대부분): OutQuantity에 박스 수가 들어간 패턴
  // 정상: shipOut ≈ orderBunch, shipBunch ≈ shipOut, shipBox ≈ shipOut/b1b
  // 오류: shipOut ≈ orderBox (박스 수를 단 OutQuantity에 저장), shipBunch도 shipOut과 같음
  if (r.OutUnit === '단' && b1b > 1 && orderBunch > 0 && shipOut > 0) {
    const orderBoxFromBunch = orderBunch / b1b;
    const bunchRatio = orderBunch / shipOut;
    const boxMatch = orderBox > 0 && Math.abs(shipOut - orderBox) < 0.01;
    const boxFromBunchMatch = Math.abs(shipOut - orderBoxFromBunch) < 0.51;
    const bunchNotScaled = Math.abs(shipBunch - shipOut) < 0.01 && bunchRatio >= b1b * 0.85 && bunchRatio <= b1b * 1.15;

    if ((boxMatch || boxFromBunchMatch) && bunchNotScaled) {
      patterns.boxAsUnit += 1;
      suspects.push({
        ...r,
        kind: '단품목_박스수를_OUT에',
        orderBunch,
        orderBox,
        shipOut,
        shipBunch,
        ratio: bunchRatio,
        corrected단: Math.round(shipOut * b1b * 100) / 100,
      });
    }
  }
}

// OrderDetail only — 주문이 단 단위로 들어갔는데 OutQuantity가 박스처럼 큰 경우
const orders = await query(
  `SELECT c.CustName, p.ProdName, p.OutUnit, ISNULL(p.BunchOf1Box,0) AS B1B,
          od.OutQuantity, od.BoxQuantity, od.BunchQuantity, ISNULL(od.Descr,'') AS descr
   FROM OrderMaster om
   JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey AND od.isDeleted=0
   JOIN Customer c ON c.CustKey=om.CustKey
   JOIN Product p ON p.ProdKey=od.ProdKey AND p.isDeleted=0
   WHERE om.isDeleted=0 AND om.OrderWeek=@wk AND od.OutQuantity>0
     AND p.CounName=N'콜롬비아' AND p.FlowerName=N'장미'`,
  { wk: { type: sql.NVarChar, value: week } },
);

for (const o of orders.recordset) {
  const b1b = Number(o.B1B);
  const out = Number(o.OutQuantity);
  const bunch = Number(o.BunchQuantity);
  const box = Number(o.BoxQuantity);
  if (o.OutUnit === '박스' && b1b > 1 && bunch > 0) {
    const impliedBox = bunch / b1b;
    if (Math.abs(out - bunch) < 0.01 && impliedBox > 0 && impliedBox < out) {
      patterns.orderUnit단 += 1;
      suspects.push({ ...o, kind: 'ORDER_단값을_OUT에', out, bunch, impliedBox: Math.round(impliedBox * 100) / 100 });
    }
  }
}

console.log('의심 패턴 건수:', patterns);
console.log(`\n=== 의심 ${suspects.length}건 상세 ===\n`);

const seen = new Set();
for (const s of suspects) {
  const key = `${s.CustName}|${s.ProdName}|${s.kind}|${s.shipOut ?? s.OutQuantity}`;
  if (seen.has(key)) continue;
  seen.add(key);
  if (s.kind === 'STORED_BUNCH_AS_BOX' || s.kind === 'RATIO_B1B') {
    console.log(`[${s.kind}] ${s.CustName} | ${s.ProdName}`);
    console.log(`  OutUnit=${s.OutUnit} B1B=${s.B1B} | 주문박스=${s.orderBox ?? s.orderOut} → 분배Out=${s.shipOut} (×${Math.round(s.ratio)})`);
    if (s.fix) console.log(`  보정안: Out ${s.fix.from.outQty} → ${s.fix.to.outQty}박스, Bunch ${s.fix.from.bunchQty} → ${s.fix.to.bunchQty}`);
  } else if (s.kind === '단품목_박스수를_OUT에') {
    console.log(`[${s.kind}] ${s.CustName} | ${s.ProdName}`);
    console.log(`  OutUnit=단 B1B=${s.B1B} | 주문 단=${s.orderBunch} (≈${Math.round(s.orderBunch / s.B1B * 10) / 10}박스)`);
    console.log(`  분배 Out=${s.shipOut} Bunch=${s.shipBunch} → 박스 ${s.shipOut}개를 단 OutQuantity에 넣은 형태 (×${Math.round(s.ratio)} 부족)`);
    console.log(`  보정안: OutQuantity ${s.shipOut} → ${s.corrected단} (단)`);
  } else if (s.kind === 'ORDER_단값을_OUT에') {
    console.log(`[${s.kind}] ${s.CustName} | ${s.ProdName}`);
    console.log(`  OutQuantity=${s.out} Bunch=${s.bunch} (박스환산≈${s.impliedBox})`);
  } else {
    console.log(`[${s.kind}]`, s.CustName, s.ProdName, s);
  }
  if (s.shipDescr) console.log(`  Descr: ${String(s.shipDescr).slice(0, 80)}`);
  console.log('');
}

if (!suspects.length) {
  console.log('단→박스(B1B배) 의심 건 없음.\n');
}

// 주문 단수 vs 분배 OutQuantity 요약
let exact = 0; let under = 0; let over = 0;
for (const r of rows.recordset) {
  const ob = Number(r.orderBunch) || Number(r.orderOut) || 0;
  const so = Number(r.shipOut);
  if (!ob) continue;
  if (Math.abs(so - ob) < 0.01) exact += 1;
  else if (so < ob) under += 1;
  else over += 1;
}
console.log(`=== 주문 단(Bunch) vs 분배 OutQuantity ===`);
console.log(`  일치 ${exact}건 | 분배 부족 ${under}건 | 분배 초과 ${over}건 / ${rows.recordset.length}건`);

if (under > 0) {
  console.log('\n--- 분배 부족 (박스로 넣었을 때 의심) ---');
  for (const r of rows.recordset) {
    const b1b = Number(r.B1B) || 10;
    const ob = Number(r.orderBunch) || Number(r.orderOut) || 0;
    const so = Number(r.shipOut);
    const obox = Number(r.orderBox) || 0;
    if (!ob || so >= ob) continue;
    if (Math.abs(so - obox) < 0.01 && ob >= b1b * 0.9) {
      console.log(`  ${r.CustName} | ${r.ProdName.slice(0, 40)} | 주문 ${ob}단 shipOut=${so}(=주문박스${obox}) ⚠`);
    } else {
      console.log(`  ${r.CustName} | ${r.ProdName.slice(0, 40)} | 주문 ${ob}단 shipOut=${so}`);
    }
  }
}

if (!suspects.length && under === 0) {
  console.log('\n정상 샘플 5건:');
  rows.recordset.slice(0, 5).forEach(r => {
    console.log(`  ${r.CustName} | ${r.ProdName.slice(0, 35)} | OutUnit=${r.OutUnit} 주문단=${r.orderBunch || r.orderOut} 분배=${r.shipOut} Bunch=${r.shipBunch} Box=${r.shipBox}`);
  });
}
