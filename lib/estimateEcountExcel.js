/**
 * nenova.exe FormEstimateView.GetExcelDetail → 이카운트 업로드용 xlsx
 */
import * as XLSX from 'xlsx';

/** exe grdViewExcel 컬럼 순서 (FieldName 있는 컬럼 + 빈 컬럼 자리) */
export const ECOUNT_UPLOAD_HEADERS = [
  '일자',
  '순번',
  '거래처코드',
  '거래처명',
  '담당자',
  '출하창고',
  '거래유형',
  '통화',
  '환율',
  '참조',
  '결제조건',
  '유효기간',
  '비고',
  '품목코드',
  '품목명',
  '수량',
  '단가(vat포함)',
  '단가(vat별도)',
  '외화금액',
  '공급가액',
  '부가세',
  '적요',
];

export function mapExcelDetailRowToEcount(row) {
  return {
    일자: row.EstDate || '',
    순번: row.ShipmentKey ?? '',
    거래처코드: row.CustCode ?? '',
    거래처명: row.CustName ?? '',
    담당자: row.Manager ?? '',
    출하창고: '',
    거래유형: row.EstType ?? '11',
    통화: '',
    환율: '',
    참조: '',
    결제조건: '',
    유효기간: '',
    비고: '',
    품목코드: row.ProdCode ?? '',
    품목명: row.ProdName ?? '',
    수량: Number(row.EstQuantity) || 0,
    '단가(vat포함)': Number(row.Cost) || 0,
    '단가(vat별도)': '',
    외화금액: '',
    공급가액: Number(row.Amount) || 0,
    부가세: Number(row.Vat) || 0,
    적요: row.Descr ?? '',
  };
}

export function buildEcountUploadSheet(rows) {
  const aoa = [ECOUNT_UPLOAD_HEADERS];
  for (const row of rows) {
    const mapped = mapExcelDetailRowToEcount(row);
    aoa.push(ECOUNT_UPLOAD_HEADERS.map((h) => mapped[h] ?? ''));
  }
  return XLSX.utils.aoa_to_sheet(aoa);
}

export function downloadEcountUploadWorkbook(rows, fileName) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildEcountUploadSheet(rows), '이카운트업로드');
  XLSX.writeFile(wb, fileName);
}
