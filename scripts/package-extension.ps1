param(
  [string]$OutputDirectory = "artifacts/release"
)

$ErrorActionPreference = "Stop"
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$releaseRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "artifacts/release"))
$outputPath = if ([System.IO.Path]::IsPathRooted($OutputDirectory)) {
  [System.IO.Path]::GetFullPath($OutputDirectory)
} else {
  [System.IO.Path]::GetFullPath((Join-Path $repoRoot $OutputDirectory))
}
$releasePrefix = $releaseRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) +
  [System.IO.Path]::DirectorySeparatorChar
if ($outputPath -ne $releaseRoot -and -not $outputPath.StartsWith($releasePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "OutputDirectory must stay within $releaseRoot"
}

Push-Location $repoRoot
try {
  & pnpm build
  if ($LASTEXITCODE -ne 0) { throw "pnpm build failed" }
  & pnpm release:check
  if ($LASTEXITCODE -ne 0) { throw "pnpm release:check failed" }

  $dist = Join-Path $repoRoot "apps/extension/dist"
  $manifest = Get-Content -Raw -Encoding utf8 (Join-Path $dist "manifest.json") | ConvertFrom-Json
  New-Item -ItemType Directory -Force -Path $outputPath | Out-Null
  $baseName = "visual-prompt-compiler-$($manifest.version)"
  $zipPath = Join-Path $outputPath "$baseName.zip"
  $hashPath = Join-Path $outputPath "$baseName.sha256"
  $filesPath = Join-Path $outputPath "$baseName.files.txt"

  foreach ($path in @($zipPath, $hashPath, $filesPath)) {
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
  }

  $sourceFiles = Get-ChildItem -LiteralPath $dist -Recurse -File |
    Sort-Object { $_.FullName.Substring($dist.Length + 1) }
  $inventory = foreach ($file in $sourceFiles) {
    $relativePath = $file.FullName.Substring($dist.Length + 1).Replace("\", "/")
    $fileHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $file.FullName).Hash.ToLowerInvariant()
    "$fileHash  $($file.Length)  $relativePath"
  }
  $inventory | Set-Content -Encoding utf8 -LiteralPath $filesPath

  Compress-Archive -Path (Join-Path $dist "*") -DestinationPath $zipPath -CompressionLevel Optimal
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
  try {
    $archiveFiles = @($archive.Entries |
      Where-Object { -not [string]::IsNullOrEmpty($_.Name) } |
      ForEach-Object { $_.FullName.Replace("\", "/") } |
      Sort-Object)
  } finally {
    $archive.Dispose()
  }
  $expectedFiles = @($sourceFiles |
    ForEach-Object { $_.FullName.Substring($dist.Length + 1).Replace("\", "/") } |
    Sort-Object)
  if (Compare-Object $expectedFiles $archiveFiles) {
    throw "Archive contents differ from the validated dist tree"
  }

  $zipHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath).Hash.ToLowerInvariant()
  "$zipHash  $([System.IO.Path]::GetFileName($zipPath))" |
    Set-Content -Encoding ascii -LiteralPath $hashPath
  Write-Output "Created $zipPath"
  Write-Output "SHA-256 $zipHash"
} finally {
  Pop-Location
}
