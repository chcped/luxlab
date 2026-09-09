# Atualizações do aplicativo Windows

O aplicativo instalado consulta as releases públicas de https://github.com/chcped/luxlab 15 segundos após abrir e a cada 4 horas. Baixa novas versões estáveis em segundo plano e mostra “Reiniciar para atualizar” quando o download termina. “Depois” oculta o aviso até a próxima abertura. Fechar normalmente não instala a atualização. Reiniciar pelo botão encerra a sala/captura, instala e abre o aplicativo novamente.

Em `npm run dev` o atualizador fica desativado. A versão web não usa esse mecanismo.

## Primeira distribuição

Execute `npm run dist` e instale o `.exe` gerado em `dist`. Usuários de versões anteriores sem o atualizador precisam instalar essa versão manualmente uma vez.

## Publicar uma atualização

1. Aumente a versão com `npm version patch --no-git-tag-version`.
2. Execute `npm run dist`.
3. Crie uma release em `chcped/luxlab` com a tag correspondente, por exemplo `v0.3.1`.
4. Anexe o instalador `.exe`, seu `.exe.blockmap` e `latest.yml` gerados juntos em `dist`.
5. Publique como release estável, sem marcar prerelease. Não publique enquanto os arquivos ainda estiverem sendo enviados.

Como alternativa, configure `GH_TOKEN` apenas no ambiente de publicação, com permissão para escrever nas releases desse repositório, e execute `npm run release`. Esse comando envia os arquivos para uma release em rascunho; revise e publique pelo GitHub. Nunca coloque tokens no código, no instalador ou no frontend. `npm run dist` não publica nada.

O repositório deve ter pelo menos um commit para criar a primeira tag/release. Pode conter apenas um README e os instaladores nas releases; não é necessário publicar o código.

## Validação completa

Instale a versão inicial, publique uma versão superior com os três arquivos, abra a versão antiga e aguarde o aviso. Confirme que “Depois” mantém a sessão, que fechar normalmente não instala e que “Reiniciar para atualizar” abre a nova versão. Essa validação exige duas versões empacotadas e uma release publicada; os testes automatizados verificam o controle do atualizador com eventos simulados.

Referência: https://www.electron.build/v26/docs/features/auto-update/
