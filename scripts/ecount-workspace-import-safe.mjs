import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import policy from '../lib/ecountWorkspacePolicy.cjs';

export function parseOptions(args) {
  const allowed=new Set(['file','dataset','menu-id','period-from','period-to','env-file']), options={};
  for(let i=0;i<args.length;i+=2){const key=args[i]?.slice(2),value=args[i+1];if(!args[i]?.startsWith('--')||!allowed.has(key)||!value||value.startsWith('--')||Object.hasOwn(options,key))throw Error('INVALID_ARGUMENTS');options[key]=value;}
  if(!['file','dataset','menu-id','env-file'].every(key=>options[key]))throw Error('REQUIRED_ARGUMENTS');
  return options;
}
export function prepareSafeInput(options,document) {
  const rows=policy.sanitizeRows(options.dataset,Array.isArray(document)?document:document?.rows);
  if(!rows.length)throw Error('EMPTY_IMPORT');
  return policy.prepareImport({dataset:options.dataset,menuId:options['menu-id'],periodFrom:options['period-from']||null,periodTo:options['period-to']||null,rows});
}
export function loadDatabaseEnvironment(text,environment=process.env) {
  for(const line of text.split(/\r?\n/)){const match=line.match(/^\s*(DB_[A-Z0-9_]+)\s*=\s*(.*)$/);if(match)environment[match[1]]=match[2].trim().replace(/^("|')|("|')$/g,'');}
}
export async function importSafe(input,store) {
  input=policy.prepareImport(input);
  if(!input.rows.length)throw Error('EMPTY_IMPORT');
  const user={userId:'nenovaSS3',authority:1,accountActive:true};
  if(!await store.activeAdmin(user))throw Error('ACTIVE_ADMIN_REQUIRED');
  if(!await store.installed())throw Error('WORKSPACE_NOT_INSTALLED');
  const scope={dataset:input.dataset,menuId:input.menuId};
  const before=await store.readWorkspace(scope);
  const body={...input,action:'import',reasonCode:'IMPORT'};
  const saved=await store.saveVersion({...body,expectedRevision:before.revision},user);
  function verify(current,result) {
    if(!current.version||current.revision!==result.revision||current.version.versionId?.toLowerCase()!==result.versionId?.toLowerCase())throw Error('READBACK_MISMATCH');
    if(policy.prepareImport({...scope,periodFrom:current.version.periodFrom,periodTo:current.version.periodTo,rows:current.version.rows}).hash!==input.hash)throw Error('READBACK_CONTENT_MISMATCH');
  }
  const after=await store.readWorkspace(scope);verify(after,saved);
  const duplicate=await store.saveVersion({...body,expectedRevision:after.revision},user);
  if(!duplicate.idempotent||duplicate.revision!==after.revision||duplicate.versionId?.toLowerCase()!==saved.versionId?.toLowerCase())throw Error('IDEMPOTENCY_MISMATCH');
  const final=await store.readWorkspace(scope);verify(final,duplicate);
  return {count:final.version.rows.length,revision:final.revision,readback:true,idempotent:true};
}
async function main() {
  let pool;
  try {
    const options=parseOptions(process.argv.slice(2));
    const file=path.resolve(options.file);
    if(fs.statSync(file).size>8*1024*1024)throw Error('INPUT_TOO_LARGE');
    // Sanitize before loading credentials, creating a SQL connection, or logging anything.
    const input=prepareSafeInput(options,JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')));
    loadDatabaseEnvironment(fs.readFileSync(path.resolve(options['env-file']),'utf8'));
    const {getPool}=await import('../lib/db.js');
    const store=await import('../lib/ecountWorkspaceStore.js');
    pool=await getPool();
    console.log(JSON.stringify(await importSafe(input,store)));
  } catch {console.error('SAFE_IMPORT_FAILED');process.exitCode=1;}
  finally {if(pool)try{await pool.close();}catch{console.error('SAFE_IMPORT_CONNECTION_CLOSE_FAILED');process.exitCode=1;}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
