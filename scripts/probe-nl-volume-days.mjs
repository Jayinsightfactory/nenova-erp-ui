import fs from 'fs';
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}
const { getPivotStats } = await import('../lib/pivotStats.js');
const { extractDays, pickDataDay } = await import('../lib/pivotVolumeCustDays.js');
const { includePivotVolumeRow } = await import('../lib/pivotVolumeRows.js');

const wk = process.argv[2] || '25-02';
const data = await getPivotStats({ weekStart: wk, weekEnd: wk, orderYear: '2025' });
const customers = data.customers || [];

const nlRows = (data.rows || []).filter(r => r.country === '네덜란드' && includePivotVolumeRow(r));
const flower = '네덜란드';

const active = customers
  .filter(customer => nlRows.some(row => Number(row.orders?.[customer.custName] || 0) > 0))
  .map(customer => {
    const days = extractDays(customer, flower);
    return {
      custName: customer.custName,
      orderCode: customer.orderCode,
      custDescr: customer.custDescr,
      day: pickDataDay(days),
      qty: nlRows.reduce((s, r) => s + Number(r.orders?.[customer.custName] || 0), 0),
    };
  })
  .sort((a, b) => a.custName.localeCompare(b.custName));

console.log(`=== ${wk} NL sheet customer day column (simulated) ===\n`);
for (const c of active) {
  console.log(`${c.day || '(empty)'.padEnd(7)} | ${c.custName} (${c.orderCode}) qty=${c.qty}`);
  if (!c.day && /네-/.test(c.custDescr)) {
    console.log(`  WARN: has 네- in descr but no day: ${c.custDescr}`);
  }
}
