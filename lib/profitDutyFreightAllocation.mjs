// Duty-only absolute allocation: preserve each AWB's native weight/CBM bucket amount.
// All goods, including unapproved tariff products, remain in the quantity denominator.
export function allocateDutyFreightByAwb(calculation) {
  const allocations=new Map(), buckets=[];
  for(const bucket of calculation.categories||[]){
    const rows=(calculation.rows||[]).filter(r=>r.freightBucketKey===bucket.allocationKey);
    let quantities=rows.map(r=>Number(r.freightAllocationQuantity||0));
    let sum=quantities.reduce((a,n)=>a+n,0),expected=Number(bucket.allocationQuantity),unit=bucket.allocationUnit;
    // Some invoices record only actual stems. Keep this bucket's absolute charge;
    // use recorded WarehouseDetail stems only, never current-master conversion.
    if((!(sum>0)||rows.some((r,i)=>Number(r.totalPriceUSD)>0&&!(quantities[i]>0)))
      && rows.every(r=>Number(r.recordedSteamQty)>0||!(Number(r.totalPriceUSD)>0))){
      quantities=rows.map(r=>Number(r.recordedSteamQty)||0);sum=quantities.reduce((a,n)=>a+n,0);expected=sum;unit='송이(입고 원행)';
    }
    const amount=Number(bucket.freightUSD);
    const complete=Number.isFinite(amount)&&amount>=0&&sum>0&&Number.isFinite(expected)
      &&Math.abs(sum-expected)<1e-7*Math.max(1,sum)
      &&rows.every((r,i)=>quantities[i]>0||!(Number(r.totalPriceUSD)>0));
    rows.forEach((row,i)=>allocations.set(Number(row.warehouseDetailKey),complete?amount*quantities[i]/sum:null));
    buckets.push({key:bucket.allocationKey,amount,quantity:sum,expectedQuantity:expected,unit,complete});
  }
  const nativeTotal=buckets.reduce((s,b)=>s+b.amount,0),invoiceTotal=Number(calculation.header?.freightTotalUSD);
  const correction=calculation.header?.dutyFreightMetricCorrection;
  if(correction?.method==='china_40cm_exact_residual'){
    const rows=calculation.rows||[],denominator=Number(correction.denominator);
    const gw=Number(calculation.header?.gw),cw=Number(calculation.header?.cw);
    const quantities=rows.map(r=>r.dutyFreightMetricQuantity);
    const total=quantities.reduce((s,n)=>s+Number(n),0);
    const valid=['GW','CBM'].includes(correction.basis)&&denominator>0
      &&Number.isFinite(gw)&&Number.isFinite(cw)&&gw>0&&cw>0&&gw<=cw+0.01
      &&denominator===(correction.basis==='GW'?gw:cw)
      &&Number.isFinite(invoiceTotal)&&invoiceTotal>=0&&rows.length>0
      &&new Set(rows.map(r=>Number(r.warehouseDetailKey))).size===rows.length
      &&rows.every((r,i)=>Number(r.warehouseDetailKey)>0&&quantities[i]!=null
        &&Number.isFinite(quantities[i])&&quantities[i]>=0
        &&(quantities[i]>0||!(Number(r.totalPriceUSD)>0)))
      &&Math.abs(total-denominator)<1e-7*Math.max(1,denominator);
    if(valid){
      for(let i=0;i<rows.length;i++)allocations.set(Number(rows[i].warehouseDetailKey),invoiceTotal*quantities[i]/denominator);
      const allocatedTotal=[...allocations.values()].reduce((s,n)=>s+n,0);
      if(Math.abs(allocatedTotal-invoiceTotal)<0.01)return {allocations,evidence:{invoiceTotal,nativeTotal,
        allocatedTotal,conserved:true,buckets,source:calculation.header?.freightSource,
        correction:{...correction,total,source:'receipt_quantity_and_existing_china_metrics'}}};
    }
    // An incomplete correction must not fall through to a different allocation.
    for(const key of allocations.keys())allocations.set(key,null);
    return {allocations,evidence:{invoiceTotal,nativeTotal,conserved:false,buckets,
      source:calculation.header?.freightSource,correction:{...correction,total,invalid:true}}};
  }
  const conserved=Number.isFinite(invoiceTotal)&&Math.abs(nativeTotal-invoiceTotal)<0.01&&buckets.every(b=>b.complete);
  if(!conserved)for(const key of allocations.keys())allocations.set(key,null);
  return {allocations,evidence:{invoiceTotal,nativeTotal,conserved,buckets,source:calculation.header?.freightSource}};
}
