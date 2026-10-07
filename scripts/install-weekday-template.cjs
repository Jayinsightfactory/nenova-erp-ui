const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const EXPECTED_SHA = '0D2BF7505BBDB792C43A116DF037BC125E4BE44F05D7519DDFE747EB7D8FDFB3';

function decryptTemplate(envelope, keyHex, expectedSha = EXPECTED_SHA) {
  if (!/^[a-f0-9]{64}$/i.test(keyHex || '') || envelope?.version !== 1
    || envelope.algorithm !== 'aes-256-gcm' || !/^[a-f0-9]{24}$/i.test(envelope.iv || '')
    || !/^[a-f0-9]{32}$/i.test(envelope.tag || '') || typeof envelope.data !== 'string'
    || envelope.data.length > 1024 * 1024) throw new Error('Invalid template configuration');
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), Buffer.from(envelope.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));
  const bytes = Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]);
  if (crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase() !== expectedSha) {
    throw new Error('Template integrity check failed');
  }
  return bytes;
}

function installTemplate(cwd = process.cwd(), key = process.env.WEEKDAY_TEMPLATE_KEY) {
  const envelope = JSON.parse(fs.readFileSync(path.join(cwd, 'data/templates/weekday/jugwang-order.encrypted.json'), 'utf8'));
  const bytes = decryptTemplate(envelope, key);
  const directory = path.join(cwd, 'data/runtime/weekday-template');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const destination = path.join(directory, 'jugwang-order.xlsx');
  if (fs.existsSync(destination) && fs.readFileSync(destination).equals(bytes)) {
    fs.chmodSync(destination, 0o600);
    return;
  }
  const temporary = path.join(directory, `jugwang-order.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, bytes, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, destination);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

if (require.main === module) {
  try { installTemplate(); console.log('Saved weekday template installed; integrity verified.'); }
  catch { console.error('Saved weekday template installation failed. Check the private deployment key.'); process.exitCode = 1; }
}
module.exports = { decryptTemplate, installTemplate, EXPECTED_SHA };
