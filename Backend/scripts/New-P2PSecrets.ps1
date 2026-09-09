[CmdletBinding()]
param(
    [ValidateSet('Env', 'RoomKey', 'All')]
    [string]$Mode = 'All',

    [string]$OutputPath = (Join-Path $PSScriptRoot '..\.env'),

    [switch]$Force
)

$ErrorActionPreference = 'Stop'

function New-SecureBase64UrlKey {
    param([ValidateRange(32, 128)][int]$ByteLength = 48)

    $bytes = [byte[]]::new($ByteLength)
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
    }
    finally {
        $rng.Dispose()
    }

    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Protect-SecretFile {
    param([string]$Path)

    if ($IsWindows -or $env:OS -eq 'Windows_NT') {
        & icacls.exe $Path /inheritance:r /grant:r "${env:USERNAME}:(R,W)" | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Warning 'Não foi possível restringir as permissões do arquivo automaticamente.'
        }
    }
}

if ($Mode -in @('Env', 'All')) {
    $fullPath = [System.IO.Path]::GetFullPath($OutputPath)
    if ((Test-Path -LiteralPath $fullPath) -and -not $Force) {
        throw "O arquivo '$fullPath' já existe. Use -Force somente se quiser substituir as chaves atuais."
    }

    $parent = Split-Path -Parent $fullPath
    if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }

    $jwtSecret = New-SecureBase64UrlKey -ByteLength 64
    $adminKey = New-SecureBase64UrlKey -ByteLength 48
    $content = @(
        'PORT=8080'
        'HOST=0.0.0.0'
        "JWT_SECRET=$jwtSecret"
        "ADMIN_API_KEY=$adminKey"
        'ALLOWED_ORIGINS=https://sua-activity.example.com,https://discord.com'
        'TOKEN_TTL_SECONDS=3600'
        'MAX_VIEWERS_PER_ROOM=20'
        'TRUST_PROXY=1'
    ) -join [Environment]::NewLine

    [System.IO.File]::WriteAllText($fullPath, $content + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
    Protect-SecretFile -Path $fullPath
    Write-Host "Arquivo .env criado com segurança em: $fullPath" -ForegroundColor Green
    Write-Host 'As chaves não foram exibidas no terminal.' -ForegroundColor DarkGray
}

if ($Mode -in @('RoomKey', 'All')) {
    $roomKey = New-SecureBase64UrlKey -ByteLength 32
    Set-Clipboard -Value $roomKey
    Write-Host 'Chave AES-256 da sala copiada para a área de transferência.' -ForegroundColor Cyan
    Write-Host 'Não envie essa chave ao servidor; use no fragmento #key=...' -ForegroundColor Yellow
}
