import {profitDisplayCalculation} from '../lib/profitReportStoredCalculation.js';

export const SMOKE_FINANCIAL_COLUMNS=['C','E','F','G','H','I','J','K'];
const numeric=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const basis=value=>value?{
 year:value.year,major:value.major,week:value.week,method:value.method,
 value:numeric(value.value),quantity:numeric(value.quantity),unit:value.unit,
 average:value.average?Object.fromEntries(['unitCost','totalCost','purchaseQty','purchaseForeign','forwardingForeign','taxableRate','customsCost'].map(k=>[k,numeric(value.average[k])])):null,
}:null;

// Use the actual web projection, never silently recompute frozen/derived rows.
export function compareProfitSmokeOutput(payload,financialRows) {
 const displayed=profitDisplayCalculation(payload);
 const rows=new Map(displayed.rows.map(row=>[row.category,row]));
 const differences=financialRows.filter(row=>rows.has(row[0])).flatMap(row=>SMOKE_FINANCIAL_COLUMNS.flatMap((column,i)=>{
  const outputValue=row[i+1]??null,screenValue=rows.get(row[0]).calc?.[column]??null;
  if(outputValue===screenValue||(typeof outputValue==='number'&&typeof screenValue==='number'&&Math.abs(outputValue-screenValue)<1e-8))return [];
  const delta=typeof outputValue==='number'&&typeof screenValue==='number'?outputValue-screenValue:null;
  return [{category:row[0],column,screenValue,outputValue,delta,absoluteDelta:delta==null?null:Math.abs(delta),
   relativeDelta:delta==null?null:Math.abs(delta)/Math.max(1,Math.abs(screenValue)),
   roundedWon:column==='K'?null:{screen:numeric(screenValue)==null?null:Math.round(screenValue),output:numeric(outputValue)==null?null:Math.round(outputValue)}}];
 }));
 const changed=new Set(differences.map(d=>d.category));
 return {displayed,differences,evidence:displayed.rows.filter(row=>changed.has(row.category)).map(row=>({
  category:row.category,confirmed:!!row.confirmed,calculationFrozen:row.calculationFrozen===true,
  screen:Object.fromEntries(SMOKE_FINANCIAL_COLUMNS.map(k=>[k,numeric(row.calc?.[k])])),
  begin:basis(row.inventoryValuation?.begin),end:basis(row.inventoryValuation?.end),
 }))};
}
