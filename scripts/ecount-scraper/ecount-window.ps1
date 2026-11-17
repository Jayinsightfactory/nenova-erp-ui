# ECOUNT 수집 창 숨김/표시. 사용: powershell -File ecount-window.ps1 hide|show|watch [-ParentPid N] [-Control 경로]
# 수집 전용 프로필(ecount-profile)로 뜬 크롬 창만 대상이다. 사장님 개인 크롬·조사용 프로필(ecount-profile-survey)은 건드리지 않는다.
# hide = 화면·작업표시줄에서 숨김(프로세스·로그인 세션 유지), show = 로그인할 수 있게 다시 표시.
# watch = 상주 감시: 0.7초마다 새로 뜬 수집 창(팝업 포함)을 숨긴다. -Control 파일 내용이 show 인 동안만 창을 보이게 둔다(로그인 대기). 부모(-ParentPid)가 끝나면 스스로 종료.
param([Parameter(Mandatory=$true)][ValidateSet('hide','show','watch')][string]$mode, [int]$ParentPid = 0, [string]$Control = '')
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class EcWin {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  public static int Apply(HashSet<uint> pids, bool hide) {
    int n = 0;
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (!pids.Contains(pid)) return true;
      if (hide) { if (IsWindowVisible(h) && GetWindowTextLength(h) > 0) { ShowWindow(h, 0); n++; } }
      else { if (GetWindowTextLength(h) > 0) { ShowWindow(h, 9); SetForegroundWindow(h); n++; } }
      return true;
    }, IntPtr.Zero);
    return n;
  }
}
'@
function Get-CollectorPids {
  $set = New-Object 'System.Collections.Generic.HashSet[uint32]'
  Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -match 'ecount-profile(?!-)' -and $_.CommandLine -notmatch '--type=' } | ForEach-Object { [void]$set.Add([uint32]$_.ProcessId) }
  return ,$set
}
if ($mode -ne 'watch') {
  $pids = Get-CollectorPids
  if ($pids.Count -eq 0) { Write-Output 'no-window'; exit 0 }
  Write-Output ("{0}:{1}" -f $mode, [EcWin]::Apply($pids, ($mode -eq 'hide')))
  exit 0
}
$pids = Get-CollectorPids; $tick = 0; $lastWant = ''
while ($true) {
  if ($ParentPid -gt 0 -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { break }
  if (($tick % 14) -eq 0 -or $pids.Count -eq 0) { $pids = Get-CollectorPids }  # 약 10초마다 크롬 프로세스 목록 갱신
  $want = 'hide'
  if ($Control -and (Test-Path -LiteralPath $Control)) { try { $want = (Get-Content -LiteralPath $Control -Raw).Trim() } catch {} }
  if ($pids.Count -gt 0) {
    if ($want -eq 'show') { if ($lastWant -ne 'show') { [void][EcWin]::Apply($pids, $false) } }
    else { [void][EcWin]::Apply($pids, $true) }
    $lastWant = $want   # 크롬이 아직 없을 때는 갱신하지 않아, 뜨는 즉시 표시/숨김이 적용된다
  }
  $tick++
  Start-Sleep -Milliseconds 700
}
