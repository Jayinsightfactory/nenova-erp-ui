import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const required = [
  'docs/NENOVA_DNSPY_CLI_WORKFLOW.md',
  'docs/exe-golden/FormShipmentDistribution.md',
  'docs/exe-golden/FormRaumPnl.md',
  'docs/exe-golden/WeekdayConfirmationLifecycle.md',
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
const raumEvidence = fs.readFileSync(path.join(root, 'docs/exe-golden/FormRaumPnl.md'), 'utf8');
for (const marker of [
  'FormOrderAdd',
  'CheckExistingOrder',
  'GetDataProduct',
  'btnSave_Click',
  'OrderMaster',
  'OrderDetail',
  'ShipmentMaster',
  'ShipmentDetail',
  'ShipmentDate',
  'ShipmentFarm',
  'dnSpy.Console.exe',
  'read-only',
]) {
  if (!raumEvidence.includes(marker)) throw new Error(`Raum dnSpy evidence marker missing: ${marker}`);
}
const weekdayEvidence = fs.readFileSync(path.join(root, 'docs/exe-golden/WeekdayConfirmationLifecycle.md'), 'utf8');
for (const marker of ['FormShipmentDistribution.btnFixCancel_Click', 'FormEstimateView.btnSave_Click',
  'ClassShipmentDate.Insert', 'usp_ShipmentFixCancel', 'usp_StockCalculation',
  'StockHistory', '출고확정 취소', 'DetailFix=1', 'SELECT-only']) {
  if (!weekdayEvidence.includes(marker)) throw new Error(`Weekday confirmation dnSpy evidence marker missing: ${marker}`);
}
console.log('Nenova dnSpy evidence guard passed');
