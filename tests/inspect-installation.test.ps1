#requires -Version 7.0
$ErrorActionPreference='Stop'
$temporaryRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$fixture=Join-Path $temporaryRoot ('celeste-inspector-'+[guid]::NewGuid())
$inspect=Join-Path $PSScriptRoot '../scripts/inspect-installation.ps1'
try {
    New-Item -ItemType Directory -Path (Join-Path $fixture 'Content'),(Join-Path $fixture 'Saves') -Force | Out-Null
    Copy-Item -LiteralPath ([object].Assembly.Location) -Destination (Join-Path $fixture 'Celeste.dll')
    [IO.File]::WriteAllBytes((Join-Path $fixture 'Content/a.bin'),[byte[]](1,2,3))
    [IO.File]::WriteAllBytes((Join-Path $fixture 'Content/b.bin'),[byte[]](4,5))
    [IO.File]::WriteAllText((Join-Path $fixture 'Saves/private.txt'),'must not appear')
    $first=Join-Path $fixture 'first.json'
    & $inspect -Installation $fixture -Output $first -HashContent | Out-Null
    $a=Get-Content -LiteralPath $first -Raw | ConvertFrom-Json
    if($a.files.Count -ne 2 -or $a.totalContentBytes -ne 5) {throw 'Incorrect inventory size'}
    if($a.supportedFramework -or $a.framework -ne 'unknown') {throw 'Unknown assembly accepted as FNA'}
    if($a.contentHashCoverage -ne 'complete' -or $a.fingerprint.Length -ne 64) {throw 'Missing verified fingerprint'}
    if(@($a.files | Where-Object {$_.path -like 'Saves/*'}).Count) {throw 'Save data included'}
    $rejected=$false
    try { & $inspect -Installation $fixture -Output $first | Out-Null } catch { $rejected=$_.Exception.Message -like 'Output exists*' }
    if(!$rejected) {throw 'Existing evidence overwritten'}
    [IO.File]::WriteAllBytes((Join-Path $fixture 'Content/a.bin'),[byte[]](3,2,1))
    $second=Join-Path $fixture 'second.json'
    & $inspect -Installation $fixture -Output $second -HashContent | Out-Null
    $b=Get-Content -LiteralPath $second -Raw | ConvertFrom-Json
    if($a.fingerprint -eq $b.fingerprint) {throw 'Changed bytes did not invalidate fingerprint'}
    $third=Join-Path $fixture 'metadata.json'
    & $inspect -Installation $fixture -Output $third | Out-Null
    $c=Get-Content -LiteralPath $third -Raw | ConvertFrom-Json
    if($c.fingerprint -or $c.contentHashCoverage -ne 'none') {throw 'Metadata-only report claims content integrity'}
    Write-Output 'Installation inspector: size, privacy, unknown-framework rejection, fingerprint invalidation, metadata coverage and report preservation passed.'
} finally {
    $resolved=[IO.Path]::GetFullPath($fixture)
    if(!$resolved.StartsWith((Join-Path $temporaryRoot 'celeste-inspector-'),[StringComparison]::OrdinalIgnoreCase)) {throw 'Unsafe cleanup target'}
    if(Test-Path -LiteralPath $resolved) {Remove-Item -LiteralPath $resolved -Recurse -Force}
}
