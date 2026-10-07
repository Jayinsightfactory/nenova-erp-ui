import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseWeekdayEstimateBuffer } from './weekdayEstimateWorkbook.js';

export const WEEKDAY_TEMPLATE_CUSTOMER = 533;
export const WEEKDAY_TEMPLATE_FILE_NAME = '주광 발주(2026년38차) - 발주내역.xlsx';
export const WEEKDAY_TEMPLATE_SHA256 = '0D2BF7505BBDB792C43A116DF037BC125E4BE44F05D7519DDFE747EB7D8FDFB3';

// Private runtime asset: caller input never participates in the path.
export async function loadWeekdaySavedTemplate({ read = readFile, cwd = process.cwd(), expectedSha256 = WEEKDAY_TEMPLATE_SHA256 } = {}) {
  const bytes = await read(path.join(cwd, 'data', 'runtime', 'weekday-template', 'jugwang-order.xlsx'));
  const sha256 = createHash('sha256').update(bytes).digest('hex').toUpperCase();
  if (sha256 !== expectedSha256) throw new Error('저장된 주광 양식 확인이 필요합니다.');
  return {
    success: true,
    custKey: WEEKDAY_TEMPLATE_CUSTOMER,
    fileName: WEEKDAY_TEMPLATE_FILE_NAME,
    sha256,
    base64: bytes.toString('base64'),
    parsed: parseWeekdayEstimateBuffer(bytes, { fileName: WEEKDAY_TEMPLATE_FILE_NAME }),
  };
}

export async function serveWeekdaySavedTemplate(req, res, load = loadWeekdaySavedTemplate) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).end();
  }
  if (req.query?.custKey !== '533') {
    return res.status(400).json({ success: false, error: '주광 거래처를 선택하세요.' });
  }
  try {
    return res.status(200).json(await load());
  } catch {
    return res.status(503).json({ success: false, error: '저장된 주광 양식을 불러오지 못했습니다. 파일 업로드를 이용하세요.' });
  }
}
