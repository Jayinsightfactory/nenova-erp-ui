// DPAPI(CurrentUser) 로 암호화된 %USERPROFILE%\.nenova\bank-credentials.dpapi 를 PowerShell 로 복호화. 값은 메모리에서만 쓰고 절대 로그에 남기지 않는다.
// 파일 내용(복호화 후 JSON): { "<alias>": { bank, accountNo, password, bizNo } }
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const CREDENTIAL_FILE = path.join(os.homedir(), '.nenova', 'bank-credentials.dpapi');

export const DECRYPT_PS = [
  '$ErrorActionPreference="Stop"',
  'Add-Type -AssemblyName System.Security',
  '$b=[Convert]::FromBase64String((Get-Content -LiteralPath $env:BANKQ_FILE -Raw).Trim())',
  '$p=[System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '[Console]::Out.Write([Convert]::ToBase64String($p))',
].join(';');

export function loadAllCredentials(file = CREDENTIAL_FILE) {
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', DECRYPT_PS], { encoding: 'utf8', env: { ...process.env, BANKQ_FILE: file } });
  // stderr/stdout 는 값 노출 가능성이 있어 에러 메시지에 포함하지 않는다.
  if (r.status !== 0) throw new Error('자격증명 복호화 실패(파일 없음 또는 다른 사용자/PC). register-account.ps1 로 먼저 등록하세요.');
  return JSON.parse(Buffer.from(r.stdout.trim(), 'base64').toString('utf8'));
}

export function getCredential(alias, file) {
  const c = loadAllCredentials(file)[alias];
  if (!c) throw new Error(`등록되지 않은 별칭: ${alias}`);
  return c;
}
