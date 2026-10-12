import fs from 'node:fs';
import path from 'node:path';
import { buildProductMatchReviewQueue, pasteMappingToEvidence } from '../lib/productMatchingReviewQueue.js';

const outputDir = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('outputs');
fs.mkdirSync(outputDir, { recursive: true });
const mappings = JSON.parse(fs.readFileSync(path.resolve('data/order-mappings.json'), 'utf8'));
const queue = buildProductMatchReviewQueue(Object.entries(mappings).map(pasteMappingToEvidence));
const summary = queue.reduce((acc, row) => {
  acc.total += 1;
  acc.byStatus[row.status] = (acc.byStatus[row.status] || 0) + 1;
  acc.bySourceType[row.sourceType] = (acc.bySourceType[row.sourceType] || 0) + 1;
  for (const blocker of row.blockers) acc.byBlocker[blocker] = (acc.byBlocker[blocker] || 0) + 1;
  return acc;
}, { total: 0, byStatus: {}, bySourceType: {}, byBlocker: {} });

fs.writeFileSync(path.join(outputDir, 'paste-mapping-review-queue.json'), JSON.stringify({ generatedAt: new Date().toISOString(), summary, rows: queue }, null, 2));
console.log(JSON.stringify(summary, null, 2));
