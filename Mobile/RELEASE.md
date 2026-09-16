# Release Android

A release usa R8/minificacao e nao usa `debug.keystore`. A assinatura fica fora do Git.

## Preparar assinatura

Crie ou use um keystore de producao fora do repositorio. Nao reutilize o keystore de debug e nao perca esse arquivo: ele sera necessario para atualizar o mesmo aplicativo.

No PowerShell, defina as variaveis apenas na sessao local:

```powershell
$env:RELEASE_STORE_FILE = 'C:\caminho\luxlab-release.jks'
$env:RELEASE_STORE_PASSWORD = 'senha-do-keystore'
$env:RELEASE_KEY_ALIAS = 'luxlab'
$env:RELEASE_KEY_PASSWORD = 'senha-da-chave'
```

Depois gere um APK pequeno para aparelhos ARM64:

```powershell
.\scripts\build-release.ps1
```

Para gerar um APK universal:

```powershell
.\scripts\build-release.ps1 -Architecture universal
```

O script executa `assembleRelease`, limita as arquiteturas conforme a opção, assina com `apksigner` e verifica a assinatura. As senhas nao sao gravadas nos arquivos do projeto.

## Publicar no GitHub

O Mobile possui um comando separado do Desktop. Ele cria uma release com a tag
`v<versao>-mobile` e envia `P2P-Mobile-<versao>-arm64.apk`:

```powershell
$env:GH_TOKEN = 'seu-token-com-Contents-Read-and-write'
$env:RELEASE_STORE_FILE = 'C:\caminho\luxlab-release.jks'
$env:RELEASE_STORE_PASSWORD = 'senha-do-keystore'
$env:RELEASE_KEY_ALIAS = 'luxlab'
$env:RELEASE_KEY_PASSWORD = 'senha-da-chave'
npm run release -- --draft
```

Remova `--draft` somente quando quiser publicar imediatamente. O comando recusa
`debug.keystore`, testa a assinatura antes do upload e preserva o rascunho se o
upload falhar.
