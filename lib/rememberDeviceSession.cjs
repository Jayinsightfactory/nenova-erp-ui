const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_AGE = 400 * 24 * 60 * 60;
const RENEW_MS = 24 * 60 * 60 * 1000;
const TOKEN = /^nd1\.[A-Za-z0-9_-]{43}$/;
const isDeviceToken = value => typeof value === 'string' && TOKEN.test(value);
function credentialProof(user, secret) {
  return crypto.createHmac('sha256', secret).update(JSON.stringify([String(user.UserID), String(user.Password)])).digest('hex');
}
function same(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}
function createStore({dir = path.join(process.cwd(), 'data/runtime/remember-device'), secret, now = Date.now} = {}) {
  if (!secret) throw new Error('Session secret required');
  const files = token => {
    if (!isDeviceToken(token)) return null;
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    return {record:path.join(dir, hash + '.json'), revoked:path.join(dir, hash + '.revoked')};
  };
  const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if(e.code === 'ENOENT') return null; throw e; } };
  const write = (file, value) => {
    fs.mkdirSync(dir, {recursive:true, mode:0o700});
    const tmp = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    try { fs.writeFileSync(tmp, JSON.stringify(value), {mode:0o600,flag:'wx'}); fs.renameSync(tmp,file); }
    finally { if(fs.existsSync(tmp))fs.unlinkSync(tmp); }
  };
  return {
    create(user) {
      if (!user?.UserID || user.isDeleted) throw new Error('Inactive account');
      const token = 'nd1.' + crypto.randomBytes(32).toString('base64url'), at = now();
      write(files(token).record, {userId:String(user.UserID),proof:credentialProof(user,secret),createdAt:at,renewedAt:at,expiresAt:at+MAX_AGE*1000});
      return token;
    },
    revoke(token) {
      const f = files(token); if(!f || !fs.existsSync(f.record))return;
      // A separate tombstone cannot be overwritten by an in-flight renewal.
      fs.writeFileSync(f.revoked, '', {mode:0o600});
    },
    async authenticate(token, readUser, {renew = true} = {}) {
      const f = files(token); if(!f || fs.existsSync(f.revoked))return null;
      const record = read(f.record), at = now();
      if(!record || !Number.isFinite(record.expiresAt) || record.expiresAt <= at || !record.userId)return null;
      const user = await readUser(record.userId);
      if(!user || user.isDeleted || String(user.UserID) !== record.userId || !same(record.proof,credentialProof(user,secret))) {
        fs.writeFileSync(f.revoked, '', {mode:0o600});
        return null;
      }
      if(fs.existsSync(f.revoked))return null;
      const renewed = renew && at - record.renewedAt >= RENEW_MS;
      if(renewed)write(f.record,{...record,renewedAt:at,expiresAt:at+MAX_AGE*1000});
      if(fs.existsSync(f.revoked))return null;
      return {user,renewed};
    },
  };
}
function sessionCookie(token, maxAge, production = process.env.NODE_ENV === 'production') {
  return `nenovaToken=${token}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Strict${production ? '; Secure' : ''}`;
}
module.exports = {MAX_AGE,RENEW_MS,isDeviceToken,createStore,sessionCookie};
