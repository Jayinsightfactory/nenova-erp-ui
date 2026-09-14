import fs from 'node:fs';
if(!process.argv.includes('--apply')){console.log('Dry run: farm quality web tables only');process.exit(0);}
if(fs.existsSync('.env.local'))for(const line of fs.readFileSync('.env.local','utf8').split(/\r?\n/)){const m=line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);if(m&&process.env[m[1]]==null)process.env[m[1]]=m[2];}
for(const k of ['DB_SERVER','DB_NAME','DB_USER','DB_PASSWORD'])if(!process.env[k])throw new Error(`${k} required`);
const {getPool}=await import('../lib/db.js');const pool=await getPool();
try{
 await pool.request().batch(fs.readFileSync('docs/migrations/2026-09-14_farm_quality.sql','utf8'));
 const {loadQuality}=await import('../lib/farmQualityStore.js');
 const result=await loadQuality({year:new Date().getFullYear()});
 console.log(JSON.stringify({farmQualitySchema:'ready',readProbe:'passed',groups:result.groups.length,cases:result.cases.length}));
}finally{await pool.close();}
