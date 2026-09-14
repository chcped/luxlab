# Áudio do compartilhamento

No Windows, escolha a tela/janela e, separadamente, o aplicativo cujo áudio será
transmitido. Inicie a reprodução e use **Atualizar aplicativos** se ele não aparecer.
Não selecione Discord, WhatsApp ou o aplicativo da chamada como fonte de áudio.
O áudio geral do sistema não é mais usado, nem como fallback em caso de falha.
O microfone não é solicitado.

A captura inclui o processo selecionado e seus filhos. Uma call no mesmo navegador
do vídeo pode entrar no áudio desse navegador. Use outro navegador ou um player
separado nesse caso. A seleção não identifica nem remove vozes de um áudio já misturado.

No site, somente áudio de aba é aceito. Compartilhar tela inteira ou janela transmite
apenas vídeo. Navegadores sem suporte à identificação da aba ficam sem áudio.

Requer Windows build 20348 ou superior para áudio por processo. Em versões anteriores
ou quando o módulo nativo estiver indisponível, desmarque a opção de áudio.
É necessário recompilar e instalar o aplicativo Windows para receber a mudança.

## Desenvolvimento e verificação

O módulo N-API `process-audio-capture@1.0.14` usa WASAPI process loopback em modo
de inclusão. A instalação requer ferramentas C++ do Visual Studio e Windows SDK.
`npm ci` compila o módulo; `npm run dist` também prepara as dependências nativas para
o Electron. O binário nativo deve ficar fora do ASAR (electron-builder detecta `.node`).

- `npm test`: autorização IPC, seleção e encerramento, além dos testes existentes.
- `node scripts/test-process-audio.cjs`: Windows, gera dois tons baixos em processos
  de teste separados e verifica pelo menos 20 dB de exclusão da fonte não selecionada.
- Teste manual: transmita um jogo/player enquanto uma call externa está ativa;
  confirme em outro cliente que somente o jogo/player é ouvido. Repita minimizado,
  ao parar, sair da sala e iniciar outra transmissão.

Referências:
- https://github.com/lvxiaohai/process-audio-capture
- https://github.com/microsoft/Windows-classic-samples/tree/main/Samples/ApplicationLoopback
