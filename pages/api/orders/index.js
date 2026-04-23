// pages/api/orders/index.js
// GET  → 실제 DB 조회 (OrderMaster + OrderDetail)
// POST → 정식 테이블에 저장 (OrderMaster + OrderDetail)

import { query, withTransaction, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

async function appLog(category, step, detail, isError = false) {
  try {
    await query(
      `INSERT INTO AppLog (Category, Step, Detail, IsError) VALUES (@cat, @step, @detail, @err)`,
      { cat: { type: sql.NVarChar, value: category }, step: { type: sql.NVarChar, value: step },
        detail: { type: sql.NVarChar, value: String(detail) }, err: { type: sql.Bit, value: isError ? 1 : 0 } }
    );
  } catch { /* AppLog 없으면 무시 */ }
}

// MAX(Key)+1 안전 INSERT — HOLDLOCK + PK 충돌 방지
// 전산이 같은 시점에 INSERT 하면 HOLDLOCK 범위 밖이라 여전히 충돌 가능 → tryInsertWithRetry 로 감쌈
async function safeNextKey(tQ, table, keyCol) {
  const r = await tQ(
    `SELECT ISNULL(MAX(${keyCol}),0)+1 AS nk FROM ${table} WITH (UPDLOCK, HOLDLOCK)`, {}
  );
  return r.recordset[0].nk;
}

// PK 충돌 시 MAX+1 재계산 후 재시도 (최대 5회).
// buildInsert(newKey) 는 해당 key 로 INSERT 를 수행하는 async 함수.
// 성공 시 실제 사용된 key 반환, 모두 실패 시 마지막 에러 throw.
async function tryInsertWithRetry(tQ, table, keyCol, buildInsert, maxRetry = 5) {
  let lastErr;
  for (let attempt = 0; attempt < maxRetry; attempt++) {
    const key = await safeNextKey(tQ, table, keyCol);
    try {
      await buildInsert(key);
      return key;
    } catch (e) {
      lastErr = e;
      // PK 충돌(2627) 또는 UNIQUE 위반(2601) 만 재시도
      if (e.number === 2627 || e.number === 2601 || /PRIMARY KEY|duplicate key|UNIQUE/i.test(e.message || '')) {
        await appLog('safeInsert', '재시도', `${table}.${keyCol}=${key} 충돌 → 재시도 ${attempt + 1}/${maxRetry}`, false);
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error(`${table} INSERT 재시도 ${maxRetry}회 모두 실패`);
}

export default withAuth(async function handler(req, res) {
  if (req.method === 'GET')  return await getOrders(req, res);
  if (req.method === 'POST') return await createOrder(req, res);
  if (req.method === 'PUT')  return await updateOrder(req, res);
  return res.status(405).end();
});

// ── 조회: 실제 DB ──────────────────────────────
async function getOrders(req, res) {
  const { week, startDate, endDate, custName } = req.query;

  let where = 'WHERE om.isDeleted = 0';
  const params = {};

  if (week) {
    const normWeek = week.match(/^\d{4}-(\d{2}-\d{2})$/) ? week.match(/^\d{4}-(\d{2}-\d{2})$/)[1] : week;
    where += ' AND om.OrderWeek = @week';
    params.week = { type: sql.NVarChar, value: normWeek };
  }
  if (startDate) {
    where += ' AND CAST(om.OrderDtm AS DATE) >= @startDate';
    params.startDate = { type: sql.NVarChar, value: startDate };
  }
  if (endDate) {
    where += ' AND CAST(om.OrderDtm AS DATE) <= @endDate';
    params.endDate = { type: sql.NVarChar, value: endDate };
  }
  if (custName) {
    where += ' AND c.CustName LIKE @custName';
    params.custName = { type: sql.NVarChar, value: `%${custName}%` };
  }

  try {
    const result = await query(
      `SELECT
        om.OrderMasterKey,
        CONVERT(NVARCHAR(10), om.OrderDtm, 120) AS OrderDtm,
        om.OrderYear, om.OrderWeek, om.Manager, om.OrderCode,
        c.CustKey, c.CustName, c.CustArea,
        od.OrderDetailKey, od.ProdKey,
        p.ProdName, p.DisplayName, p.FlowerName, p.CounName, p.OutUnit,
        od.BoxQuantity, od.BunchQuantity, od.SteamQuantity,
        ISNULL(od.OutQuantity, 0) AS OutQuantity,
        od.NoneOutQuantity
       FROM OrderMaster om
       LEFT JOIN Customer c    ON om.CustKey = c.CustKey AND c.isDeleted = 0
       LEFT JOIN OrderDetail od ON om.OrderMasterKey = od.OrderMasterKey AND od.isDeleted = 0
       LEFT JOIN Product p     ON od.ProdKey = p.ProdKey
       ${where}
       ORDER BY om.OrderDtm DESC, om.OrderMasterKey, od.OrderDetailKey`,
      params
    );

    // OrderMasterKey 기준으로 그룹핑
    const ordersMap = {};
    for (const row of result.recordset) {
      if (!ordersMap[row.OrderMasterKey]) {
        ordersMap[row.OrderMasterKey] = {
          id: row.OrderMasterKey,
          date: row.OrderDtm,
          week: row.OrderYear ? `${row.OrderYear}-${row.OrderWeek}` : row.OrderWeek,
          year: row.OrderYear,
          manager: row.Manager,
          orderCode: row.OrderCode,
          custKey: row.CustKey,
          custName: row.CustName,
          custArea: row.CustArea,
          items: [],
        };
      }
      if (row.OrderDetailKey) {
        ordersMap[row.OrderMasterKey].items.push({
          detailKey: row.OrderDetailKey,
          prodKey: row.ProdKey,
          prodName: row.ProdName,
          flowerName: row.FlowerName,
          counName: row.CounName,
          boxQty: row.BoxQuantity,
          bunchQty: row.BunchQuantity,
          steamQty: row.SteamQuantity,
          outQty: row.OutQuantity,
          noneOutQty: row.NoneOutQuantity,
          unit: row.OutUnit || (row.BoxQuantity > 0 ? '박스' : row.BunchQuantity > 0 ? '단' : '송이'),
          qty: row.BoxQuantity || row.BunchQuantity || row.SteamQuantity || 0,
        });
      }
    }

    return res.status(200).json({
      success: true,
      source: 'real_db',  // 실제 DB임을 표시
      count: Object.keys(ordersMap).length,
      orders: Object.values(ordersMap),
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── 등록: 정식 테이블 (OrderMaster + OrderDetail) ──────────────────────────
async function createOrder(req, res) {
  const { custName, custKey, week, year, manager, orderCode, items } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ success: false, error: '품목을 입력하세요.' });
  }

  try {
    await appLog('createOrder', '시작', `custKey=${custKey} custName=${custName} week=${week} items=${items?.length}`);

    // 거래처 조회 (OrderCode 포함)
    let resolvedCustKey = custKey;
    let resolvedOrderCode = orderCode || '';
    if (resolvedCustKey) {
      const rc = await query(
        `SELECT TOP 1 CustKey, ISNULL(OrderCode,'') AS OrderCode FROM Customer WHERE CustKey=@ck AND isDeleted=0`,
        { ck: { type: sql.Int, value: parseInt(resolvedCustKey) } }
      );
      if (rc.recordset[0]) resolvedOrderCode = rc.recordset[0].OrderCode || resolvedOrderCode;
    } else if (custName) {
      const r = await query(
        `SELECT TOP 1 CustKey, ISNULL(OrderCode,'') AS OrderCode FROM Customer WHERE CustName LIKE @name AND isDeleted = 0`,
        { name: { type: sql.NVarChar, value: `%${custName}%` } }
      );
      if (!r.recordset[0]) {
        await appLog('createOrder', '오류', `거래처 없음: ${custName}`, true);
        return res.status(404).json({ success: false, error: `거래처 없음: ${custName}` });
      }
      resolvedCustKey = r.recordset[0].CustKey;
      resolvedOrderCode = r.recordset[0].OrderCode || '';
    }

    const orderYear = year || new Date().getFullYear().toString();
    // YYYY-WW-SS → WW-SS (전산 DB 형식으로 정규화)
    const rawWeek = week || '';
    const orderWeek = rawWeek.match(/^\d{4}-(\d{2}-\d{2})$/) ? rawWeek.match(/^\d{4}-(\d{2}-\d{2})$/)[1] : rawWeek;
    const uid = req.user?.userId || 'nenovaSS3';
    const mgr = '관리자'; // 전산 호환 (전산은 Manager='관리자' 기준으로 주문 표시)

    await appLog('createOrder', 'OM_조회', `ck=${resolvedCustKey} wk=${orderWeek}`);

    // Master + Detail 전체를 하나의 트랜잭션으로 (중간 실패 시 전체 롤백)
    const { orderMasterKey, results } = await withTransaction(async (tQuery) => {
      // 기존 OrderMaster 확인 (같은 업체+차수)
      const existing = await tQuery(
        `SELECT TOP 1 OrderMasterKey FROM OrderMaster WITH (UPDLOCK, HOLDLOCK)
         WHERE CustKey=@ck AND OrderWeek=@wk AND isDeleted=0
         ORDER BY OrderMasterKey ASC`,
        { ck: { type: sql.Int, value: resolvedCustKey }, wk: { type: sql.NVarChar, value: orderWeek } }
      );

      let mk;
      if (existing.recordset.length > 0) {
        mk = existing.recordset[0].OrderMasterKey;
        await appLog('createOrder', 'OM_FOUND', `mk=${mk}`);
        // Manager/OrderCode 없는 경우(웹 이전 생성분)만 보완
        await tQuery(
          `UPDATE OrderMaster SET
             Manager   = CASE WHEN Manager   IS NULL OR Manager   = '' THEN @mgr ELSE Manager END,
             OrderCode = CASE WHEN OrderCode IS NULL OR OrderCode = '' THEN @oc  ELSE OrderCode END
           WHERE OrderMasterKey = @mk`,
          { mgr: { type: sql.NVarChar, value: mgr }, oc: { type: sql.NVarChar, value: resolvedOrderCode }, mk: { type: sql.Int, value: mk } }
        );
      } else {
        mk = await tryInsertWithRetry(tQuery, 'OrderMaster', 'OrderMasterKey', async (newMk) => {
          await appLog('createOrder', 'OM_INSERT', `new mk=${newMk} ck=${resolvedCustKey} wk=${orderWeek}`);
          await tQuery(
            `INSERT INTO OrderMaster
               (OrderMasterKey, OrderDtm, OrderYear, OrderWeek, Manager, CustKey, OrderCode, Descr, isDeleted, CreateID, CreateDtm, LastUpdateID, LastUpdateDtm)
             VALUES (@mk, GETDATE(), @year, @week, @mgr, @custKey, @oc, '', 0, @createId, GETDATE(), @createId, GETDATE())`,
            {
              mk:       { type: sql.Int,      value: newMk },
              year:     { type: sql.NVarChar, value: orderYear },
              week:     { type: sql.NVarChar, value: orderWeek },
              mgr:      { type: sql.NVarChar, value: mgr },
              custKey:  { type: sql.Int,      value: resolvedCustKey },
              oc:       { type: sql.NVarChar, value: resolvedOrderCode },
              createId: { type: sql.NVarChar, value: 'admin' }, // 전산 호환 (CreateID='admin' 기준 필터)
            }
          );
        });
      }

      const detailResults = [];
      for (const item of items) {
        let prodKey = item.prodKey;
        if (!prodKey && item.prodName) {
          const pr = await tQuery(
            `SELECT TOP 1 ProdKey FROM Product WHERE ProdName LIKE @name AND isDeleted = 0`,
            { name: { type: sql.NVarChar, value: `%${item.prodName}%` } }
          );
          if (!pr.recordset[0]) { detailResults.push({ prodName: item.prodName, status: 'NOT_FOUND' }); continue; }
          prodKey = pr.recordset[0].ProdKey;
        }
        const qty = parseFloat(item.qty) || 0;
        // '개'/'stems'/'송이' 모두 steamQty로 정규화
        const rawUnit = item.unit || '박스';
        const unit = rawUnit === '개' ? '송이' : rawUnit;
        const boxQty   = unit === '박스' ? qty : 0;
        const bunchQty = unit === '단'   ? qty : 0;
        const steamQty = unit === '송이' ? qty : 0;

        // 기존 OrderDetail 확인 (같은 Master+품목)
        const existOd = await tQuery(
          `SELECT OrderDetailKey, OutQuantity FROM OrderDetail
           WHERE OrderMasterKey=@mk AND ProdKey=@pk AND isDeleted=0`,
          { mk: { type: sql.Int, value: mk }, pk: { type: sql.Int, value: prodKey } }
        );

        if (existOd.recordset.length > 0) {
          await appLog('createOrder', 'OD_UPDATE', `pk=${prodKey} box=${boxQty} bunch=${bunchQty} steam=${steamQty}`);
          await tQuery(
            `UPDATE OrderDetail SET BoxQuantity=@box, BunchQuantity=@bunch, SteamQuantity=@steam,
               OutQuantity=@oq, LastUpdateID=@uid, LastUpdateDtm=GETDATE()
             WHERE OrderMasterKey=@mk AND ProdKey=@pk AND isDeleted=0`,
            { box: { type: sql.Float, value: boxQty }, bunch: { type: sql.Float, value: bunchQty },
              steam: { type: sql.Float, value: steamQty },
              oq:  { type: sql.Float,    value: qty },
              uid: { type: sql.NVarChar, value: uid },
              mk: { type: sql.Int, value: mk }, pk: { type: sql.Int, value: prodKey } }
          );
          detailResults.push({ prodKey, prodName: item.prodName, qty, unit, status: 'UPDATED' });
        } else if (qty > 0) {
          await tryInsertWithRetry(tQuery, 'OrderDetail', 'OrderDetailKey', async (newNk) => {
            await appLog('createOrder', 'OD_INSERT', `nk=${newNk} pk=${prodKey} box=${boxQty} bunch=${bunchQty} steam=${steamQty}`);
            // 14차 패턴: OutQuantity=0, NoneOutQuantity=0
            await tQuery(
              `INSERT INTO OrderDetail
                 (OrderDetailKey, OrderMasterKey, ProdKey, BoxQuantity, BunchQuantity, SteamQuantity,
                  OutQuantity, NoneOutQuantity, isDeleted, CreateID, CreateDtm)
               VALUES (@nk, @mk, @pk, @box, @bunch, @steam, @oq, 0, 0, @uid, GETDATE())`,
              {
                nk:    { type: sql.Int,      value: newNk },
                mk:    { type: sql.Int,      value: mk },
                pk:    { type: sql.Int,      value: prodKey },
                box:   { type: sql.Float,    value: boxQty },
                bunch: { type: sql.Float,    value: bunchQty },
                steam: { type: sql.Float,    value: steamQty },
                oq:    { type: sql.Float,    value: qty },
                uid:   { type: sql.NVarChar, value: 'admin' }, // 전산 호환
              }
            );
          });
          detailResults.push({ prodKey, prodName: item.prodName, qty, unit, status: 'OK' });
        }
      }
      return { orderMasterKey: mk, results: detailResults };
    });

    await appLog('createOrder', '완료', `mk=${orderMasterKey} items=${results.length}`);
    return res.status(201).json({
      success: true,
      source: 'real_db',
      orderMasterKey,
      message: `주문 등록 완료 — ${results.filter(r => r.status === 'OK' || r.status === 'UPDATED').length}개 품목`,
      results,
    });
  } catch (err) {
    await appLog('createOrder', '오류', err.message, true);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── 수정: 기존 주문 수량 변경 ──────────────────────────
async function updateOrder(req, res) {
  const { orderMasterKey, items, manager, orderCode } = req.body;
  if (!orderMasterKey) {
    return res.status(400).json({ success: false, error: 'orderMasterKey 필요' });
  }

  try {
    const uid = req.user?.userId || 'system';
    const userName = req.user?.userName || uid;

    await withTransaction(async (tQuery) => {
      // Master 필드 업데이트 (manager, orderCode)
      if (manager !== undefined || orderCode !== undefined) {
        const sets = [];
        const params = { mk: { type: sql.Int, value: orderMasterKey } };
        if (manager !== undefined) {
          sets.push('Manager = @mgr');
          params.mgr = { type: sql.NVarChar, value: manager };
        }
        if (orderCode !== undefined) {
          sets.push('OrderCode = @oc');
          params.oc = { type: sql.NVarChar, value: orderCode };
        }
        if (sets.length > 0) {
          await tQuery(
            `UPDATE OrderMaster SET ${sets.join(', ')} WHERE OrderMasterKey = @mk`,
            params
          );
        }
      }

      // Detail 수량 업데이트
      if (Array.isArray(items)) {
        for (const item of items) {
          if (!item.detailKey) continue;
          const qty = parseFloat(item.qty) || 0;
          const unit = item.unit || '박스';
          const now = new Date();
          const timeStr = `${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

          // 기존 수량 조회 (이력용)
          const old = await tQuery(
            `SELECT BoxQuantity, BunchQuantity, SteamQuantity, OutQuantity FROM OrderDetail WHERE OrderDetailKey = @dk`,
            { dk: { type: sql.Int, value: item.detailKey } }
          );
          const oldRow = old.recordset[0];
          const oldQty = oldRow ? (oldRow.BoxQuantity || oldRow.BunchQuantity || oldRow.SteamQuantity || 0) : 0;

          // 14차 패턴: OutQuantity 는 건드리지 않음
          await tQuery(
            `UPDATE OrderDetail SET
              BoxQuantity = @box, BunchQuantity = @bunch, SteamQuantity = @steam
             WHERE OrderDetailKey = @dk`,
            {
              dk:    { type: sql.Int,   value: item.detailKey },
              box:   { type: sql.Float, value: unit === '박스' ? qty : 0 },
              bunch: { type: sql.Float, value: unit === '단'   ? qty : 0 },
              steam: { type: sql.Float, value: unit === '송이' ? qty : 0 },
            }
          );

          // 변경 이력 기록
          await tQuery(
            `INSERT INTO OrderHistory
              (OrderDetailKey, ChangeType, ColumName, BeforeValue, AfterValue, Descr, ChangeID, ChangeDtm)
             VALUES (@dk, '수정', '수량', @before, @after, @descr, @uid, GETDATE())`,
            {
              dk:     { type: sql.Int,      value: item.detailKey },
              before: { type: sql.NVarChar, value: String(oldQty) },
              after:  { type: sql.NVarChar, value: String(qty) },
              descr:  { type: sql.NVarChar, value: `[${timeStr} ${userName}] 주문수정` },
              uid:    { type: sql.NVarChar, value: uid },
            }
          );
        }
      }
    });

    return res.status(200).json({ success: true, message: '주문 수정 완료' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
