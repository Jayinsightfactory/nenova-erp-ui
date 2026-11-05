import { query, sql } from './db';
import { orderWeekToDateRange } from './orderWeekDate';
import { compareEcountSales } from './salesHistoryReviewPolicy';

// SQL GETDATE is already KST (probe UTC offset +540min); display raw converted SQL time.
// Read collected ECOUNT sales only; never calls login, scraping, or SaveSale.
export async function readEcountSalesHistory({ orderYear, major, currentRows }) {
  if (!Number.isInteger(Number(major)) || Number(major)<1 || Number(major)>53)throw Error('대차수(1~53)를 입력하세요.');
  const range=orderWeekToDateRange(Number(orderYear),Number(major),2);
  if(!range)throw Error('대차수(1~53)를 입력하세요.');
  const saleDate=range.end.toISOString().slice(0,10).replace(/-/g,'/');
  const params={date:{type:sql.NVarChar,value:saleDate}};
  const result=await query(`SELECT TOP 1 s.SnapshotKey, s.VerifyStatus,
      CONVERT(varchar(19), s.TakenAt,120) AS takenAt
    FROM WebEcountSnapshot s
    WHERE s.Dataset='sales' AND (
      (REPLACE(s.PeriodFrom,'-','/')<=@date AND REPLACE(s.PeriodTo,'-','/')>=@date)
      OR ((s.PeriodFrom IS NULL OR s.PeriodTo IS NULL) AND EXISTS (SELECT 1 FROM WebEcountRow r WHERE r.SnapshotKey=s.SnapshotKey
        AND r.Dataset='sales' AND LEFT(r.RefDate,10)=@date AND ISNULL(r.IsSubtotal,0)=0)))
    ORDER BY s.SnapshotKey DESC`,params);
  const snapshot=result.recordset[0];
  if(!snapshot || !['GREEN','YELLOW'].includes(snapshot.VerifyStatus))return {noEcount:true,saleDate,baseline:[],byCust:[],baseTotal:null,currTotal:currentRows.reduce((s,r)=>s+Number(r.Amount||0)+Number(r.Vat||0),0)};
  const source=await query(`SELECT CustName,ProdName,Payload FROM WebEcountRow
    WHERE SnapshotKey=@sk AND Dataset='sales' AND LEFT(RefDate,10)=@date AND ISNULL(IsSubtotal,0)=0`,
    {...params,sk:{type:sql.Int,value:snapshot.SnapshotKey}});
  const ecountRows=source.recordset.map(r=>{
    let p;try{p=JSON.parse(r.Payload)}catch{throw Error('이카운트 판매 원본 해석 실패')}
    for (const key of ['qty','unitPrice','supplyAmt','vat','total']) {
      const raw=p[key]; const number=Number(String(raw ?? '').replace(/[,\s₩]/g,''));
      if(raw===null || raw===undefined || raw==='' || !Number.isFinite(number))throw Error('이카운트 판매 원본의 수량·단가·금액 확인 필요');
      p[key]=number;
    }
    if(Math.abs(p.total-p.supplyAmt-p.vat)>1)throw Error('이카운트 판매 원본 합계 검산 실패');
    return {...p,custName:r.CustName||p.custName,prodName:r.ProdName||p.prodName};
  });
  const customers=await query(`SELECT CustKey,CustName FROM Customer`,{});
  const types=await query(`SELECT DetailCode,Descr FROM CodeInfo WHERE Category='EstimateType'`,{});
  const comparison=compareEcountSales({ecountRows,currentRows,customers:customers.recordset,estimateTypes:Object.fromEntries(types.recordset.map(t=>[t.DetailCode,t.Descr]))});
  return {...comparison,noEcount:false,saleDate,baseline:[{week:major,type:'ECOUNT',snapshotKey:snapshot.SnapshotKey,takenAt:snapshot.takenAt}],ecountRowCount:ecountRows.length,sourceStatus:snapshot.VerifyStatus};
}
