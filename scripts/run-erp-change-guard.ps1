param(
  [string]$ChangedFrom = 'HEAD^'
)

$ErrorActionPreference = 'Stop'

npm run test:erp-contract
npm run test:erp-manifest -- --changed-from $ChangedFrom
npm run guard:erp-writes -- --changed-from $ChangedFrom
npm run build

Write-Host "Nenova ERP change guard passed. Deployment may proceed to the separately approved deployment step."
