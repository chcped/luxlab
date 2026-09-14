# Atualizações do aplicativo Windows

Ao abrir o aplicativo instalado no Windows, uma tela com o logo busca atualizações. Se houver uma versão estável superior, mostra o download e “Aplicando atualização”, instala e reinicia automaticamente antes de abrir a sala. No primeiro reinício bem-sucedido, pula a busca; nas aberturas seguintes volta a verificar. Sem atualização ou com falha de rede, abre normalmente. A busca tem limite de 20 segundos e o download de 3 minutos; se exceder, o app abre e qualquer download posterior usa o aviso normal, sem reiniciar uma sessão ativa.

Durante o uso, verifica a cada 4 horas e oferece “Reiniciar para atualizar”. Na inicialização em segundo plano (`--background`), preserva o fluxo sem janela e sem instalação forçada.

Em `npm run dev` o atualizador fica desativado. A versão web não usa esse mecanismo.

## Primeira distribuição

Execute `npm run dist` e instale o `.exe` gerado em `dist`. Usuários de versões anteriores sem o atualizador precisam instalar essa versão manualmente uma vez.

## Publicar uma atualização

### Script automático (Windows)

No PowerShell, entre em `Frontend` e configure `GH_TOKEN` no ambiente com um token do GitHub que tenha acesso a `chcped/luxlab` e permissão **Contents: Read and write**. `GITHUB_TOKEN` também é aceito. Não salve o token no código ou em arquivos versionados.

```powershell
cd Frontend
npm run release -- --dry-run
npm run release
```

O comando padrão aumenta a versão patch (por exemplo, `0.3.0` para `0.3.1`), executa os testes do Frontend, gera o instalador e envia `.exe`, `.exe.blockmap` e `latest.yml` para um rascunho. A release só se torna pública depois de confirmar os três uploads. Requer as dependências instaladas (`npm ci`).

Outras opções:

```powershell
npm run release -- minor
npm run release -- major
npm run release -- current
npm run release -- patch --draft
```

`current` publica a versão atual sem aumentá-la, útil para a primeira distribuição ou para tentar novamente após uma falha no build. `--draft` mantém a release em rascunho para revisão manual. `--dry-run` apenas mostra o plano, sem testar credenciais, gerar arquivos ou publicar.

Uma release existente com a mesma tag, inclusive em rascunho, interrompe o script antes do build. Em caso de falha no upload, revise o rascunho no GitHub: complete os arquivos manualmente ou exclua o rascunho incompleto antes de repetir com `current`. Não publique arquivos de builds diferentes juntos.

O script altera `package.json` e `package-lock.json`, mas não faz commit nem push do código. Envie suas alterações de código antes de publicar; uma tag nova criada pelo GitHub aponta para a branch padrão remota. Depois, versione também os arquivos de versão alterados pelo script.

### Publicação manual

1. Aumente a versão com `npm version patch --no-git-tag-version`.
2. Execute `npm run dist`.
3. Crie uma release em `chcped/luxlab` com a tag correspondente, por exemplo `v0.3.1`.
4. Anexe o instalador `.exe`, seu `.exe.blockmap` e `latest.yml` gerados juntos em `dist`.
5. Publique como release estável, sem marcar prerelease. Não publique enquanto os arquivos ainda estiverem sendo enviados.

`npm run dist` não publica nada. Para automatizar o processo, use o script acima.

O repositório deve ter pelo menos um commit para criar a primeira tag/release. Pode conter apenas um README e os instaladores nas releases; não é necessário publicar o código.

## Validação completa

Instale a versão inicial, publique uma versão superior com os três arquivos, abra a versão antiga e aguarde o aviso. Confirme que “Depois” mantém a sessão, que fechar normalmente não instala e que “Reiniciar para atualizar” abre a nova versão. Essa validação exige duas versões empacotadas e uma release publicada; os testes automatizados verificam o controle do atualizador com eventos simulados.

Referência: https://www.electron.build/v26/docs/features/auto-update/
