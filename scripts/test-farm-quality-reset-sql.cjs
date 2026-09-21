// Isolated SQL fixture only. Never reads production connection settings.
const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process'),sql=require('mssql');
const container='nenova-estimate-sql-test-20260826';
const info=JSON.parse(spawnSync('docker',['inspect',container],{encoding:'utf8',windowsHide:true}).stdout)[0];
assert.equal(info.Name,'/'+container);assert.equal(info.State.Running,true);assert.equal(info.Mounts.length,0);
assert.match(info.Config.Image,/^mcr\.microsoft\.com\/mssql\/server:2022/);
assert(info.HostConfig.PortBindings['1433/tcp'].some(p=>p.HostIp==='127.0.0.1'&&p.HostPort==='14339'));
const password=info.Config.Env.find(v=>v.startsWith('MSSQL_SA_PASSWORD=')).slice(18);
const config={server:'127.0.0.1',port:14339,user:'sa',password,options:{encrypt:false,trustServerCertificate:true}};
const dbName='NenovaQualityFixture_'+crypto.randomBytes(6).toString('hex');
const tables=['WebFarmQualityCase','WebFarmQualityEvent','WebFarmQualityEvidence','WebFarmQualityInbox','WebFarmQualityInboxSource'];
const q=(pool,text,params={})=>{const request=new sql.Request(pool);for(const [key,p] of Object.entries(params))request.input(key,p.type,p.value);return request.query(text);};
const transaction=pool=>async fn=>{const t=new sql.Transaction(pool);await t.begin();try{const result=await fn((s,p)=>q(t,s,p));await t.commit();return result;}catch(e){await t.rollback().catch(()=>{});throw e;}};
const caseKey='11111111-1111-4111-8111-111111111111',otherKey='22222222-2222-4222-8222-222222222222',inboxKey='33333333-3333-4333-8333-333333333333';
async function snapshot(pool){const result={};for(const table of tables)result[table]=(await q(pool,`SELECT * FROM dbo.[${table}] ORDER BY 1`)).recordset;return result;}
async function main(){let master,pool;try{
 master=await new sql.ConnectionPool({...config,database:'master'}).connect();assert.match(dbName,/^NenovaQualityFixture_[a-f0-9]{12}$/);
 await q(master,`CREATE DATABASE [${dbName}]`);pool=await new sql.ConnectionPool({...config,database:dbName}).connect();
 await q(pool,fs.readFileSync('docs/migrations/2026-09-14_farm_quality.sql','utf8'));
 await q(pool,`INSERT dbo.WebFarmQualityInbox(InboxKey,OrderYear,Excluded,ExclusionReason,CreatedBy) VALUES('${inboxKey}',2026,1,N'old',N'test');
 INSERT dbo.WebFarmQualityCase(CaseKey,OrderYear,SourceKey,ProdKey,FarmName,ProductName,Title,Status,DueDate,AppliedWeek,CreatedBy,CreatedByName,CreateRequest,InboxKey)
 VALUES('${caseKey}',2026,10,1,N'Farm',N'Item',N'Target',N'ANSWERED','2026-09-25',39,N'u',N'User',NEWID(),'${inboxKey}'),
 ('${otherKey}',2025,10,1,N'Farm',N'Item',N'Other year',N'WAITING',NULL,NULL,N'u',N'User',NEWID(),NULL);
 INSERT dbo.WebFarmQualityEvent(CaseKey,RequestKey,PayloadHash,Kind,Body,AuthorId,AuthorName,Department,AfterStatus)
 VALUES('${caseKey}',NEWID(),REPLICATE('a',64),N'REQUEST',N'Request',N'u',N'User',N'Sales',N'WAITING'),
 ('${caseKey}',NEWID(),REPLICATE('b',64),N'RESPONSE',N'Response',N'u',N'User',N'Import',N'ANSWERED'),
 ('${otherKey}',NEWID(),REPLICATE('c',64),N'REQUEST',N'Other request',N'u',N'User',N'Sales',N'WAITING');
 INSERT dbo.WebFarmQualityInboxSource(OrderYear,SourceKey,InboxKey,LinkedEventKey) SELECT 2026,10,'${inboxKey}',MIN(EventKey) FROM dbo.WebFarmQualityEvent WHERE CaseKey='${caseKey}';
 INSERT dbo.WebFarmQualityEvidence(EvidenceKey,OrderYear,EventKey,FileName,MimeType,ByteSize,Content,CreatedBy,ExpiresAt)
 SELECT NEWID(),2026,MIN(EventKey),N'fixture.png',N'image/png',1,0x01,N'u',DATEADD(day,1,SYSUTCDATETIME()) FROM dbo.WebFarmQualityEvent WHERE CaseKey='${caseKey}';
 INSERT dbo.WebFarmQualityEvidence(EvidenceKey,OrderYear,FileName,MimeType,ByteSize,Content,CreatedBy,ExpiresAt) VALUES(NEWID(),2025,N'draft.png',N'image/png',1,0x01,N'u',DATEADD(day,1,SYSUTCDATETIME()));`);
 const {canDeleteFarmQuality,qualityScope}=await import('../lib/farmQuality.js');
 const {buildQualityInbox}=await import('../lib/farmQualityInbox.js');
 const {feedbackNeedsRequest}=await import('../lib/farmQualityInboxSummary.js');
 const lockYear=async(q,year)=>{const result=await q("DECLARE @r int; EXEC @r=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @r result",{resource:{type:sql.NVarChar,value:`farm-quality-inbox:${year}`}});assert(result.recordset[0].result>=0);};
 const source=fs.readFileSync('lib/farmQualityStore.js','utf8').replace(/^(?:import|export \{).*;\r?\n/gm,'').replaceAll('export async function','async function');
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const reset=await new AsyncFunction('query','sql','withTransaction','canDeleteFarmQuality','qualityScope','lockQualityInboxYear',source+';return deleteQualityCase;')((s,p)=>q(pool,s,p),sql,transaction(pool),canDeleteFarmQuality,qualityScope,lockYear);
 const input={year:2026,caseKey,version:1},admin={userId:'nenovaSS3'};
 const before=await snapshot(pool);
 await q(pool,`INSERT dbo.WebFarmQualityCase(CaseKey,OrderYear,SourceKey,ProdKey,FarmName,ProductName,Title,Status,CreatedBy,CreatedByName,CreateRequest,InboxKey)
 VALUES('44444444-4444-4444-8444-444444444444',2026,20,1,N'Farm',N'Item',N'Shared',N'WAITING',N'u',N'User',NEWID(),'${inboxKey}')`);
 const shared=await snapshot(pool);await assert.rejects(()=>reset(input,admin),/공유/);assert.deepEqual(await snapshot(pool),shared);
 await q(pool,"DELETE dbo.WebFarmQualityCase WHERE CaseKey='44444444-4444-4444-8444-444444444444'");
 for(const user of [{userId:'admin'},{userId:'NENOVASS3'},{userId:'nenovaSS3 '},{userId:'sales',deptName:'수입부'},{...admin,accountActive:false}])await assert.rejects(()=>reset(input,user),e=>e.code==='FARM_QUALITY_DELETE_ADMIN_ONLY');
 for(const patch of [{year:2025},{year:2027},{version:0},{version:2},{caseKey:''}])await assert.rejects(()=>reset({...input,...patch},admin));
 assert.deepEqual(await snapshot(pool),before);
 await q(pool,"CREATE TRIGGER dbo.QualityResetFail ON dbo.WebFarmQualityCase AFTER UPDATE AS THROW 51000,'fixture failure',1;");
 await assert.rejects(()=>reset(input,admin),/fixture failure/);assert.deepEqual(await snapshot(pool),before,'children restored on failed parent update');
 await q(pool,'DROP TRIGGER dbo.QualityResetFail');
 const outcomes=await Promise.allSettled([reset(input,admin),reset(input,admin)]);
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(outcomes.filter(r=>r.status==='rejected').length,1);
 const after=await snapshot(pool),target=after.WebFarmQualityCase.find(c=>c.CaseKey.toLowerCase()===caseKey);
 assert.equal(target.Status,'NEW');assert.equal(target.Version,2);assert.equal(target.SourceKey,10);assert.equal(target.DueDate,null);assert.equal(target.AppliedWeek,null);
 assert.equal(after.WebFarmQualityEvent.length,1);assert.equal(after.WebFarmQualityEvidence.length,1);assert.equal(after.WebFarmQualityInboxSource.length,0);assert.equal(after.WebFarmQualityInbox[0].Excluded,false);
 assert.deepEqual(after.WebFarmQualityCase.find(c=>c.OrderYear===2025),before.WebFarmQualityCase.find(c=>c.OrderYear===2025));
 const inbox=buildQualityInbox({scope:{year:2026,from:1,to:53},sources:[],signals:[],cases:after.WebFarmQualityCase,inboxes:after.WebFarmQualityInbox,links:after.WebFarmQualityInboxSource});
 assert.equal(inbox.items.length,1);assert.equal(inbox.items[0].excluded,false);assert(feedbackNeedsRequest(inbox.items[0]),'even a historical case remains in request-before list');
 console.log('PASS SQL reset: exact admin, stale/year guards, rollback, concurrent reset, NEW visibility, source anchor and foreign history/draft preservation');
}finally{await pool?.close();if(master){assert.match(dbName,/^NenovaQualityFixture_[a-f0-9]{12}$/);await q(master,`IF DB_ID(N'${dbName}') IS NOT NULL BEGIN ALTER DATABASE [${dbName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${dbName}]; END`);await master.close();}}}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
