#requires -Version 7.0
<#
Read-only installation audit. Does not execute the game or inspect saves.
HashContent hydrates every Content file on cloud-mounted drives; omit it for metadata only.
This inventory is not a room dependency manifest.
#>
param(
    [Parameter(Mandatory)][string]$Installation,
    [Parameter(Mandatory)][string]$Output,
    [switch]$HashContent
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $Installation).Path
$assemblyPath = @('orig/Celeste.exe','Celeste.dll','Celeste.exe') |
    ForEach-Object { Join-Path $root $_ } |
    Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
    Select-Object -First 1
if (!$assemblyPath) { throw 'No Celeste assembly found.' }
$stream = [IO.File]::OpenRead($assemblyPath)
try {
    $pe = [System.Reflection.PortableExecutable.PEReader]::new($stream)
    try {
        $metadata = [System.Reflection.Metadata.PEReaderExtensions]::GetMetadataReader($pe)
        $references = @($metadata.AssemblyReferences | ForEach-Object {
            $reference = $metadata.GetAssemblyReference($_)
            $metadata.GetString($reference.Name)
        } | Sort-Object)
    } finally { $pe.Dispose() }
} finally { $stream.Dispose() }
$framework = if ($references -contains 'FNA') { 'FNA' }
    elseif (@($references | Where-Object { $_ -like 'Microsoft.Xna.Framework*' }).Count) { 'XNA' }
    else { 'unknown' }
$content = Join-Path $root 'Content'
if (!(Test-Path -LiteralPath $content -PathType Container)) { throw 'Missing Content directory.' }
$files = @(Get-ChildItem -LiteralPath $content -File -Recurse | Sort-Object FullName | ForEach-Object {
    if ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked content requires a separate audit.' }
    $path = [IO.Path]::GetRelativePath($root,$_.FullName).Replace('\','/')
    $entry = [ordered]@{ path=$path; size=$_.Length }
    if ($HashContent) { $entry.sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
    [pscustomobject]$entry
})
$assemblyHash = (Get-FileHash -LiteralPath $assemblyPath -Algorithm SHA256).Hash.ToLowerInvariant()
$manifest = [ordered]@{
    schema=1
    kind='installation-inventory'
    framework=$framework
    supportedFramework=($framework -eq 'FNA')
    assembly=[ordered]@{
        path=[IO.Path]::GetRelativePath($root,$assemblyPath).Replace('\','/')
        sha256=$assemblyHash
        references=$references
    }
    contentHashCoverage=$(if ($HashContent) { 'complete' } else { 'none' })
    roomDependencyCoverage='not-observed'
    files=$files
    totalContentBytes=($files | Measure-Object -Property size -Sum).Sum
}
# A content fingerprint is valid only when every byte has been hashed.
if ($HashContent) {
    $identity = $assemblyHash + ($files | ConvertTo-Json -Depth 4 -Compress)
    $manifest.fingerprint = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($identity))).ToLowerInvariant()
}
$destination = [IO.Path]::GetFullPath($Output)
if ([IO.File]::Exists($destination)) { throw 'Output exists; choose a new report path to preserve prior evidence.' }
[IO.File]::WriteAllText($destination,($manifest | ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
$verified = Get-Content -LiteralPath $destination -Raw | ConvertFrom-Json
if ($verified.files.Count -ne $files.Count -or $verified.assembly.sha256 -ne $assemblyHash -or $verified.totalContentBytes -ne $manifest.totalContentBytes) { throw 'Report verification failed.' }
[pscustomobject]@{framework=$framework; files=$files.Count; bytes=$manifest.totalContentBytes; hashes=$manifest.contentHashCoverage; report=$destination}
if ($framework -ne 'FNA') { Write-Warning 'This port requires FNA. Do not interpret this inventory as a successful gameplay validation.' }
