param([Parameter(Mandatory=$true)][string]$CandidateDirectory,
      [string]$Target='C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe')
$ErrorActionPreference='Stop'
$originalHash='4033996D20006213BD7D7C5454396421FC18B3836CCB7F2C47B1CB8C93C1BD63'
$patchedHash='FEDEA619A6E54D6CDD58802E0707DD51D06F5D46E883F53F00134E801AC62F79'
$targetPath=(Resolve-Path -LiteralPath $Target).Path
$candidate=(Resolve-Path -LiteralPath (Join-Path $CandidateDirectory 'Nenova.exe')).Path
if((Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash -ne $patchedHash){throw 'Unexpected candidate'}
$current=(Get-FileHash -LiteralPath $targetPath -Algorithm SHA256).Hash
if($current -eq $patchedHash){Write-Output 'Already installed';exit 0}
if($current -ne $originalHash){throw 'Installed EXE changed; refusing to overwrite'}
if(@(Get-Process Nenova -ErrorAction SilentlyContinue | Where-Object {$_.Path -eq $targetPath}).Count -gt 0){
 throw 'Save work and close this PC Nenova.exe first. No process will be terminated.'
}
$backup=$targetPath+'.before-signed-pivot-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.bak'
$stage=$targetPath+'.signed-pivot.pending'
if((Test-Path -LiteralPath $backup) -or (Test-Path -LiteralPath $stage)){throw 'Backup or stage already exists'}
[IO.File]::Copy($candidate,$stage,$false)
if((Get-FileHash -LiteralPath $stage -Algorithm SHA256).Hash -ne $patchedHash){throw 'Stage hash mismatch'}
if((Get-FileHash -LiteralPath $targetPath -Algorithm SHA256).Hash -ne $originalHash){throw 'Target changed before replacement'}
# Atomic replacement on the same volume; original is retained by File.Replace.
[IO.File]::Replace($stage,$targetPath,$backup)
if((Get-FileHash -LiteralPath $targetPath -Algorithm SHA256).Hash -ne $patchedHash -or
   (Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash -ne $originalHash){throw 'Post-install hash mismatch'}
[pscustomobject]@{target=$targetPath;backup=$backup;installedHash=$patchedHash} | ConvertTo-Json
