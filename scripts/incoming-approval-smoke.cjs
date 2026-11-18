// Keep browser coverage on the same maintained fixtures and current UI as the guides.
// Dry-run additionally injects one lost approval response and checks operationId reuse.
const path=require('node:path'),{spawnSync}=require('node:child_process');
const result=spawnSync(process.execPath,[path.join(__dirname,'record-incoming-approval-guides.cjs'),'--dry-run'],{cwd:path.resolve(__dirname,'..'),stdio:'inherit',windowsHide:true});
if(result.error)throw result.error;
process.exitCode=result.status??1;
