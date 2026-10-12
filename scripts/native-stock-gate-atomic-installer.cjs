// Main-only installer. Default invocation is offline dry-run; never clears a gate.
const fs=require('node:fs'),assert=require('node:assert/strict');
const {patch,hash,EXPECTED}=require('./native-stock-gate-atomic.cjs');
const META=`SELECT m.definition,m.uses_ansi_nulls,m.uses_quoted_identifier,m.execute_as_principal_id,
 (SELECT COUNT(*) FROM sys.crypt_properties WHERE major_id=m.object_id) signatures,
 (SELECT CONVERT(varchar(64),CONVERT(varbinary(32),value),2) FROM sys.extended_properties WHERE class=1 AND major_id=m.object_id AND minor_id=0 AND name=N'NenovaStockGateOwnerV2Hash') propertyHash
 FROM sys.sql_modules m WHERE m.object_id=OBJECT_ID(N'dbo.usp_StockCalculation',N'P');
SELECT parameter_id,name,TYPE_NAME(user_type_id) type,max_length,precision,scale,is_output
 FROM sys.parameters WHERE object_id=OBJECT_ID(N'dbo.usp_StockCalculation',N'P') ORDER BY parameter_id;`;
const PARAMETERS=[['@OrderYear','nvarchar',40,0,0,false],['@OrderWeek','nvarchar',40,0,0,false],['@ProdKey','int',4,10,0,false],['@iUserID','nvarchar',40,0,0,false],['@oResult','int',4,10,0,true],['@oMessage','nvarchar',-1,0,0,true]].map((a,i)=>({parameter_id:i+1,name:a[0],type:a[1],max_length:a[2],precision:a[3],scale:a[4],is_output:a[5]}));
function checkMetadata(result,expectedHash){
 const m=result.recordsets?.[0];assert.equal(m?.length,1,'Exactly one visible unencrypted module required');
 assert.equal(hash(m[0].definition),expectedHash,'Exact module hash changed');
 assert.equal(m[0].uses_ansi_nulls,true);assert.equal(m[0].uses_quoted_identifier,true);assert.equal(m[0].execute_as_principal_id,null);assert.equal(m[0].signatures,0,'Signed modules require separate signing plan');
 assert.equal(String(m[0].propertyHash).toLowerCase(),expectedHash,'Existing capability hash mismatch');
 assert.deepEqual(result.recordsets[1],PARAMETERS,'Native parameter signature changed');return m[0];
}
function idle(rows){assert.equal(rows?.length,1,'Exactly one singleton required');const g=rows[0];assert.equal(g.ProtocolVersion,2);assert.equal(g.PendingCalc,false);for(const k of ['Mode','Action','OrderYear','OrderWeek','OwnerSessionID','OwnerToken','LockedAt','CalcProdKey'])assert.equal(g[k],null,'Gate must be fully idle: '+k);}
async function installInTransaction(tQ,types,{apply=false,drained=false}={}){
 assert(apply===true&&drained===true,'Apply and all-writers-drained acknowledgement required');
 await tQ('SET XACT_ABORT ON; SET LOCK_TIMEOUT 0;');
 const tx=(await tQ('SELECT @@TRANCOUNT n,XACT_STATE() state;')).recordset[0];assert.equal(tx.n,1);assert.equal(tx.state,1);
 idle((await tQ('SELECT * FROM dbo.NenovaStockWeekGate WITH(XLOCK,HOLDLOCK,NOWAIT) WHERE GateKey=1;')).recordset);
 const cap=(await tQ('EXEC dbo.usp_NenovaStockWeekGateCapability;')).recordset[0];assert.equal(Number(cap.ProtocolVersion),2);assert.equal(Number(cap.IsReady),1);
 const before=checkMetadata(await tQ(META),EXPECTED);const prepared=patch(before.definition);
 const alter=prepared.definition.replace('CREATE PROCEDURE [dbo].[usp_StockCalculation]','ALTER PROCEDURE [dbo].[usp_StockCalculation]');assert.notEqual(alter,prepared.definition);
 // Separate nested batch retains required module SET options. No parameter interpolation.
 await tQ('SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON; EXEC sys.sp_executesql @ddl;', {ddl:{type:types.NVarChar(types.MAX),value:alter}});
 await tQ(`DECLARE @hash varbinary(32)=HASHBYTES('SHA2_256',OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_StockCalculation',N'P')));
IF NOT EXISTS(SELECT 1 FROM sys.extended_properties WHERE class=1 AND major_id=OBJECT_ID(N'dbo.usp_StockCalculation',N'P') AND minor_id=0 AND name=N'NenovaStockGateOwnerV2Hash') THROW 51000,'Capability hash disappeared',1;
EXEC sys.sp_updateextendedproperty @name=N'NenovaStockGateOwnerV2Hash',@value=@hash,@level0type=N'SCHEMA',@level0name=N'dbo',@level1type=N'PROCEDURE',@level1name=N'usp_StockCalculation';`);
 const postMetadata=await tQ(META);
 const afterHash=hash(postMetadata.recordsets?.[0]?.[0]?.definition || '');
 // SQL Server 2016 retains CREATE in stored module text after ALTER; other
 // versions can retain ALTER. Accept only these two byte-exact definitions.
 assert([hash(alter),prepared.afterHash].includes(afterHash),'Stored module differs from exact prepared CREATE/ALTER definitions');
 checkMetadata(postMetadata,afterHash);
 const post=(await tQ('EXEC dbo.usp_NenovaStockWeekGateCapability;')).recordset[0];assert.equal(Number(post.ProtocolVersion),2);assert.equal(Number(post.IsReady),1);
 idle((await tQ('SELECT * FROM dbo.NenovaStockWeekGate WHERE GateKey=1;')).recordset);
 const final=(await tQ('SELECT @@TRANCOUNT n,XACT_STATE() state;')).recordset[0];assert.equal(final.n,1);assert.equal(final.state,1);
 return {beforeHash:EXPECTED,afterHash,businessHash:prepared.businessHash,capabilityReady:true};
}
async function main(){
 const args=process.argv.slice(2),apply=args.includes('--apply'),drained=args.includes('--all-writers-drained');
 assert(args.every(a=>['--apply','--all-writers-drained'].includes(a)),'Unknown argument');
 if(!apply){const defs=JSON.parse(fs.readFileSync('__tests__/fixtures/native-stock-gate-2026-10-12.json','utf8').replace(/^\uFEFF/,''));const p=patch(defs.find(r=>r.name==='usp_StockCalculation').definition);console.log(JSON.stringify({dryRun:true,productionApplied:false,beforeHash:p.beforeHash,businessHash:p.businessHash,requires:'--apply --all-writers-drained; main must actually drain every writer'}));return;}
 assert(drained,'All EXE/web/job writers must be drained; flag is acknowledgement, not proof');
 const {withTransaction,sql}=await import('../lib/db.js');let committed=false;
 try{const result=await withTransaction(tQ=>installInTransaction(tQ,sql,{apply,drained}),{retries:0});committed=true;console.log(JSON.stringify({committed,...result}));}
 catch(error){console.error(JSON.stringify({committed,error:error.message}));process.exitCode=1;}
 finally{await sql.close();}
}
module.exports={installInTransaction,checkMetadata,idle,META,PARAMETERS};
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
