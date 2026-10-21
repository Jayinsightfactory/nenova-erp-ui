param([Parameter(Mandatory=$true)][string]$Candidate, [Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
$candidatePath=(Resolve-Path -LiteralPath $Candidate).Path
if((Get-FileHash -LiteralPath $candidatePath -Algorithm SHA256).Hash -ne 'FEDEA619A6E54D6CDD58802E0707DD51D06F5D46E883F53F00134E801AC62F79'){throw 'Unexpected candidate'}
$outputPath=[IO.Path]::GetFullPath($OutputDirectory)
[IO.Directory]::CreateDirectory($outputPath) | Out-Null
$exe=Join-Path $outputPath 'Nenova-Pivot-Setup.exe'
if(Test-Path -LiteralPath $exe){throw 'Output already exists; choose a fresh output directory'}
$compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework/v4.0.30319/csc.exe'
& $compiler /nologo /target:winexe /platform:x86 /optimize+ "/out:$exe" "/win32manifest:$PSScriptRoot\native-pivot-setup\app.manifest" "/resource:$candidatePath,Nenova.Payload" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll "$PSScriptRoot\native-pivot-setup\Setup.cs"
if($LASTEXITCODE -ne 0){throw 'Installer compile failed'}
Get-FileHash -LiteralPath $exe -Algorithm SHA256
