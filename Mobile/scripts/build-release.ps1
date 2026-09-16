[CmdletBinding()]
param(
  [ValidateSet('arm64-v8a','universal')]
  [string]$Architecture = 'arm64-v8a'
)

$ErrorActionPreference = 'Stop'
$mobile = Split-Path -Parent $PSScriptRoot
$android = Join-Path $mobile 'android'
$gradle = Join-Path $android 'gradlew.bat'

$required = @('RELEASE_STORE_FILE', 'RELEASE_STORE_PASSWORD', 'RELEASE_KEY_ALIAS', 'RELEASE_KEY_PASSWORD')
foreach ($name in $required) {
  if ([string]::IsNullOrWhiteSpace((Get-Item "Env:$name" -ErrorAction SilentlyContinue).Value)) {
    throw "Defina a variavel $name somente na sessao local antes de gerar a release."
  }
}

$keystore = $env:RELEASE_STORE_FILE
if (-not [System.IO.Path]::IsPathRooted($keystore)) { $keystore = Join-Path $mobile $keystore }
if (-not (Test-Path $keystore -PathType Leaf)) { throw "Keystore nao encontrado: $keystore" }
$env:RELEASE_STORE_FILE = (Resolve-Path $keystore).Path

$architectures = if ($Architecture -eq 'universal') { 'armeabi-v7a,arm64-v8a,x86,x86_64' } else { $Architecture }
Push-Location $android
try {
  & $gradle assembleRelease "-PreactNativeArchitectures=$architectures" "-PRELEASE_STORE_FILE=$env:RELEASE_STORE_FILE" "-PRELEASE_STORE_PASSWORD=$env:RELEASE_STORE_PASSWORD" "-PRELEASE_KEY_ALIAS=$env:RELEASE_KEY_ALIAS" "-PRELEASE_KEY_PASSWORD=$env:RELEASE_KEY_PASSWORD"
  if ($LASTEXITCODE -ne 0) { throw "Gradle falhou com codigo $LASTEXITCODE." }
} finally { Pop-Location }

$apk = Get-ChildItem (Join-Path $android 'app\build\outputs\apk\release') -Filter '*.apk' | Select-Object -First 1
if (-not $apk) { throw 'APK de release nao encontrado.' }

$androidHome = $env:ANDROID_HOME
if ([string]::IsNullOrWhiteSpace($androidHome)) { $androidHome = $env:ANDROID_SDK_ROOT }
if ([string]::IsNullOrWhiteSpace($androidHome)) { throw 'Defina ANDROID_HOME ou ANDROID_SDK_ROOT.' }
$apksigner = Get-ChildItem (Join-Path $androidHome 'build-tools') -Recurse -Filter 'apksigner.bat' | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $apksigner) { throw 'apksigner nao encontrado no Android SDK.' }

& $apksigner.FullName sign --ks $keystore --ks-key-alias $env:RELEASE_KEY_ALIAS --ks-pass "pass:$env:RELEASE_STORE_PASSWORD" --key-pass "pass:$env:RELEASE_KEY_PASSWORD" --out $apk.FullName $apk.FullName
if ($LASTEXITCODE -ne 0) { throw "apksigner falhou com codigo $LASTEXITCODE." }
& $apksigner.FullName verify --verbose $apk.FullName
if ($LASTEXITCODE -ne 0) { throw "A verificacao da assinatura falhou com codigo $LASTEXITCODE." }
Write-Output "Release assinada: $($apk.FullName)"
