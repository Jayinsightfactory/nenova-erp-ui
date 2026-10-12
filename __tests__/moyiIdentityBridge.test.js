const fs = require('fs');
const path = require('path');

const helper = fs.readFileSync(path.join(__dirname, '..', 'lib', 'moyiIdentityBridge.js'), 'utf8');
const route = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'integrations', 'moyi', 'identity-token.js'), 'utf8');

function assert(ok, message) { if (!ok) throw new Error(message); }

assert(helper.includes("scope: MOYI_IDENTITY_SCOPE"), 'identity:link scope missing');
assert(helper.includes("expiresIn: '2m'"), 'exchange token must be short-lived');
assert(helper.includes('jwtid: crypto.randomUUID()'), 'unique jti missing');
assert(helper.includes('subject: userId'), 'UserInfo.UserID subject missing');
assert(helper.includes('tenant_id: tenantId') && helper.includes('workspace_id: workspaceId'), 'tenant/company binding missing');
assert(!helper.includes('password') && !helper.includes('nenovaToken'), 'password or Nenova JWT must not cross the boundary');
assert(route.includes('createMoyiIdentityExchangeToken(req.user)'), 'route must use authenticated Nenova identity');
console.log('moyiIdentityBridge contract: ok');
