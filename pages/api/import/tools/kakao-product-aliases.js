import { withAuth } from '../../../../lib/auth';
import { query as queryErpDb } from '../../../../lib/db';
import { handleKakaoProductAliasesRequest } from '../../../../lib/importKakaoDbProductAliasesApi';

export default withAuth(async (req, res) =>
  handleKakaoProductAliasesRequest(req, res, { queryFn: queryErpDb }),
);
