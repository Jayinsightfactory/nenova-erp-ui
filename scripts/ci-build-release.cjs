const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const tar = args => execFileSync('tar', args, {encoding:'utf8', maxBuffer:32*1024*1024});
const generated = ['full-development-history.json','menu-development-history.json'];

function validateEntries(list, verbose) {
  for (const entry of list.trim().split('\n')) {
    if (!entry.startsWith('.next-build/') || entry.includes('\\') || entry.split('/').includes('..')) throw Error('Unsafe release path');
  }
  if (verbose.trim().split('\n').some(line => !/^[-d]/.test(line))) throw Error('Release links are not allowed');
}
function pack(root, archive, commit) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw Error('Invalid release commit');
  const build = path.join(root,'.next-build');
  const buildId = fs.readFileSync(path.join(build,'BUILD_ID'),'utf8').trim();
  if (!buildId || !fs.existsSync(path.join(build,'server'))) throw Error('Incomplete build');
  const data = path.join(build,'release-data');fs.mkdirSync(data,{recursive:true});
  for (const name of generated) fs.copyFileSync(path.join(root,'data/generated',name),path.join(data,name));
  fs.writeFileSync(path.join(build,'ci-release.json'),JSON.stringify({commit,buildId,nodeMajor:Number(process.versions.node.split('.')[0]),platform:process.platform,arch:process.arch,lockHash:hash(path.join(root,'package-lock.json'))}));
  tar(['--exclude=.next-build/cache','-czf',archive,'-C',root,'.next-build']);
  fs.writeFileSync(`${archive}.sha256`,hash(archive));
}
function stage(root, archive, commit, backupRoot) {
  root=fs.realpathSync(root);
  if (!/^[a-f0-9]{40}$/.test(commit)) throw Error('Invalid expected commit');
  if (hash(archive)!==fs.readFileSync(`${archive}.sha256`,'utf8').trim()) throw Error('Release checksum mismatch');
  validateEntries(tar(['-tzf',archive]),tar(['-tvzf',archive]));
  const staging=fs.mkdtempSync(path.join(root,'.ci-release-'));
  try {
    tar(['-xzf',archive,'-C',staging]);
    const build=path.join(staging,'.next-build');
    const manifest=JSON.parse(fs.readFileSync(path.join(build,'ci-release.json'),'utf8'));
    if(manifest.commit!==commit || manifest.lockHash!==hash(path.join(root,'package-lock.json'))) throw Error('Release source mismatch');
    if(Number(process.versions.node.split('.')[0])!==manifest.nodeMajor || process.platform!==manifest.platform || process.arch!==manifest.arch) throw Error('Release Node version mismatch');
    if(fs.readFileSync(path.join(build,'BUILD_ID'),'utf8').trim()!==manifest.buildId || !fs.existsSync(path.join(build,'server'))) throw Error('Incomplete release');
    for(const name of generated) JSON.parse(fs.readFileSync(path.join(build,'release-data',name),'utf8'));
    const backup=path.join(backupRoot,`ci-${Date.now()}-${process.pid}`);fs.mkdirSync(backup,{recursive:true,mode:0o700});
    for(const name of generated) {
      const destination=path.join(root,'data/generated',name);
      if(fs.existsSync(destination))fs.copyFileSync(destination,path.join(backup,name));
    }
    // Only the verified checkout's staging directory is replaced; live .next is untouched.
    const destination=path.join(root,'.next-build');
    if(path.dirname(destination)!==root)throw Error('Invalid staging destination');
    fs.rmSync(destination,{recursive:true,force:true});fs.renameSync(build,destination);
    for(const name of generated)fs.copyFileSync(path.join(destination,'release-data',name),path.join(root,'data/generated',name));
  } finally {fs.rmSync(staging,{recursive:true,force:true});}
}
if(require.main===module){
  const [mode,archive,commit]=process.argv.slice(2);
  if(mode==='pack')pack(process.cwd(),path.resolve(archive),commit);
  else if(mode==='stage')stage(process.cwd(),path.resolve(archive),commit,process.env.NENOVA_DEPLOY_BACKUP_ROOT||'/var/lib/nenova/deploy-backups');
  else throw Error('Expected pack or stage');
}
module.exports={pack,stage,validateEntries};
