// pages/api/master/index.js — 기준정보 CRUD (실제 DB)
import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

export default withAuth(async function handler(req, res) {
  const { entity } = req.query;
  if (req.method === 'GET')  return await getList(req, res, entity);
  if (req.method === 'POST') return await create(req, res, entity);
  if (req.method === 'PUT')  return await updatePricing(req, res);
  return res.status(405).end();
});

async function getList(req, res, entity) {
  try {
    let result;
    if (entity === 'customers') {
      result = await query(
        `SELECT CustKey, CustCode, CustName, CEO, Group1, CustArea,
          BusinessNumber, Manager, Tel, Mobile, BaseOutDay, OrderCode,
          UseType, TransType, isDeleted, Descr
         FROM Customer WHERE isDeleted=0 ORDER BY CustName`
      );
      return res.status(200).json({ success: true, source: 'real_db', data: result.recordset });
    }
    if (entity === 'products') {
      result = await query(
        `SELECT ProdKey, ProdCode, ProdName, ProdGroup, FlowerName, CounName,
          Cost, OutUnit, EstUnit, BunchOf1Box, SteamOf1Bunch, SteamOf1Box,
          Stock, isDeleted, Descr
         FROM Product WHERE isDeleted=0 ORDER BY CounName, FlowerName, ProdName`
      );
      return res.status(200).json({ success: true, source: 'real_db', data: result.recordset });
    }
    if (entity === 'pricing') {
      const { custKey, prodGroup } = req.query;
      let where = 'WHERE 1=1';
      const params = {};
      if (custKey)   { where += ' AND cpc.CustKey=@ck'; params.ck = { type: sql.Int, value: parseInt(custKey) }; }
      if (prodGroup) { where += ' AND p.CountryFlower=@pg'; params.pg = { type: sql.NVarChar, value: prodGroup }; }
      result = await query(
        `SELECT cpc.AutoKey, cpc.ProdKey, cpc.CustKey, cpc.Cost, cpc.Descr,
          p.ProdName, p.FlowerName, p.CounName, c.CustName
         FROM CustomerProdCost cpc
         JOIN Product p ON cpc.ProdKey=p.ProdKey
         JOIN Customer c ON cpc.CustKey=c.CustKey
         ${where}
         ORDER BY p.CounName, p.FlowerName, p.ProdName`, params
      );
      return res.status(200).json({ success: true, source: 'real_db', data: result.recordset });
    }
    if (entity === 'codes') {
      const [countries, flowers, farms] = await Promise.all([
        query(`SELECT CounKey, CounName, isSelectFlower, isUseOrderCode, Sort, Descr FROM Country WHERE isDeleted=0 ORDER BY Sort`),
        query(`SELECT FlowerKey, FlowerName, Sort, OrderNo, Descr FROM Flower WHERE isDeleted=0 ORDER BY Sort`),
        query(`SELECT f.FarmKey, f.FarmCode, f.FarmName, c.CounName FROM Farm f JOIN Country c ON f.CounKey=c.CounKey WHERE f.isDeleted=0 ORDER BY f.FarmName`),
      ]);
      return res.status(200).json({
        success: true, source: 'real_db',
        countries: countries.recordset,
        flowers: flowers.recordset,
        farms: farms.recordset,
      });
    }
    if (entity === 'users') {
      if (req.user.authority > 1) return res.status(403).json({ success: false, error: '관리자만 접근 가능합니다.' });
      result = await query(
        `SELECT UserID, UserName, DeptName, Email, Phone, Authority, isDeleted
         FROM UserInfo WHERE isDeleted=0 ORDER BY Authority, UserName`
      );
      return res.status(200).json({ success: true, source: 'real_db', data: result.recordset });
    }
    return res.status(400).json({ success: false, error: 'entity 파라미터 필요' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function create(req, res, entity) {
  try {
    if (entity === 'customers') {
      const { custName, custArea, manager, tel, mobile, baseOutDay, orderCode, ceo, businessNumber, descr } = req.body;
      await query(
        `INSERT INTO Customer
           (CustName, CustArea, Manager, Tel, Mobile, BaseOutDay, OrderCode, CEO, BusinessNumber, Descr,
            isDeleted, CreateID, CreateDtm)
         VALUES (@name, @area, @mgr, @tel, @mobile, @outDay, @oc, @ceo, @bn, @descr, 0, @uid, GETDATE())`,
        {
          name:   { type: sql.NVarChar, value: custName },
          area:   { type: sql.NVarChar, value: custArea || '' },
          mgr:    { type: sql.NVarChar, value: manager || '' },
          tel:    { type: sql.NVarChar, value: tel || '' },
          mobile: { type: sql.NVarChar, value: mobile || '' },
          outDay: { type: sql.Int,      value: parseInt(baseOutDay) || 0 },
          oc:     { type: sql.NVarChar, value: orderCode || '' },
          ceo:    { type: sql.NVarChar, value: ceo || '' },
          bn:     { type: sql.NVarChar, value: businessNumber || '' },
          descr:  { type: sql.NVarChar, value: descr || '' },
          uid:    { type: sql.NVarChar, value: req.user.userId },
        }
      );
      return res.status(201).json({ success: true, message: '거래처 등록 완료' });
    }
    if (entity === 'products') {
      const { prodCode, prodName, flowerName, counName, cost, outUnit, estUnit, bunchOf1Box, steamOf1Bunch, descr } = req.body;
      await query(
        `INSERT INTO Product
           (ProdCode, ProdName, FlowerName, CounName, Cost, OutUnit, EstUnit,
            BunchOf1Box, SteamOf1Bunch, SteamOf1Box, isDeleted, CreateID, CreateDtm)
         VALUES (@code, @name, @flower, @country, @cost, @outUnit, @estUnit,
                 @bunch, @steam, @bunch*@steam, 0, @uid, GETDATE())`,
        {
          code:    { type: sql.NVarChar, value: prodCode || '' },
          name:    { type: sql.NVarChar, value: prodName },
          flower:  { type: sql.NVarChar, value: flowerName || '' },
          country: { type: sql.NVarChar, value: counName || '' },
          cost:    { type: sql.Float,    value: parseFloat(cost) || 0 },
          outUnit: { type: sql.NVarChar, value: outUnit || '박스' },
          estUnit: { type: sql.NVarChar, value: estUnit || '박스' },
          bunch:   { type: sql.Float,    value: parseFloat(bunchOf1Box) || 0 },
          steam:   { type: sql.Float,    value: parseFloat(steamOf1Bunch) || 0 },
          uid:     { type: sql.NVarChar, value: req.user.userId },
        }
      );
      return res.status(201).json({ success: true, message: '품목 등록 완료' });
    }
    return res.status(400).json({ success: false, error: 'entity 파라미터 필요' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// PUT /api/master?entity=pricing — 업체별 단가 일괄 저장
async function updatePricing(req, res) {
  try {
    const { custKey, changes } = req.body; // changes: [{ autoKey, prodKey, cost }]
    if (!custKey || !Array.isArray(changes) || changes.length === 0) {
      return res.status(400).json({ success: false, error: 'custKey, changes 필요' });
    }
    for (const ch of changes) {
      if (ch.autoKey) {
        await query(
          `UPDATE CustomerProdCost SET Cost=@cost WHERE AutoKey=@ak`,
          { cost: { type: sql.Float, value: parseFloat(ch.cost)||0 }, ak: { type: sql.Int, value: ch.autoKey } }
        );
      } else {
        await query(
          `IF NOT EXISTS (SELECT 1 FROM CustomerProdCost WHERE CustKey=@ck AND ProdKey=@pk)
             INSERT INTO CustomerProdCost (CustKey, ProdKey, Cost) VALUES (@ck, @pk, @cost)
           ELSE
             UPDATE CustomerProdCost SET Cost=@cost WHERE CustKey=@ck AND ProdKey=@pk`,
          {
            ck:   { type: sql.Int,   value: parseInt(custKey) },
            pk:   { type: sql.Int,   value: parseInt(ch.prodKey) },
            cost: { type: sql.Float, value: parseFloat(ch.cost)||0 },
          }
        );
      }
    }
    return res.status(200).json({ success: true, saved: changes.length });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
