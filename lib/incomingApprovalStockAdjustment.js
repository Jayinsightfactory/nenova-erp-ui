import { createHash } from 'node:crypto';
import { roundStockQuantity } from './stockShortage.js';

// Native readback supplies the snapshots; absent/non-finite bases never become zero.
export function buildStockAdjustmentProposal({products,future,reservations,scope,source}) {
  const rows=[]; let canAdjust=true;
  for(const product of [...products].sort((a,b)=>a.ProdKey-b.ProdKey)) {
    const f=future.filter(r=>r.prodKey===product.ProdKey).map(r=>({year:r.year,week:r.week,remain:r.remain}));
    const reserved=reservations.filter(r=>r.prodKey===product.ProdKey).map(r=>({year:r.year,week:r.week,remain:r.remain}));
    const values=[product.Stock,...f.map(r=>r.remain),...reserved.map(r=>r.remain)];
    if(values.some(v=>typeof v!=='number'||!Number.isFinite(v)) || !f.length) {canAdjust=false;continue;}
    let added=0;
    const periods=[...f].sort((a,b)=>`${a.year}${a.week}`.localeCompare(`${b.year}${b.week}`));
    if(new Set(periods.map(r=>`${r.year}${r.week}`)).size!==periods.length){canAdjust=false;continue;}
    for(const period of periods){
      const reservation=reserved.filter(r=>r.year===period.year&&r.week===period.week);
      const available=Math.min(period.remain,...reservation.map(r=>r.remain));
      const quantity=roundStockQuantity(Math.max(0,-available-added));
      if(quantity>0){rows.push({prodKey:product.ProdKey,prodName:product.ProdName,unit:product.OutUnit,year:period.year,week:period.week,quantity,currentRemain:product.Stock,future:[period],reservations:reservation,basis:[...(period.remain+added<0?['FUTURE']:[]),...(reservation.some(r=>r.remain+added<0)?['RESERVATION']:[])]});added=roundStockQuantity(added+quantity);}
    }
    // A global Product.Stock deficit alone has no evidenced period to post against.
    if(roundStockQuantity(product.Stock+added)<0)canAdjust=false;

  }
  const fingerprint=createHash('sha256').update(JSON.stringify({source,products:[...products].sort((a,b)=>a.ProdKey-b.ProdKey),future,reservations,rows})).digest('hex');
  return {required:rows.length>0,fingerprint,rows,canAdjust};
}

export function stockAdjustmentReviewCode(proposal,review) {
  if(!proposal.canAdjust) return 'APPROVAL_STOCK_BASIS_MISSING';
  if(!proposal.required) return review?.rows?.length ? 'APPROVAL_STOCK_ADJUSTMENT_STALE' : null;
  if(!review?.acknowledged) return 'APPROVAL_STOCK_ADJUSTMENT_REQUIRED';
  const expected=proposal.rows.map(({prodKey,quantity,year,week})=>({prodKey,quantity,year,week}));
  if(review.fingerprint!==proposal.fingerprint || JSON.stringify(expected)!==JSON.stringify(review.rows)) return 'APPROVAL_STOCK_ADJUSTMENT_STALE';
  return null;
}
