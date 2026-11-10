"""Read one hash-pinned original via SFTP only. No remote commands or writes."""
import os, re, json, hashlib, base64, posixpath, sys
from pathlib import Path
import paramiko

SHA = 'd892c13ac311aefbd0f58fcc8c6f2724aef60493256922087215a929ec34b0cf'
PIN = 'SHA256:d72Dy1zZ1mhVnygORQyBZ+debjsWAGgYX2rjDx2pYMo'
ROOT = '/var/www/nenova-erp/data/drive'
class PinnedHost(paramiko.MissingHostKeyPolicy):
    def missing_host_key(self, client, hostname, key):
        fp = 'SHA256:' + base64.b64encode(hashlib.sha256(key.asbytes()).digest()).decode().rstrip('=')
        if fp != PIN:
            raise RuntimeError('DEPLOY_HOST_KEY_MISMATCH')

config = Path('.github/workflows/deploy.yml').read_text()
def field(name):
    value = re.search(r'^\s+' + name + r':\s*([^\r\n]+)', config, re.M).group(1).strip()
    if not value or '${' in value:
        raise RuntimeError('STATIC_DEPLOY_TARGET_REQUIRED')
    return value.strip("'\"")

client = paramiko.SSHClient()
client.set_missing_host_key_policy(PinnedHost())
client.connect(field('host'), port=22, username=field('username'), password=os.environ['SSH_PASSWORD'],
               look_for_keys=False, allow_agent=False, timeout=30)
try:
    with client.open_sftp() as sftp:
        if '--matches-only' in sys.argv:
            key = 'packing.erp-matches'
            filename = hashlib.sha256(key.encode()).hexdigest() + '.json'
            with sftp.open('/var/www/nenova-erp/data/runtime/import-team/' + filename, 'rb') as f:
                f.prefetch()
                record = json.loads(f.read(8*1024*1024))
            if record.get('key') != key:
                raise RuntimeError('MATCH_RECORD_SCOPE')
            entries = [e for e in record.get('value',{}).get('entries',[]) if e.get('country') == 'CO']
            out = Path('.verify/co46-shared-matches'); out.mkdir(parents=True, exist_ok=True)
            (out/'matches.json').write_text(json.dumps({'version':1,'entries':entries}), encoding='utf8')
            print(json.dumps({'sharedCOEntries': len(entries), 'readOnly': True}))
            sys.exit(0)
        matches = [r.filename for r in sftp.listdir_attr(ROOT + '/46-1')
                   if r.filename.startswith(SHA[:8] + '_') and r.filename.lower().endswith('.pdf')]
        if not matches:
            raise RuntimeError('EXACT_ORIGINAL_NOT_FOUND')
        source = sftp.normalize(posixpath.join(ROOT, '46-1', sorted(matches)[0]))
        root = sftp.normalize(ROOT)
        if not source.startswith(root + '/') or sftp.stat(source).st_size > 20*1024*1024:
            raise RuntimeError('SOURCE_SCOPE_LIMIT')
        with sftp.open(source, 'rb') as f:
            f.prefetch()
            data = f.read()
        if not data.startswith(b'%PDF-') or hashlib.sha256(data).hexdigest() != SHA:
            raise RuntimeError('SOURCE_HASH_MISMATCH')
        out = Path('.verify/co46-live-ai'); out.mkdir(parents=True, exist_ok=True)
        (out/'source.pdf').write_bytes(data)
        print(json.dumps({'sourceHash': SHA, 'bytes': len(data), 'sftpReadOnly': True}))
finally:
    client.close()
