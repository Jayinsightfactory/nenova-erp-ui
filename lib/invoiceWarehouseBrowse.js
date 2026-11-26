import {isFreightItem} from './freightCalc.js';
import {baseCountry} from './countryClassification.js';
import {directProductCountry,hasProductIdentity,isInheritableOriginValue} from './receiptOriginInheritance.js';
import {isValidAwbCode,normalizeAwbCode} from './awbReferenceReceipt.js';
export function costWarehouseDisplay(row){
 if(typeof row.CostProductRows!=='string')return row;
 const items=JSON.parse(row.CostProductRows),goods=items.filter(p=>!isFreightItem(p.ProdName));
 const directCountries=[...new Set(goods.map(directProductCountry).filter(c=>c&&c!=='국내'))];
 const hasDomestic=goods.some(p=>directProductCountry(p)==='국내');
 const countries=hasDomestic?[...directCountries,'국내']:directCountries;
 const inheritableOnly=goods.length>0&&countries.length===0&&goods.every(p=>hasProductIdentity(p)&&isInheritableOriginValue(p.CounName));
 const {CostProductRows,...rest}=row;
 return {...rest,CountryName:countries.length===1?countries[0]:null,CostReferenceOnly:items.length>0&&goods.length===0,...(inheritableOnly?{_inheritableOrigin:true}:{})};
}
export function normalizeWarehouseBrowse(input = {}) {
  const orderYear = typeof input.orderYear === 'string' ? input.orderYear.trim() : '';
  const match = typeof input.orderWeek === 'string' && /^(\d{1,2})-(\d{1,2})$/.exec(input.orderWeek.trim());
  if (!/^20\d{2}$/.test(orderYear) || !match || +match[1] < 1 || +match[1] > 53 || +match[2] < 1 || +match[2] > 99) {
    throw Object.assign(new Error('조회 연도와 세부차수를 확인하세요. 예: 2026 / 44-01'), { statusCode: 400 });
  }
  return { orderYear, orderWeek: `${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}` };
}

export function filterInvoiceWarehouses(rows, scope, invoiceNo) {
  if (invoiceNo == null) return rows;
  const invoice = String(invoiceNo).trim();
  if (!invoice) return [];
  return rows.filter(row => String(row.OrderYear) === String(scope.orderYear)
    && row.OrderWeek === scope.orderWeek && String(row.InvoiceNo ?? '').trim() === invoice);
}

export async function listCostWarehouse({ queryFn, types, input }) {
  const scope = normalizeWarehouseBrowse(input);
  const result = await queryFn(`/* invoice-cost:warehouse-browse */
    SELECT TOP (501) wm.WarehouseKey,wm.OrderYear,wm.OrderWeek,wm.OrderNo,wm.FarmName,wm.InvoiceNo,
      wm.GrossWeight,wm.ChargeableWeight,CONVERT(varchar(10),wm.InputDate,23) AS InputDate,
      (SELECT p.ProdName,p.CounName,p.FlowerName
       FROM dbo.WarehouseDetail wd LEFT JOIN dbo.Product p ON p.ProdKey=wd.ProdKey
       WHERE wd.WarehouseKey=wm.WarehouseKey FOR JSON PATH) AS CostProductRows
    FROM dbo.WarehouseMaster wm
    WHERE OrderYear=@orderYear AND OrderWeek=@orderWeek AND ISNULL(isDeleted,0)=0
    ORDER BY WarehouseKey DESC`, {
    orderYear: { type: types.NVarChar(4), value: scope.orderYear },
    orderWeek: { type: types.NVarChar(5), value: scope.orderWeek },
  });
  const rows = result.recordset || [];
  const mapped = rows.slice(0, 500).map(costWarehouseDisplay);
  const awbCountries = new Map();
  for (const row of mapped) {
    const awb = normalizeAwbCode(row.OrderNo);
    if (!isValidAwbCode(awb) || row.CostReferenceOnly || !row.CountryName) continue;
    if (!awbCountries.has(awb)) awbCountries.set(awb, new Set());
    awbCountries.get(awb).add(row.CountryName);
  }
  const finalRows = mapped.map(({ _inheritableOrigin, ...row }) => {
    if (_inheritableOrigin && !row.CountryName) {
      const awb = normalizeAwbCode(row.OrderNo);
      const set = isValidAwbCode(awb) ? awbCountries.get(awb) : null;
      if (set?.size === 1) return { ...row, CountryName: [...set][0] };
    }
    return row;
  });
  return { scope, rows: finalRows, hasMore: rows.length > 500 };
}
