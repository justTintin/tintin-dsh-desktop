# download-binaries.ps1 - lite 包装后补齐媒体三件套(2026-11-16 用户裁决:最小包装后联网下载)。
# 清单与版本: yt-dlp=GitHub latest; ffmpeg/ffprobe=gyan.dev 6.0 essentials(与 1113 批一致)。
# 已在(尺寸>1MB)=跳过; 落点=脚本同级 resources/bin; 全部成功 exit 0, 任一失败 exit 1。
param()
$ErrorActionPreference = 'Stop'
$bin = Join-Path $PSScriptRoot 'resourcesin'
New-Item -ItemType Directory -Force -Path $bin | Out-Null

function Ensure-File($name, $url, $minSizeMB) {
  $target = Join-Path $bin $name
  if ((Test-Path $target) -and ((Get-Item $target).Length -gt $minSizeMB * 1MB)) {
    Write-Host "[skip] $name 已在"
    return $true
  }
  Write-Host "[get ] $name <- $url"
  $tmp = $target + '.download'
  try {
    Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing -TimeoutSec 600
    if ((Get-Item $tmp).Length -lt $minSizeMB * 1MB) { throw "尺寸过小" }
    if (Test-Path $target) { Remove-Item $target -Force }
    Move-Item $tmp $target -Force
    Write-Host "[ok  ] $name 已就位"
    return $true
  } catch {
    Write-Host "[fail] $name : $($_.Exception.Message)"
    if (Test-Path $tmp) { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
    return $false
  }
}

$ok = $true
$ok = (Ensure-File 'yt-dlp.exe'   'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' 5) -and $ok
  # openfilm 三件(lite 下载清单, 2026-11-16): node.exe + openfilm npm 包
  $ok = (Ensure-File 'node.exe' 'https://npmmirror.com/mirrors/node/v22.23.2/win-x64/node.exe' 60) -and $ok
  $openfilmTgz = Join-Path $env:TEMP 'openfilm-0.3.2.tgz'
  if (-not (Test-Path (Join-Path $PSScriptRoot 'resources/openfilm/node_modules/openfilm/package.json'))) {
    try {
      Write-Host '[get ] openfilm npm 包 <- npmmirror'
      Invoke-WebRequest -Uri 'https://registry.npmmirror.com/openfilm/-/openfilm-0.3.2.tgz' -OutFile $openfilmTgz -UseBasicParsing -TimeoutSec 600
      New-Item -ItemType Directory -Force -Path (Join-Path $PSScriptRoot 'resources/openfilm') | Out-Null
      tar -xzf $openfilmTgz -C (Join-Path $PSScriptRoot 'resources/openfilm')
      Write-Host '[ok  ] openfilm 包解包就位'
    } catch { Write-Host "[fail] openfilm 包: $(($_.Exception.Message))"; $ok = $false }
    finally { Remove-Item $openfilmTgz -Force -ErrorAction SilentlyContinue }
  }
$ok = (Ensure-File 'ffmpeg.exe'  'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' 60) -and $ok
$ok = (Ensure-File 'ffprobe.exe' 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' 150) -and $ok

# ffmpeg/ffprobe 同包 zip: 若二者之一刚下载,解包提取 exe
if (-not (Test-Path (Join-Path $bin 'ffmpeg.exe')) -or -not (Test-Path (Join-Path $bin 'ffprobe.exe'))) {
  $zip = Join-Path $env:TEMP 'tintin-ffmpeg-essentials.zip'
  try {
    Invoke-WebRequest -Uri 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' -OutFile $zip -UseBasicParsing -TimeoutSec 900
    Expand-Archive -Path $zip -DestinationPath $env:TEMP	intin-ffmpeg -Force
    $root = (Get-ChildItem $env:TEMP	intin-ffmpeg -Directory | Select-Object -First 1).FullName
    foreach ($name in 'ffmpeg.exe','ffprobe.exe') {
      Copy-Item (Join-Path $root (Join-Path 'bin' $name)) (Join-Path $bin $name) -Force
      Write-Host "[ok  ] $name 解包就位"
    }
  } catch {
    Write-Host "[fail] ffmpeg 解包: $($_.Exception.Message)"
    $ok = $false
  } finally {
    Remove-Item $zip -Force -ErrorAction SilentlyContinue
    Remove-Item $env:TEMP	intin-ffmpeg -Recurse -Force -ErrorAction SilentlyContinue
  }
}

if ($ok) { Write-Host '全部就位'; exit 0 } else { exit 1 }
