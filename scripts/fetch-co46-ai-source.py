"""Read one hash-pinned original via SFTP only. No remote commands or writes."""
import os, re, json, hashlib, base64, posixpath
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
        index_path = ROOT + '/index.jsonl'
        if sftp.stat(index_path).st_size > 100*1024*1024:
            raise RuntimeError('INDEX_SIZE_LIMIT')
        latest = {}
        with sftp.open(index_path, 'rb') as f:
            for line in f:
                row = json.loads(line)
                if row.get('id') and row.get('type') != 'download':
                    latest[row['id']] = row
        matches = [r for r in latest.values() if r.get('sha','').lower() == SHA
                   and not r.get('deleted') and not r.get('egressSnapshot')]
        if not matches:
            raise RuntimeError('EXACT_ORIGINAL_NOT_FOUND')
        row = sorted(matches, key=lambda r: str(r.get('id')))[0]
        source = sftp.normalize(posixpath.join(ROOT, row['rel']))
        root = sftp.normalize(ROOT)
        if not source.startswith(root + '/') or sftp.stat(source).st_size > 20*1024*1024:
            raise RuntimeError('SOURCE_SCOPE_LIMIT')
        with sftp.open(source, 'rb') as f:
            data = f.read()
        if not data.startswith(b'%PDF-') or hashlib.sha256(data).hexdigest() != SHA:
            raise RuntimeError('SOURCE_HASH_MISMATCH')
        out = Path('.verify/co46-live-ai'); out.mkdir(parents=True, exist_ok=True)
        (out/'source.pdf').write_bytes(data)
        print(json.dumps({'sourceHash': SHA, 'bytes': len(data), 'sftpReadOnly': True}))
finally:
    client.close()
