# download-binaries.ps1 - lite 包装后联网补齐(2026-11-16 用户裁决;2026-11-17 重写)。
# 由安装器 nsExec::ExecToLog 调用:本脚本每行 [get]/[ok]/[fail] 会实时出现在安装器
# 「显示详细信息」区——下载内容与结果可见。全部成功 exit 0,任一失败 exit 1。
# 落点(相对 $PSScriptRoot = <安装目录>\resources\):
#   bin\yt-dlp.exe / bin\ffmpeg.exe / bin\ffprobe.exe      媒体三件
#   openfilm\bin\node.exe + openfilm\node_modules\{openfilm,playwright-core}  OpenFilm 三件
# ⚠ 旧版此文件含转义损坏字节(\b→退格、\t→TAB)且 openfilm 解包布局错误——2026-11-17 重写。
param()
$ErrorActionPreference = 'Stop'
$res = $PSScriptRoot
$bin = Join-Path $res 'bin'
$ofDir = Join-Path $res 'openfilm'
$ofModules = Join-Path $ofDir 'node_modules'
$NODE_VERSION = 'v22.23.2'
$OPENFILM_VERSION = '0.3.2'
$PLAYWRIGHT_CORE_VERSION = '1.61.1'
$ok = $true

function Ensure-Exe($name, $urls, $minSizeMB, $destDir) {
  # $urls = 镜像数组,逐一尝试(2026-11-17 沙盒实证: 单源网络抖动即缺件;
  # node.exe 双镜像 nodejs.org/npmmirror,yt-dlp 单源 GitHub curl 重试)。
  $target = Join-Path $destDir $name
  if ((Test-Path $target) -and ((Get-Item $target).Length -gt $minSizeMB * 1MB)) {
    Write-Host "[skip] $name 已在"
    return $true
  }
  $tmp = $target + '.download'
  New-Item -ItemType Directory -Force -Path $destDir | Out-Null
  foreach ($url in @($urls)) {
    Write-Host "[get ] $name <- $url"
    try {
      & curl.exe -L --fail --retry 3 -sS -o $tmp $url
      if (-not (Test-Path $tmp) -or ((Get-Item $tmp).Length -lt $minSizeMB * 1MB)) { throw "下载尺寸过小/失败" }
      if (Test-Path $target) { Remove-Item $target -Force }
      Move-Item $tmp $target -Force
      Write-Host "[ok  ] $name 已就位"
      return $true
    } catch {
      Write-Host "[warn] $name 自 $url 失败: $($_.Exception.Message)"
      if (Test-Path $tmp) { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
    }
  }
  Write-Host "[fail] $name : 所有镜像均失败"
  return $false
}

function Get-NpmTgz($label, $url, $destDir) {
  Write-Host "[get ] $label <- $url"
  $tgz = Join-Path $env:TEMP ($label + '.tgz')
  try {
    New-Item -ItemType Directory -Force -Path $destDir | Out-Null
    Remove-Item (Join-Path $destDir '*') -Recurse -Force -ErrorAction SilentlyContinue
    & curl.exe -L --fail --retry 2 -sS -o $tgz $url
    if (-not (Test-Path $tgz) -or ((Get-Item $tgz).Length -lt 1024)) { throw "下载尺寸过小" }
    # 锁 System32 bsdtar(2026-11-17 沙盒实证: PATH 里 Git 的 GNU tar 把 C: 当远程主机)
    & "$env:SystemRoot\System32\tar.exe" -xzf $tgz -C $destDir --strip-components=1
    if (-not (Test-Path (Join-Path $destDir 'package.json'))) { throw "解包后缺 package.json" }
    Write-Host "[ok  ] $label 解包就位"
    return $true
  } catch {
    Write-Host "[fail] $label : $($_.Exception.Message)"
    return $false
  } finally {
    Remove-Item $tgz -Force -ErrorAction SilentlyContinue
  }
}

Write-Host "== 媒体组件(yt-dlp / ffmpeg / ffprobe) =="
# yt-dlp 版本感知更新(2026-11-17 用户裁决「附件包也要能更新」): GitHub latest 可达时
# 比对本地 --version,落后则删旧重下;API 不可达(阻断先例)则沿用现有,静默不报错。
$ytdlp = Join-Path $bin 'yt-dlp.exe'
if (Test-Path $ytdlp) {
  $latest = $null
  try { $latest = (Invoke-RestMethod -Uri 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest' -TimeoutSec 15 -UseBasicParsing).tag_name.TrimStart('v') } catch { }
  if ($latest) {
    $have = $null
    try { $have = (& $ytdlp --version 2>$null | Select-Object -First 1).Trim() } catch { }
    if ($have -and $have -ne $latest) {
      Write-Host "[upd ] yt-dlp $have -> $latest,更新中"
      Remove-Item $ytdlp -Force
    } elseif ($have) {
      Write-Host "[skip] yt-dlp $have 已是最新"
    }
  } else {
    Write-Host '[skip] yt-dlp 版本源不可达,沿用现有'
  }
}
$ok = (Ensure-Exe 'yt-dlp.exe' @('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe') 5 $bin) -and $ok

# ffmpeg/ffprobe: npmmirror ffmpeg-static b6.1.1 裸 exe 直链(2026-11-17: gyan.dev
# 90MB 合包在本机超时实证,换镜像源,两件各约 79MB 独立下载无需解包)
New-Item -ItemType Directory -Force -Path $bin | Out-Null
$ok = (Ensure-Exe 'ffmpeg.exe' 'https://registry.npmmirror.com/-/binary/ffmpeg-static/b6.1.1/ffmpeg-win32-x64' 60 $bin) -and $ok
$ok = (Ensure-Exe 'ffprobe.exe' 'https://registry.npmmirror.com/-/binary/ffmpeg-static/b6.1.1/ffprobe-win32-x64' 60 $bin) -and $ok

Write-Host "== OpenFilm 运行时(node / openfilm / playwright-core) =="
# node.exe 版本感知: 本地 --version 与钉版不符则重下
$nodeExe = Join-Path $ofDir 'bin\node.exe'
if (Test-Path $nodeExe) {
  $have = $null
  try { $have = (& $nodeExe --version 2>$null | Select-Object -First 1).Trim() } catch { }
  if ($have -and $have -ne $NODE_VERSION) {
    Write-Host "[upd ] node.exe $have -> $NODE_VERSION,更新中"
    Remove-Item $nodeExe -Force
  } elseif ($have) {
    Write-Host "[skip] node.exe $have 已匹配"
  }
}
$ok = (Ensure-Exe 'node.exe' @("https://npmmirror.com/mirrors/node/$NODE_VERSION/win-x64/node.exe", "https://nodejs.org/dist/$NODE_VERSION/win-x64/node.exe") 60 (Join-Path $ofDir 'bin')) -and $ok

# openfilm 包版本感知: package.json 与钉版不符则重取
$ofPkgDir = Join-Path $ofModules 'openfilm'
$ofPkgJson = Join-Path $ofPkgDir 'package.json'
if (Test-Path $ofPkgJson) {
  try {
    $v = (Get-Content $ofPkgJson -Raw | ConvertFrom-Json).version
    if ($v -ne $OPENFILM_VERSION) {
      Write-Host "[upd ] openfilm $v -> $OPENFILM_VERSION,重新获取"
      Remove-Item $ofPkgDir -Recurse -Force
    } else {
      Write-Host "[skip] openfilm $v 已匹配"
    }
  } catch { Write-Host '[skip] openfilm 版本读取失败,沿用现有' }
} else {
  Write-Host "[get ] openfilm 包(缺失)"
  $ok = (Get-NpmTgz "openfilm-$OPENFILM_VERSION" "https://registry.npmmirror.com/openfilm/-/openfilm-$OPENFILM_VERSION.tgz" $ofPkgDir) -and $ok
}

# playwright-core 版本感知: 同款
$pwDir = Join-Path $ofModules 'playwright-core'
$pwPkgJson = Join-Path $pwDir 'package.json'
if (Test-Path $pwPkgJson) {
  try {
    $v = (Get-Content $pwPkgJson -Raw | ConvertFrom-Json).version
    if ($v -ne $PLAYWRIGHT_CORE_VERSION) {
      Write-Host "[upd ] playwright-core $v -> $PLAYWRIGHT_CORE_VERSION,重新获取"
      Remove-Item $pwDir -Recurse -Force
    } else {
      Write-Host "[skip] playwright-core $v 已匹配"
    }
  } catch { Write-Host '[skip] playwright-core 版本读取失败,沿用现有' }
} else {
  Write-Host "[get ] playwright-core(缺失)"
  $ok = (Get-NpmTgz "playwright-core-$PLAYWRIGHT_CORE_VERSION" "https://registry.npmmirror.com/playwright-core/-/playwright-core-$PLAYWRIGHT_CORE_VERSION.tgz" $pwDir) -and $ok
}

Write-Host "== three.js 模块 + tintin provider + openfilm 垫片 =="
# three.js 0.184.0: npmmirror files API 直链(无需 npm),six files ~1.1MB
$threeDir = Join-Path $res 'openfilm-libs\three'
if ((Test-Path (Join-Path $threeDir 'VERSION')) -and (Test-Path (Join-Path $threeDir 'three.module.js'))) {
  Write-Host "[skip] three.js 已在"
} else {
  Write-Host "[get ] three.js 0.184.0 模块(6 files)"
  $threeFiles = @(
    @('build/three.module.js', 'three.module.js'),
    @('build/three.core.js', 'three.core.js'),
    @('examples/jsm/loaders/FontLoader.js', 'addons/loaders/FontLoader.js'),
    @('examples/jsm/loaders/TTFLoader.js', 'addons/loaders/TTFLoader.js'),
    @('examples/jsm/libs/opentype.module.js', 'addons/libs/opentype.module.js'),
    @('LICENSE', 'LICENSE')
  )
  try {
    foreach ($pair in $threeFiles) {
      $u = "https://registry.npmmirror.com/three/0.184.0/files/" + $pair[0]
      $d = Join-Path $threeDir $pair[1]
      New-Item -ItemType Directory -Force -Path (Split-Path $d -Parent) | Out-Null
      Invoke-WebRequest -Uri $u -OutFile $d -UseBasicParsing -TimeoutSec 300
    }
    Set-Content (Join-Path $threeDir 'VERSION') "0.184.0"
    Write-Host "[ok  ] three.js 模块就位"
  } catch {
    Write-Host "[fail] three.js : $($_.Exception.Message)"
    $ok = $false
  }
}

# tintin 一等 provider(包内 bundle 自带源文件 → 拷入 openfilm 树并注册)
$providerSrc = Join-Path $res 'app\node_modules\dsh-tintin-bundle\lib\openfilm\providers\tintin.mjs'
$provDir = Join-Path $ofModules 'openfilm\studio\server\providers'
if ((Test-Path $providerSrc) -and (Test-Path (Join-Path $provDir 'index.mjs'))) {
  Copy-Item $providerSrc (Join-Path $provDir 'tintin.mjs') -Force
  $idx = Get-Content (Join-Path $provDir 'index.mjs') -Raw
  if ($idx -notmatch "from './tintin\.mjs'") {
    $idx = $idx.Replace("import keenable from './keenable.mjs';", "import keenable from './keenable.mjs';`nimport tintin from './tintin.mjs';")
    $idx = $idx.Replace('keenable, openfilm, local]', 'keenable, openfilm, tintin, local]')
    Set-Content (Join-Path $provDir 'index.mjs') $idx -NoNewline
    Write-Host '[ok  ] tintin provider 已注册'
  } else {
    Write-Host '[skip] tintin provider 已注册'
  }
}

# openfilm.cmd 垫片(代理 shell 上裸 openfilm 命令;浏览器路径交给应用首跑下载)
$shim = Join-Path $bin 'openfilm.cmd'
Set-Content $shim @'
@echo off
setlocal
if "%PLAYWRIGHT_BROWSERS_PATH%"=="" if exist "%~dp0..\playwright-browsers" set "PLAYWRIGHT_BROWSERS_PATH=%~dp0..\playwright-browsers"
"%~dp0..\openfilm\bin\node.exe" "%~dp0..\openfilm\node_modules\openfilm\bin\openfilm.mjs" %*
'@ -Encoding Ascii
Write-Host '[ok  ] openfilm.cmd shim 已写'

if ($ok) { Write-Host '全部就位'; exit 0 }
Write-Host '部分组件下载失败——重启 TinTin 后媒体工具会自动重试;也可手动重新运行本脚本'
exit 1
