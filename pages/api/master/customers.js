import { withAuth } from '../../../lib/auth';
import { query, withTransaction, sql } from '../../../lib/db';
import { CUSTOMER_FIELDS, customerDraft, validateCustomerDraft } from '../../../lib/customerEditor';

const columns = CUSTOMER_FIELDS.map(([key]) => `[${key}]`).join(', ');
export default withAuth(async function handler(req, res) {
  if (req.method === 'GET') {
    const result = await query(`SELECT CustKey, ${columns} FROM Customer WHERE isDeleted=0 ORDER BY CustKey`);
    return res.status(200).json({ success: true, data: result.recordset });
  }
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: '지원하지 않는 요청입니다.' });
  try {
    const mode = req.body?.mode;
    if (!['create', 'update'].includes(mode)) throw new Error('신규 또는 수정 작업을 선택해 주세요.');
    const draft = validateCustomerDraft(req.body?.values);
    const key = Number(req.body?.custKey);
    if (mode === 'update' && (!Number.isSafeInteger(key) || key < 1 || !req.body?.original)) throw new Error('수정할 거래처를 다시 선택해 주세요.');
    if (mode === 'create' && req.body?.custKey) throw new Error('기존 거래처를 신규로 저장할 수 없습니다.');
    const params = { uid: { type: sql.NVarChar, value: req.user.userId } };
    CUSTOMER_FIELDS.forEach(([field]) => { params[field] = { type: field === 'BaseOutDay' ? sql.Int : sql.NVarChar, value: draft[field] }; });
    const saved = await withTransaction(async tx => {
      if (mode === 'update') {
        params.key = { type: sql.Int, value: key };
        const current = await tx(`SELECT CustKey, ${columns} FROM Customer WITH (UPDLOCK,HOLDLOCK) WHERE CustKey=@key AND isDeleted=0`, { key: params.key });
        if (!current.recordset.length) throw Object.assign(new Error('삭제되었거나 찾을 수 없는 거래처입니다.'), { status: 409 });
        const original = customerDraft(req.body.original);
        const latest = customerDraft(current.recordset[0]);
        const changed = CUSTOMER_FIELDS.filter(([field]) => String(original[field]) !== String(latest[field])).map(([, label]) => label);
        if (changed.length) throw Object.assign(new Error(`다른 작업에서 ${changed.join(', ')} 항목이 변경됐습니다. 입력값을 복사한 뒤 최신 거래처를 다시 불러와 주세요.`), { status: 409 });
        const result = await tx(`UPDATE Customer SET ${CUSTOMER_FIELDS.map(([field]) => `[${field}]=@${field}`).join(', ')}, LastUpdateID=@uid, LastUpdateDtm=GETDATE() OUTPUT INSERTED.CustKey WHERE CustKey=@key AND isDeleted=0`, params);
        return result.recordset[0].CustKey;
      }
      const result = await tx(`INSERT INTO Customer (${columns}, SearchComment, UseType, TransType, isDeleted, CreateID, CreateDtm, LastUpdateID, LastUpdateDtm) OUTPUT INSERTED.CustKey VALUES (${CUSTOMER_FIELDS.map(([field]) => `@${field}`).join(', ')}, N'', N'', N'', 0, @uid, GETDATE(), @uid, GETDATE())`, params);
      return result.recordset[0].CustKey;
    });
    return res.status(200).json({ success: true, custKey: saved, message: mode === 'update' ? '거래처 수정이 저장되었습니다.' : '신규 거래처가 등록되었습니다.' });
  } catch (error) {
    return res.status(error.status || 400).json({ success: false, error: error.message });
  }
});
