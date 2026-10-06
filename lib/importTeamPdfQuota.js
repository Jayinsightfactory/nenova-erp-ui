import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

// Atomic slot creation shares the hourly limit across workers on this server.
export async function reservePackingPdfRequest(userId, {root=path.join(process.cwd(),'data/runtime/import-team/pdf-quota'),now=Date.now(),limit=20}={}) {
  const hour=Math.floor(now/3600000);
  const dir=path.join(root,createHash('sha256').update(String(userId)).digest('hex'));
  await fs.mkdir(dir,{recursive:true});
  for(const name of await fs.readdir(dir)) {
    const match=/^(\d+)-(\d+)\.slot$/.exec(name);
    if(match&&Number(match[1])<hour-48)await fs.unlink(path.join(dir,name)).catch(()=>{});
  }
  for(let slot=0;slot<limit;slot++) {
    try{await fs.writeFile(path.join(dir,`${hour}-${slot}.slot`),'',{flag:'wx',mode:0o600});return;}
    catch(e){if(e.code!=='EEXIST')throw e;}
  }
  throw Object.assign(new Error('시간당 PDF 분석 한도(20회)에 도달했습니다. 다음 시간에 다시 시도하세요.'),{statusCode:429,retryAfter:Math.ceil(((hour+1)*3600000-now)/1000)});
}
