export function omissionSql(a='d') {
 if(!/^[a-zA-Z][a-zA-Z0-9]*$/.test(a))throw Error('Invalid alias');
 const j=f=>`JSON_VALUE(CASE WHEN ISJSON(om.AfterJson)=1 THEN om.AfterJson ELSE N'{}' END,N'$.${f}')`;
 return `EXISTS(SELECT 1 FROM WebSalesDefectDeductionHistory om WHERE om.ActionType=N'PERMANENT_OMIT' AND TRY_CONVERT(INT,${j('orderYear')})=${a}.OrderYear AND ${j('orderWeek')}=${a}.OrderWeek AND TRY_CONVERT(INT,${j('custKey')})=${a}.CustKey AND TRY_CONVERT(INT,${j('prodKey')})=${a}.ProdKey AND TRY_CONVERT(DECIMAL(18,4),${j('quantity')})=${a}.Quantity AND ${j('sourceUnit')}=CASE WHEN ${a}.SourceUnit IN(N'송이',N'대',N'스팀',N'스팀(대)') THEN N'스팀(대)' ELSE ${a}.SourceUnit END)`;
}
