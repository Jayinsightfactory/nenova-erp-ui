param(
  [Parameter(Mandatory=$true)][string]$Source,
  [Parameter(Mandatory=$true)][string]$OutputDirectory,
  [Parameter(Mandatory=$true)][string]$DnlibPath
)
$ErrorActionPreference = 'Stop'
$expected = '4033996D20006213BD7D7C5454396421FC18B3836CCB7F2C47B1CB8C93C1BD63'
$sourcePath = (Resolve-Path -LiteralPath $Source).Path
if ((Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash -ne $expected) {
  throw 'Unsupported original EXE. Inspect this version before preparing a patch.'
}
if ((Get-AuthenticodeSignature -LiteralPath $sourcePath).Status -ne 'NotSigned') {
  throw 'Refuse to invalidate an executable signature.'
}
[void][Reflection.Assembly]::LoadFrom((Resolve-Path -LiteralPath $DnlibPath).Path)
$oldText = ' WHERE vo.OutQuantity > 0 '
$newText = ' WHERE vo.OutQuantity <>0 '
$module = [dnlib.DotNet.ModuleDefMD]::Load($sourcePath)
try {
  if ($module.IsStrongNameSigned -or !$module.IsILOnly) { throw 'Unsupported native module flags' }
  $references = @(foreach ($type in $module.GetTypes()) {
    foreach ($method in $type.Methods) {
      if ($method.HasBody) {
        foreach ($instruction in $method.Body.Instructions) {
          if ($instruction.OpCode.Code.ToString() -eq 'Ldstr' -and $instruction.Operand -eq $oldText) {
            $method.FullName
          }
        }
      }
    }
  })
  if ($references.Count -ne 1 -or $references[0] -ne 'System.Void Nenova.FormQuantityPivot::GetData()') {
    throw 'Predicate is shared or belongs to an unexpected method.'
  }
} finally { $module.Dispose() }
$bytes = [IO.File]::ReadAllBytes($sourcePath)
$oldBytes = [Text.Encoding]::Unicode.GetBytes($oldText)
$newBytes = [Text.Encoding]::Unicode.GetBytes($newText)
if ($oldBytes.Length -ne $newBytes.Length) { throw 'Metadata heap length must remain unchanged' }
$hex = [BitConverter]::ToString($bytes).Replace('-','')
$needle = [BitConverter]::ToString($oldBytes).Replace('-','')
$index = $hex.IndexOf($needle, [StringComparison]::Ordinal)
if ($index -lt 0 -or $index % 2 -ne 0 -or $hex.IndexOf($needle,$index+1,[StringComparison]::Ordinal) -ge 0) {
  throw 'Expected exactly one byte-aligned predicate in the original EXE.'
}
$offset = $index / 2
$patched = [byte[]]$bytes.Clone()
[Array]::Copy($newBytes,0,$patched,$offset,$newBytes.Length)
$differences = @(for ($i=0; $i -lt $bytes.Length; $i++) { if ($bytes[$i] -ne $patched[$i]) {$i} })
if ($differences.Count -ne 2) { throw 'Expected only two changed bytes' }
[void][IO.Directory]::CreateDirectory([IO.Path]::GetFullPath($OutputDirectory))
$outputRoot = (Resolve-Path -LiteralPath $OutputDirectory).Path
$candidate = Join-Path $outputRoot 'Nenova.exe'
$backup = Join-Path $outputRoot 'Nenova.original.exe'
if ($candidate -eq $sourcePath -or (Test-Path -LiteralPath $candidate) -or (Test-Path -LiteralPath $backup)) {
  throw 'Use a new output directory; never overwrite source or earlier evidence.'
}
[IO.File]::WriteAllBytes($backup,$bytes)
[IO.File]::WriteAllBytes($candidate,$patched)
$check = [dnlib.DotNet.ModuleDefMD]::Load($candidate)
try {
  $method = $check.Find('Nenova.FormQuantityPivot',$false).Methods | Where-Object Name -eq 'GetData'
  $newCount = @($method.Body.Instructions | Where-Object { $_.Operand -is [string] -and $_.Operand -eq $newText }).Count
  if ($newCount -ne 1) { throw 'Candidate metadata does not resolve the signed-order predicate' }
} finally { $check.Dispose() }
$result = [ordered]@{
  sourceHash=$expected
  candidateHash=(Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash
  length=$bytes.Length
  changedBytes=$differences
  method=$references[0]
  originalPredicate=$oldText
  patchedPredicate=$newText
}
$result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputRoot 'manifest.json') -Encoding UTF8
$result | ConvertTo-Json
