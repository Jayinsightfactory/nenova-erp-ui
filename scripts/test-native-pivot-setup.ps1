param([Parameter(Mandatory=$true)][string]$CandidateDirectory,[Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
$out=[IO.Path]::GetFullPath($OutputDirectory)
if(Test-Path -LiteralPath $out){throw 'Use a fresh test directory'}
[IO.Directory]::CreateDirectory($out) | Out-Null
$original=Join-Path $CandidateDirectory 'Nenova.original.exe'
$candidate=Join-Path $CandidateDirectory 'Nenova.exe'
$dll=Join-Path $out 'InstallerTests.dll'
& "$env:WINDIR/Microsoft.NET/Framework/v4.0.30319/csc.exe" /nologo /target:library "/out:$dll" "/resource:$candidate,Nenova.Payload" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll "$PSScriptRoot\native-pivot-setup\Setup.cs"
if($LASTEXITCODE -ne 0){throw 'Test compile failed'}
[Reflection.Assembly]::LoadFrom($dll) | Out-Null
$payload=[Installer]::Payload()
if([Installer]::Hash($payload) -ne [Installer]::Updated){throw 'Embedded payload mismatch'}
$target=Join-Path $out 'Nenova.exe'
[IO.File]::Copy($original,$target)
function Expect-Refusal([byte[]]$bytes,[Func[bool]]$running){
 $before=[Installer]::HashFile($target)
 $refused=$false
 try{[Installer]::Install($target,$bytes,$running) | Out-Null}catch{$refused=$true}
 if(!$refused -or [Installer]::HashFile($target) -ne $before){throw 'Refusal did not preserve target'}
}
Expect-Refusal $payload ([Func[bool]]{return $true})
Expect-Refusal ([byte[]]@(1,2,3)) ([Func[bool]]{return $false})
$script:checks=0
Expect-Refusal $payload ([Func[bool]]{$script:checks++; return $script:checks -gt 1})
if(@(Get-ChildItem -LiteralPath $out -Filter '*.pending-*').Count -ne 0){throw 'Stage leak'}
[IO.File]::WriteAllBytes($target,[byte[]]@(1,2,3))
Expect-Refusal $payload ([Func[bool]]{return $false})
[IO.File]::Copy($original,$target,$true)
$message=[Installer]::Install($target,$payload,[Func[bool]]{return $false})
if([Installer]::HashFile($target) -ne [Installer]::Updated){throw 'Install failed'}
$backups=@(Get-ChildItem -LiteralPath $out -Filter '*.bak')
if($backups.Count -ne 1 -or [Installer]::HashFile($backups[0].FullName) -ne [Installer]::Original){throw 'Backup mismatch'}
[Installer]::Install($target,$payload,[Func[bool]]{return $false}) | Out-Null
if(@(Get-ChildItem -LiteralPath $out -Filter '*.bak').Count -ne 1){throw 'Repeat install changed backup'}
'PASS: payload, running process, changed process before replace, corrupt payload, unsupported version, install, original backup, idempotence'
