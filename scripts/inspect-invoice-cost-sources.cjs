// Read-only source inspection. Credentials supplied through environment only.
const XLSX = require('xlsx');
const crypto = require('node:crypto');
(async () => {
  const base = 'https://nenovaweb.com';
  const login = await fetch(base + '/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({userId:process.env.SMOKE_USER,password:process.env.SMOKE_PASS}) });
  const auth = await login.json();
  if (!auth.token) throw new Error('Login failed');
  const headers = {Authorization:`Bearer ${auth.token}`};
  for (const id of process.argv.slice(2)) {
    const response = await fetch(base+'/api/work/drive?download='+encodeURIComponent(id),{headers});
    if (!response.ok) throw new Error('Source download failed '+response.status);
    const buffer=Buffer.from(await response.arrayBuffer());
    const wb=XLSX.read(buffer,{type:'buffer',cellFormula:true});
    console.log(JSON.stringify({id,sha256:crypto.createHash('sha256').update(buffer).digest('hex'),sheets:wb.SheetNames}));
    const selected = wb.SheetNames.filter(n=>/40|34|41/.test(n)).slice(-2);
    for (const name of selected.length?selected:wb.SheetNames.slice(0,1)) {
      const cells=Object.entries(wb.Sheets[name]).filter(([addr])=>!addr.startsWith('!'));
      const labels=cells.filter(([,c])=>typeof c.v==='string'&&/FOB|CNF|원가|환율|GW|CW|운송|통관|단가|CNY|RMB|USD|수량/i.test(c.v)).slice(0,45).map(([address,c])=>({address,value:c.v}));
      const formulas=cells.filter(([,c])=>c.f).slice(0,24).map(([address,c])=>({address,formula:c.f,value:c.v??null}));
      console.log(JSON.stringify({sheet:name,labels,formulas}));
    }
  }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
