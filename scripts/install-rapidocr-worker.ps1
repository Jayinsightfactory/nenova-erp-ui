param(
 [Parameter(Mandatory=$true)][string]$PythonPath,
 [string]$TaskName='Nenova-Free-OCR-Worker'
)
$ErrorActionPreference='Stop'
$python=(Resolve-Path -LiteralPath $PythonPath).Path
$worker=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'rapidocr-bridge-worker.py')).Path
if(Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue){throw 'Worker task already exists; inspect it before replacing.'}
# Existing ingest authentication is read by the worker at runtime, never stored in task arguments.
$action=New-ScheduledTaskAction -Execute $python -Argument ('"'+$worker+'"') -WorkingDirectory (Split-Path $PSScriptRoot -Parent)
$trigger=New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$principal=New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Free local OCR only; no ERP writes and no paid provider fallback.' | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Output 'Free OCR worker task installed and started.'
