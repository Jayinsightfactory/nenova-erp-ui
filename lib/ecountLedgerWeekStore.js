import {query,sql} from './db';
import {compareLedgerWeeks} from './ecountLedgerWeekComparison.cjs';
export async function readLedgerWeekComparison(snapshot){
  if(!snapshot?.ledger)return null;
  const ledger=snapshot.ledger;
  try{
    const result=await query(`SELECT CONVERT(char(10),TRY_CONVERT(date,BaseYmd),23) AS dateOnly,
      OrderYearWeek AS orderYearWeek FROM PeriodDay
      WHERE TRY_CONVERT(date,BaseYmd) BETWEEN DATEADD(day,-6,@from) AND DATEADD(day,6,@to)
      ORDER BY TRY_CONVERT(date,BaseYmd)`,{
      from:{type:sql.Date,value:ledger.periodFrom},to:{type:sql.Date,value:ledger.periodTo},
    });
    return compareLedgerWeeks(ledger,snapshot.receipts,result.recordset);
  }catch{return {status:'UNAVAILABLE',reason:'CALENDAR_UNAVAILABLE',rows:[]};}
}
