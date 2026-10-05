import { query, sql, withTransaction } from './db.js';
import { requirePnlPartner } from './pnlHotelRegistry.js';
import { pnlPeriodBaseMajor } from './raumPnlPeriod.js';

function fail(message, statusCode = 400) {
 const error = new Error(message); error.statusCode = statusCode; throw error;
}
export function normalizeHotelCustomerRequest(raw) {
 const integerInput = value => typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value.trim()));
 if (raw.custKey !== null && !integerInput(raw.custKey)) fail('전산 업체를 선택하세요.');
 if (!integerInput(raw.revision)) fail('업체 연결 기준을 다시 조회하세요.');
 const custKey = raw.custKey === null ? null : Number(raw.custKey);
 const revision = Number(raw.revision);
 if (raw.custKey !== null && (!Number.isSafeInteger(custKey) || custKey <= 0)) fail('전산 업체를 선택하세요.');
 if (!Number.isSafeInteger(revision) || revision < 0 || raw.revision == null) fail('업체 연결 기준을 다시 조회하세요.');
 if (!raw.partnerCode) fail('호텔을 지정하세요.');
 return { partnerCode: String(raw.partnerCode), custKey, revision };
}
export async function loadHotelCustomerMap(partnerCode, runQuery = query) {
 const partner = await requirePnlPartner(partnerCode, runQuery);
 const result = await runQuery(`SELECT m.CustKey, m.Revision, c.CustName,
 CASE WHEN c.CustKey IS NOT NULL THEN 1 ELSE 0 END AS Active
 FROM dbo.WebPnlHotelCustomerMap m
 LEFT JOIN Customer c ON c.CustKey=m.CustKey AND c.isDeleted=0
 WHERE m.PartnerCode=@pc`, { pc: { type: sql.NVarChar, value: partner.code } });
 const row = result.recordset?.[0];
 return { partnerCode: partner.code, custKey: row?.CustKey ?? null, custName: row?.CustName ?? null,
 revision: Number(row?.Revision ?? 0), active: Number(row?.Active ?? 0) === 1 };
}
export async function saveHotelCustomerMap(raw, actor, runTransaction = withTransaction) {
 const input = normalizeHotelCustomerRequest(raw);
 return runTransaction(async runQuery => {
  const partner = await requirePnlPartner(input.partnerCode, runQuery);
  const params = { pc: { type: sql.NVarChar, value: partner.code }, ck: { type: sql.Int, value: input.custKey },
   actor: { type: sql.NVarChar, value: String(actor || 'user').slice(0,100) } };
  const current = await runQuery('SELECT Revision FROM dbo.WebPnlHotelCustomerMap WITH (UPDLOCK,HOLDLOCK) WHERE PartnerCode=@pc', params);
  if (Number(current.recordset?.[0]?.Revision ?? 0) !== input.revision) fail('다른 작업에서 업체 연결이 변경되었습니다. 다시 조회하세요.',409);
  if (input.custKey !== null) {
   const customer = await runQuery('SELECT CustKey FROM Customer WITH (HOLDLOCK) WHERE CustKey=@ck AND isDeleted=0', params);
   if (!customer.recordset?.[0]) fail('사용 가능한 전산 업체를 선택하세요.');
  }
  if (current.recordset?.[0]) await runQuery('UPDATE dbo.WebPnlHotelCustomerMap SET CustKey=@ck, Revision=Revision+1, UpdatedBy=@actor, UpdatedAt=SYSUTCDATETIME() WHERE PartnerCode=@pc',params);
  else await runQuery('INSERT INTO dbo.WebPnlHotelCustomerMap (PartnerCode,CustKey,Revision,UpdatedBy) VALUES (@pc,@ck,1,@actor)',params);
  return loadHotelCustomerMap(partner.code,runQuery);
 });
}

/** Exact selected customer/year reference; no name guesses and no ERP writes. */
export async function loadHotelCustomerShipments(partnerCode, orderYear, major, runQuery = query) {
 let baseMajor;
 try { baseMajor = pnlPeriodBaseMajor(major); } catch { fail('참조할 결산 연도와 차수를 지정하세요.'); }
 if (String(major).includes('-') && partnerCode !== 'shilla') fail('하위 결산 기간은 신라호텔에서만 사용할 수 있습니다.');
 if (!/^\d{4}$/.test(String(orderYear)) || Number(baseMajor)<1 || Number(baseMajor)>53) fail('참조할 결산 연도와 차수를 지정하세요.');
 const mapping = await loadHotelCustomerMap(partnerCode,runQuery);
 if (!mapping.active) fail('활성 전산 업체를 먼저 연결하세요.');
 const result=await runQuery(`SELECT sm.OrderWeek, sd.ProdKey, p.ProdName, p.OutUnit,
 SUM(ISNULL(sd.OutQuantity,0)) AS OutQuantity
 FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
 JOIN Product p ON p.ProdKey=sd.ProdKey AND p.isDeleted=0
 WHERE sm.CustKey=@ck AND sm.OrderYear=@yr AND sm.OrderWeek LIKE @week
 AND ISNULL(sm.isDeleted,0)=0
 GROUP BY sm.OrderWeek,sd.ProdKey,p.ProdName,p.OutUnit
 ORDER BY sm.OrderWeek,p.ProdName`,{
 ck:{type:sql.Int,value:mapping.custKey},yr:{type:sql.NVarChar,value:String(orderYear)},
 week:{type:sql.NVarChar,value:`${baseMajor}-%`},
 });
 return {mapping,rows:result.recordset || []};
}
