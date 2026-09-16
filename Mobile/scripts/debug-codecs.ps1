$ErrorActionPreference = 'Stop'
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
$platform = Get-ChildItem (Join-Path $sdk 'platforms') -Directory | Sort-Object Name -Descending | Select-Object -First 1
$buildTools = Get-ChildItem (Join-Path $sdk 'build-tools') -Directory | Sort-Object Name -Descending | Select-Object -First 1
$output = Join-Path $PSScriptRoot '../android/build/codec-probe'
New-Item -ItemType Directory -Force -Path $output | Out-Null
& javac -source 8 -target 8 -classpath (Join-Path $platform.FullName 'android.jar') -d $output (Join-Path $PSScriptRoot 'CodecProbe.java')
if ($LASTEXITCODE) { throw 'javac failed' }
& (Join-Path $buildTools.FullName 'd8.bat') --lib (Join-Path $platform.FullName 'android.jar') --output $output (Join-Path $output 'CodecProbe.class')
if ($LASTEXITCODE) { throw 'd8 failed' }
& (Join-Path $sdk 'platform-tools/adb.exe') push (Join-Path $output 'classes.dex') /data/local/tmp/luxlab-codec-probe.dex
if ($LASTEXITCODE) { throw 'adb push failed' }
& (Join-Path $sdk 'platform-tools/adb.exe') shell 'CLASSPATH=/data/local/tmp/luxlab-codec-probe.dex app_process /system/bin CodecProbe'
if ($LASTEXITCODE) { throw 'Codec probe failed' }
