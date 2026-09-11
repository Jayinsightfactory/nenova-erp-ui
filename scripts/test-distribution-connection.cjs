const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const dir=path.join(__dirname,'..','__tests__');
const files=fs.readdirSync(dir).filter(f=>/^distribution(?:Baseline|Change|Checklist|SalesInbox|Audit|ManualApplication|MessageApplicationStatus|LiveHistory|RequestBalance).*\.test\.js$/.test(f)||f==='pasteFourColumnLayout.test.js').sort();
if(files.length<8)throw new Error('Distribution connection tests are missing');
for(const file of files){
 const result=spawnSync(process.execPath,[path.join(dir,file)],{stdio:'inherit',windowsHide:true});
 if(result.status!==0)process.exit(result.status||1);
}
console.log(`distribution connection: ${files.length} test files passed`);
