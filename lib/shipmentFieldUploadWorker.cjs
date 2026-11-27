'use strict';
const { parentPort, workerData } = require('./workDriveChild.cjs').endpoint();
const fs = require('node:fs/promises'), path = require('node:path'), { pathToFileURL } = require('node:url');
const url = file => pathToFileURL(path.join(workerData.projectRoot, file)).href;
require('node:module').register(url('scripts/work-drive-esm-loader.mjs'));
(async () => {
  const [{ default: XLSX }, { parseAllocationWorkbook }, { createUploadedFieldWorkbook }] = await Promise.all([
    import('xlsx'), import(url('lib/shipmentImport.js')), import(url('lib/shipmentFieldUpload.js')),
  ]);
  parentPort.on('message', async ({ id, input }) => {
    try {
      const buffer = await fs.readFile(input.filepath);
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const parsed = parseAllocationWorkbook(XLSX, workbook);
      const output = await createUploadedFieldWorkbook(buffer, parsed.rows, {
        customerDirectory: input.customerDirectory, filename: input.filename,
        farmText: input.farmText, week: input.week, year: input.year,
        ...(input.productUnits ? { productUnits: input.productUnits } : {}),
      });
      parentPort.postMessage({ id, ok: true, output: Buffer.from(output) });
    } catch (error) {
      parentPort.postMessage({ id, ok: false, error: String(error.message || '물량표 생성 실패').slice(0, 1000), statusCode: error.statusCode });
    }
  });
})().catch(() => process.exit(1));
