import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const mode=args[0];
if(!['--check','--apply-schema','--import-latest'].includes(mode)) throw new Error('Use --check | --apply-schema | --import-latest --env-file <path>');
const envIndex=args.indexOf('--env-file');
if(envIndex<0 || !args[envIndex+1]) throw new Error('Explicit --env-file is required');
for(const line of fs.readFileSync(path.resolve(args[envIndex+1]),'utf8').split(/\r?\n/)){
 const m=line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if(m && m[1].startsWith('DB_')) process.env[m[1]]=m[2].trim().replace(/^("|')|("|')$/g,'');
}
let pool;
try{
 const {getPool}=await import('../lib/db.js');
 const store=await import('../lib/ecountWorkspaceStore.js');
 const {default:policy}=await import('../lib/ecountWorkspacePolicy.cjs');
 pool=await getPool();
 if(mode==='--apply-schema'){
  await pool.request().batch(fs.readFileSync(path.join(root,'docs/migrations/20261020_ecount_workspace.sql'),'utf8'));
  console.log(JSON.stringify({schema:'ecount_work',installed:await store.installed(),existingLedgerWrites:0}));
 }else if(mode==='--check'){
  console.log(JSON.stringify({schema:'ecount_work',installed:await store.installed()}));
 }else{
  const user={userId:'nenovaSS3',authority:1,accountActive:true};
  if(!await store.activeAdmin(user)) throw new Error('ACTIVE_ADMIN_REQUIRED');
  const menus=JSON.parse(fs.readFileSync(path.join(root,'data/ecount-workbench/source-menu.json'),'utf8')).menus;
  for(const [dataset,program]of Object.entries(policy.PROGRAMS)){
   const menu=menus.find(m=>m.program===program && m.id.startsWith('MENUTREE_'));
   const input={dataset,menuId:menu.id};
   const before=await store.readWorkspace(input);
   const result=await store.saveVersion({...input,action:'import-latest',reasonCode:'IMPORT',expectedRevision:before.revision},user);
   const after=await store.readWorkspace(input);
   if(after.version?.versionId?.toLowerCase()!==result.versionId?.toLowerCase()||after.revision!==result.revision)throw new Error('READBACK_MISMATCH');
   console.log(JSON.stringify({dataset,revision:after.revision,rows:after.version.rows.length,completeness:after.version.completeness,idempotent:result.idempotent,readback:true}));
  }
 }
}catch(error){if(mode==='--apply-schema' && error.number>0 && error.number<5000)console.error(JSON.stringify({sqlNumber:error.number,ddlError:error.message}));console.error(/^[A-Z_]+$/.test(error.message)?error.message:'WORKSPACE_SQL_OPERATION_FAILED');process.exitCode=1;}
finally{if(pool)await pool.close();}
