# [선택] 빠른조회 은행(농협·국민 등)용. 하나은행 기업뱅킹(HANA)은 사람 로그인 세션을 재사용하므로 불필요.
# 은행 빠른조회 자격증명 등록(사장님 PC 에서 직접 실행). 값은 화면에 출력하지 않고 DPAPI(CurrentUser)로 암호화해 저장만 한다.
# 저장 위치: %USERPROFILE%\.nenova\bank-credentials.dpapi  (같은 사용자·같은 PC 에서만 복호화 가능)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
function ConvertTo-Plain([System.Security.SecureString]$s) {
  $p = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($p) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }
}
$bank = (Read-Host 'bank code (NH/KB/WOORI/IBK)').Trim().ToUpper()
if (@('NH','KB','WOORI','IBK') -notcontains $bank) { throw 'unsupported bank code' }
$alias = (Read-Host 'alias (e.g. nh-main)').Trim()
$acct = ConvertTo-Plain (Read-Host 'account number (digits)' -AsSecureString)
$pw = ConvertTo-Plain (Read-Host 'account password' -AsSecureString)
$biz = ConvertTo-Plain (Read-Host 'business registration no (digits)' -AsSecureString)
$dir = Join-Path $env:USERPROFILE '.nenova'
$file = Join-Path $dir 'bank-credentials.dpapi'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$all = @{}
if (Test-Path -LiteralPath $file) {
  $b = [Convert]::FromBase64String((Get-Content -LiteralPath $file -Raw).Trim())
  $j = [Text.Encoding]::UTF8.GetString([System.Security.Cryptography.ProtectedData]::Unprotect($b, $null, 'CurrentUser'))
  ($j | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $all[$_.Name] = $_.Value }
}
$all[$alias] = @{ bank = $bank; accountNo = $acct; password = $pw; bizNo = $biz }
$bytes = [Text.Encoding]::UTF8.GetBytes(($all | ConvertTo-Json -Depth 4 -Compress))
$enc = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, 'CurrentUser')
Set-Content -LiteralPath $file -Value ([Convert]::ToBase64String($enc)) -Encoding ASCII
$d = ($acct -replace '\D','')
$mask = if ($d.Length -ge 8) { $d.Substring(0,3) + ('*' * ($d.Length - 7)) + $d.Substring($d.Length - 4) } else { '*' * $d.Length }
Write-Host "saved: $bank / $alias / $mask"
