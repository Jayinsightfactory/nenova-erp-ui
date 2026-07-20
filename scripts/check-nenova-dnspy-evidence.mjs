import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const required = [
  'docs/NENOVA_DNSPY_CLI_WORKFLOW.md',
  'docs/exe-golden/FormShipmentDistribution.md',
];
for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`dnSpy evidence file missing: ${file}`);
}
const evidence = fs.readFileSync(path.join(root, 'docs/exe-golden/FormShipmentDistribution.md'), 'utf8');
for (const marker of [
  'FormShipmentDistribution',
  'GetCustomerList',
  'grdViewShipment_FocusedRowChanged',
  'btnSave_Click',
  'ShipmentFarm',
  'ShipmentDate',
  'dnSpy.Console.exe',
  '--no-color -t FormShipmentDistribution',
  'read-only',
]) {
  if (!evidence.includes(marker)) throw new Error(`dnSpy evidence marker missing: ${marker}`);
}
console.log('Nenova dnSpy evidence guard passed');
