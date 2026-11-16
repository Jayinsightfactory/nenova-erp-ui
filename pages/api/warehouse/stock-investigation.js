import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';
import { classifyReceipt, investigationSql, eventSql, matchSql } from '../../../lib/warehouseStockInvestigation';

export default withAuth(async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if (req.method !== 'GET') { res.setHeader('Allow','GET'); return res.status(405).end(); }
  const {year,week,pk} = req.query;
  if (typeof year !== 'string' || !/^\d{4}$/.test(year)) return res.status(400).json({error:'조회 연도를 확인하세요.'});
  const params = {year:{type:sql.NVarChar,value:year}};
  try {
    if (req.query.day !== undefined) {
      const day=req.query.day;
      if(typeof day!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0,10)!==day) return res.status(400).json({error:'동기화 날짜를 확인하세요.'});
      const result=await query(matchSql,{...params,day:{type:sql.Date,value:new Date(day)}});
      return res.json({rows:result.recordset});
    }
    if (week !== undefined || pk !== undefined) {
      if (typeof week !== 'string' || !week || week.length>20 || !/^[1-9]\d*$/.test(pk) || Number(pk)>2147483647) return res.status(400).json({error:'차수와 품목을 확인하세요.'});
      const result = await query(eventSql,{...params,week:{type:sql.NVarChar,value:week},pk:{type:sql.Int,value:Number(pk)}});
      return res.json({events:result.recordsets[0],receipts:result.recordsets[1]});
    }
    const result = await query(investigationSql,params);
    return res.json({rows:result.recordset.map(classifyReceipt)});
  } catch {
    return res.status(500).json({error:'입고 진단 조회에 실패했습니다.'});
  }
});
