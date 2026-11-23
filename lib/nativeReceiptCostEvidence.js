import {createHash} from 'node:crypto';
import catalog from '../data/native-cost-source-evidence.json' with {type:'json'};

const numericFields=['WarehouseKey','WdetailKey','ProdKey','BoxQuantity','BunchQuantity','SteamQuantity','OutQuantity','UPrice','TPrice','SteamOf1Bunch','SteamOf1Box','TariffRate','ProductDeleted'];
const textFields=['OrderYear','OrderWeek','FarmName','InvoiceNo','InputDate','OrderCode','ProdName','OutUnit','CounName','FlowerName'];
const basename=value=>String(value||'').split(/[\\/]/).pop();

// Reviewed source evidence is data, never a request-supplied exclusion rule.
export function nativeCostSourceFingerprint(rows){
  const values=[...rows].sort((a,b)=>a.WdetailKey-b.WdetailKey).map(row=>[
    ...numericFields.map(key=>row[key]??null),
    ...textFields.map(key=>String(row[key]??'').trim()),basename(row.FileName),
  ]);
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

export function resolveNativeCostEvidence(rows,records=catalog.records){
  if(!Array.isArray(rows)||!rows.length)return null;
  const h=rows[0],digest=nativeCostSourceFingerprint(rows);
  const matches=records.filter(e=>e.scope.warehouseKey===h.WarehouseKey
    &&e.scope.orderYear===String(h.OrderYear)&&e.scope.orderWeek===h.OrderWeek
    &&e.scope.farmName===String(h.FarmName||'').trim()&&e.scope.invoiceNo===String(h.InvoiceNo||'').trim()
    &&e.scope.fileName===basename(h.FileName)&&e.rowCount===rows.length&&e.nativeDigest===digest
    &&/^[a-f0-9]{64}$/.test(e.source?.sha256||''));
  if(matches.length!==1)return null;
  const e=matches[0],byKey=new Map(rows.map(r=>[r.WdetailKey,r]));
  if(e.weights?.length!==2||new Set(e.weights.map(w=>w.key)).size!==2
    ||new Set(e.weights.map(w=>w.kind)).size!==2||!e.weights.every(w=>['GW','CW'].includes(w.kind)))return null;
  for(const w of e.weights){
    const r=byKey.get(w.key);
    if(!r||r.ProdKey!=null||String(r.ProdName||'').trim()||r.OutQuantity!=null||r.OutUnit!=null
      ||String(r.OrderCode)!==w.orderCode||!(w.kg>0)||r.SteamQuantity!==w.kg
      ||['BoxQuantity','BunchQuantity','SteamOf1Bunch','SteamOf1Box'].some(k=>r[k]!==1)
      ||r.UPrice!==0||r.TPrice!==0)return null;
    const stored=w.kind==='GW'?h.GrossWeight:h.ChargeableWeight;
    if(stored!=null&&stored!==w.kg)return null;
  }
  const f=byKey.get(e.freight?.key);
  if(!f||!(f.ProdKey>0)||f.TPrice!==e.freight.amount||!(e.freight.amount>=0)
    ||!/^운송료$|^FREIGHT(?: CHARGES?)?$/i.test(String(f.ProdName||'').trim()))return null;
  if(e.categories.some(c=>!byKey.get(c.key)?.ProdKey||!Number.isSafeInteger(c.code)||c.code<1||c.code>21))return null;
  for(const c of e.unitConversions||[]){
    const r=byKey.get(c.key);
    if(!r||c.from!=='송이'||c.to!=='BUNCH'||r.OutUnit!==c.from||r.SteamOf1Bunch!==1
      ||!(r.BunchQuantity>0)||r.SteamQuantity!==r.BunchQuantity||r.OutQuantity!==r.BunchQuantity
      ||Math.abs(r.UPrice*r.BunchQuantity-r.TPrice)>1e-6)return null;
  }
  if(e.exchangeRate&&(!(e.exchangeRate.value>0)||!Number.isFinite(e.exchangeRate.value)
    ||e.exchangeRate.currency!=='CNY'||!/^[a-f0-9]{64}$/.test(e.exchangeRate.sourceHash||'')))return null;
  return structuredClone(e);
}
