import { withAuth } from '../../../../../lib/auth';
import { query, withTransaction, sql } from '../../../../../lib/db';
import { receiptApiHandler } from '../../../../../lib/invoiceReceiptApi';
import { previewExistingReceiptLink, linkExistingReceipt } from '../../../../../lib/invoiceExistingReceipt';

export default withAuth(receiptApiHandler('POST', async req => {
  const common = { types: sql, documentId: req.query.id, revision: req.body?.revision };
  if (req.body?.mode === 'preview') {
    const { document, receiptSnapshot, lineMappings, ...preview } = await previewExistingReceiptLink({ ...common, queryFn: query });
    return { preview };
  }
  if (req.body?.mode !== 'link') throw Object.assign(new Error('기존 입고 대조 또는 연결을 선택하세요.'), { statusCode: 400 });
  return { result: await linkExistingReceipt({ ...common, withTransactionFn: withTransaction,
    baselineDigest: req.body?.baselineDigest, operationId: req.body?.operationId, actor: req.user.userId }) };
}));
