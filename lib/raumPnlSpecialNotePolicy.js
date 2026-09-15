export const MAX_PNL_SPECIAL_NOTE_LENGTH = 5000;

export class RaumPnlSpecialNoteInputError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'RaumPnlSpecialNoteInputError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function normalizePnlSpecialNoteYear(value) {
  const year = String(value ?? '').trim();
  if (!/^\d{4}$/.test(year) || Number(year) < 2000 || Number(year) > 2099) {
    throw new RaumPnlSpecialNoteInputError('PNL_SPECIAL_NOTE_YEAR_INVALID', '특이사항 연도는 2000~2099 사이 네 자리로 입력하세요.');
  }
  return year;
}

export function normalizePnlSpecialNoteText(value) {
  const text = String(value ?? '').replace(/\r\n?/g, '\n');
  if (text.length > MAX_PNL_SPECIAL_NOTE_LENGTH) {
    throw new RaumPnlSpecialNoteInputError('PNL_SPECIAL_NOTE_TOO_LONG', `특이사항은 ${MAX_PNL_SPECIAL_NOTE_LENGTH.toLocaleString()}자 이하여야 합니다.`);
  }
  return text;
}
