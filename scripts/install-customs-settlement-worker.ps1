param([Parameter(Mandatory=$true)][string]$PythonPath,[string]$TaskName='Nenova-Customs-Settlement-OCR')
$ErrorActionPreference='Stop'
$python=(Resolve-Path -LiteralPath $PythonPath).Path
$pythonw=Join-Path (Split-Path $python -Parent) 'pythonw.exe'
if(!(Test-Path -LiteralPath $pythonw)){throw 'Use the existing OCR venv with pythonw.exe for a hidden dedicated worker.'}
$worker=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'customs-settlement-worker.py')).Path
if(Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue){throw 'Settlement worker task already exists; inspect it before replacing.'}
$action=New-ScheduledTaskAction -Execute $pythonw -Argument ('"'+$worker+'"') -WorkingDirectory (Split-Path $PSScriptRoot -Parent)
$trigger=New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$principal=New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -Hidden -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
# Existing packing OCR task and its files are intentionally untouched.
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Dedicated first-page Korean customs OCR. No paid API or ERP writes.' | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Output 'Dedicated settlement worker installed and started.'
