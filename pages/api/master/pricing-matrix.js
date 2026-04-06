// pages/api/master/pricing-matrix.js
// 업체 × 품목 단가 매트릭스 조회/저장

import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

export default withAuth(async function handler(req, res) {
  if (req.method === 'GET')  return await getMatrix(req, res);
  if (req.method === 'PUT')  return await saveMatrix(req, res);
  return res.status(405).end();
});

// GET: 업체 목록 + 품목 목록 + 단가 매트릭스
async function getMatrix(req, res) {
  try {
    const { custKeys, flowerName, counName, prodSearch } = req.query;

    // 업체 목록 (담당자 있는 업체 전체 — 필터용)
    const custResult = await query(
      `SELECT CustKey, CustName, Manager, CustArea
       FROM Customer
       WHERE isDeleted=0 AND Manager IS NOT NULL AND Manager <> ''
       ORDER BY CustName`
    );
    const allCustomers = custResult.recordset;

    // 선택된 업체 키 파싱
    const selectedKeys = custKeys
      ? custKeys.split(',').map(k => parseInt(k)).filter(k => !isNaN(k))
      : [];

    // 품목 조건 구성
    const prodParams = {};
    let prodWhere = 'WHERE p.isDeleted=0';
    if (flowerName) {
      prodWhere += ' AND p.FlowerName=@flower';
      prodParams.flower = { type: sql.NVarChar, value: flowerName };
    }
    if (counName) {
      prodWhere += ' AND p.CounName=@coun';
      prodParams.coun = { type: sql.NVarChar, value: counName };
    }
    if (prodSearch) {
      prodWhere += ' AND (p.ProdName LIKE @ps OR p.FlowerName LIKE @ps OR p.CounName LIKE @ps)';
      prodParams.ps = { type: sql.NVarChar, value: `%${prodSearch}%` };
    }

    // 국가/꽃 목록 (필터 드롭다운용)
    const [counResult, flowerResult, prodResult] = await Promise.all([
      query(`SELECT DISTINCT CounName FROM Product WHERE isDeleted=0 AND CounName IS NOT NULL AND CounName<>'' ORDER BY CounName`),
      query(`SELECT DISTINCT FlowerName FROM Product WHERE isDeleted=0 AND FlowerName IS NOT NULL AND FlowerName<>'' ORDER BY FlowerName`),
      query(
        `SELECT p.ProdKey, p.ProdName, p.FlowerName, p.CounName, p.Cost AS DefaultCost
         FROM Product p
         ${prodWhere}
         ORDER BY p.CounName, p.FlowerName, p.ProdName`,
        prodParams
      ),
    ]);

    const products = prodResult.recordset;
    const prodKeys = products.map(p => p.ProdKey);

    // 선택된 업체들의 단가 조회
    let costs = {};
    if (selectedKeys.length > 0 && prodKeys.length > 0) {
      // custKey IN (...)  AND  prodKey IN (...) 로 조회
      const custKeyList = selectedKeys.join(',');
      const prodKeyList = prodKeys.join(',');
      const costResult = await query(
        `SELECT AutoKey, CustKey, ProdKey, Cost
         FROM CustomerProdCost
         WHERE CustKey IN (${custKeyList}) AND ProdKey IN (${prodKeyList})`
      );
      for (const row of costResult.recordset) {
        costs[`${row.CustKey}_${row.ProdKey}`] = { autoKey: row.AutoKey, cost: row.Cost };
      }
    }

    return res.status(200).json({
      success: true,
      allCustomers,
      products,
      costs,
      counNames:   counResult.recordset.map(r => r.CounName),
      flowerNames: flowerResult.recordset.map(r => r.FlowerName),
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// PUT: 단가 일괄 저장 (여러 업체 × 여러 품목)
async function saveMatrix(req, res) {
  try {
    const { changes } = req.body;
    // changes: [{ custKey, prodKey, autoKey?, cost }]
    if (!Array.isArray(changes) || changes.length === 0) {
      return res.status(400).json({ success: false, error: 'changes 배열 필요' });
    }
    for (const ch of changes) {
      const ck   = parseInt(ch.custKey);
      const pk   = parseInt(ch.prodKey);
      const cost = parseFloat(ch.cost) || 0;
      if (!ck || !pk) continue;

      if (ch.autoKey) {
        await query(
          `UPDATE CustomerProdCost SET Cost=@cost WHERE AutoKey=@ak`,
          { cost: { type: sql.Float, value: cost }, ak: { type: sql.Int, value: ch.autoKey } }
        );
      } else {
        await query(
          `IF NOT EXISTS (SELECT 1 FROM CustomerProdCost WHERE CustKey=@ck AND ProdKey=@pk)
             INSERT INTO CustomerProdCost (CustKey, ProdKey, Cost) VALUES (@ck, @pk, @cost)
           ELSE
             UPDATE CustomerProdCost SET Cost=@cost WHERE CustKey=@ck AND ProdKey=@pk`,
          {
            ck:   { type: sql.Int,   value: ck },
            pk:   { type: sql.Int,   value: pk },
            cost: { type: sql.Float, value: cost },
          }
        );
      }
    }
    return res.status(200).json({ success: true, saved: changes.length });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
