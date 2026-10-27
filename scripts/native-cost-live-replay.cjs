// Explicit read-only replay; every cost input is TEST_ONLY. No SQL or web writes.
const { mkdirSync, writeFileSync } = require('node:fs');
process.loadEnvFile('C:/Users/USER/nenova-erp-ui/.env.local');
const sql = require('mssql');
(async () => {
  const { readNativeCostSource, calculateNativeCost } = await import('../lib/nativeReceiptCost.js');
  const { INVOICE_COST_FORMULAS } = await import('../lib/invoiceReceiptCost.js');
  const { createNativeCostWorkbook } = await import('../lib/invoiceReceiptCostExport.js');
  const p = await sql.connect({ server:process.env.DB_SERVER,port:Number(process.env.DB_PORT||1433),database:process.env.DB_NAME,
    user:process.env.DB_USER,password:process.env.DB_PASSWORD,options:{encrypt:false,trustServerCertificate:true},connectionTimeout:15000,requestTimeout:15000 });
  try {
    const queryFn = async (text, params) => {
      if (/\b(INSERT|UPDATE|DELETE|EXEC|MERGE)\b/i.test(text)) throw new Error('READ_ONLY_VIOLATION');
      const r=p.request();for(const [name,v] of Object.entries(params))r.input(name,v.type,v.value);return r.query(text);
    };
    const scope={orderYear:'2026',orderWeek:'43-01',warehouseKey:7771};
    const source=await readNativeCostSource({queryFn,types:sql,input:scope});
    const input={...INVOICE_COST_FORMULAS.CN_SEA_ACTUAL_V1,formulaApplicabilityConfirmed:true,
      formulaEffectiveDate:source.inputDate,nativeCurrency:'CNY',freightCurrency:'CNY',exchangeRateKRW:200,
      exchangeRateType:'TEST_ONLY',exchangeRateDate:source.inputDate,freightAmount:100,customsTotalKRW:0,
      costSourceId:'TEST_ONLY native receipt replay',allocationScope:'SINGLE_INVOICE',allocationShareNumerator:1,allocationShareDenominator:1,
      lineInputs:source.lines.map(line=>({lineId:line.lineId,tariffRate:0,otherCostPerUnitKRW:100}))};
    const result=calculateNativeCost(source,{sourceHash:source.sourceHash,metadata:{currency:'CNY',transportMode:'SEA'},input});
    if(result.preview.status!=='APPROVED')throw new Error(JSON.stringify(result.preview.issues));
    const bytes=await createNativeCostWorkbook(result);
    const after=await readNativeCostSource({queryFn,types:sql,input:scope});
    if(source.sourceHash!==after.sourceHash)throw new Error('SOURCE_CHANGED');
    mkdirSync('outputs',{recursive:true});writeFileSync('outputs/native-cost-7771-TEST_ONLY.xlsx',bytes);
    console.log(JSON.stringify({warehouseKey:7771,rows:source.lines.length,excluded:source.excluded.length,bytes:bytes.length,unchanged:true,testOnly:true}));
  } finally {await p.close();}
})().catch(e=>{console.error(e.code||e.message);process.exitCode=1;});
