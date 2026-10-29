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
  const conserved=Number.isFinite(invoiceTotal)&&Math.abs(nativeTotal-invoiceTotal)<0.01&&buckets.every(b=>b.complete);
  if(!conserved)for(const key of allocations.keys())allocations.set(key,null);
  return {allocations,evidence:{invoiceTotal,nativeTotal,conserved,buckets,source:calculation.header?.freightSource}};
}
