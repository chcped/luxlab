# Luxlab Mobile

MVP React Native para entrar nas salas Luxlab, assistir tracks do Cloudflare
Realtime SFU e compartilhar a tela no Android usando a captura nativa exposta por
`react-native-webrtc`/MediaProjection.

```powershell
npm.cmd install
npm.cmd start
npm.cmd run android
```

O Android exige JDK 17 e Android Studio/SDK configurados. Informe na primeira tela
a origem HTTPS do backend (sem `/api`). O App ID e o App Secret da Cloudflare ficam
exclusivamente em `Backend/.env`; nunca crie variaveis mobile com esses valores.

## Estado das plataformas

- Android: fluxo inicial de captura nativa e publicacao/assinatura SFU implementado.
- iOS: o projeto nativo existe, mas compartilhar fora do app ainda exige adicionar
  uma ReplayKit Broadcast Upload Extension em um Mac com Xcode.
- Audio interno depende do sistema e do aplicativo capturado; conteudo protegido
  pode bloquear audio ou imagem.


## Metricas da transmissao Android

Com o app de desenvolvimento atualizado (`npm run android`), abra outro terminal na pasta `Mobile`:

```powershell
npm run debug:stream
```

Compartilhe a tela e entre na sala em outro aparelho para receber o video.
A cada aproximadamente 2 segundos, o terminal mostra uma linha por receptor e fluxo
 de video: kbps enviados, FPS codificado no intervalo, resolucao, RTT em ms,
perda acumulada reportada pelo receptor e motivo de limitacao do encoder.
`--` significa dado indisponivel ou primeira amostra. RTT e ida e volta da rede,
nao latencia de ponta a ponta do video. Perda acumulada nao e porcentagem.
Uma tela parada pode produzir FPS e bitrate baixos; teste tambem com movimento.
No Android, sem receptor conectado ou sem compartilhamento ativo, nao ha amostras. A coleta existe apenas em builds de desenvolvimento.

Para escolher entre varios dispositivos: `npm run debug:stream -- --serial SERIAL`.
Use `adb devices` para listar os seriais. Encerre o monitor com Ctrl+C.
O monitor nao limpa o Logcat nem encerra a transmissao. A coleta do app continua
ate parar de compartilhar ou sair da sala; nao registra tokens, SDP ou IPs.


### Coleta em segundo plano (Android)

A coleta Android agora roda nativamente junto ao WebRTC, independente dos timers JS
ou da Activity estar visivel. Mede apenas conexoes com uma track local de video;
nao mede o renderizador de quem assiste. O identificador `pc-N` representa a conexao
local com um receptor. O comando continua sendo `npm run debug:stream`.

**Depois desta alteracao nativa, execute `npm run android` para reinstalar o APK.**
Recarregar pelo Metro sozinho nao atualiza o coletor nativo. Abra uma sala,
compartilhe a tela inteira e entre em outro app: as linhas devem continuar.
A coleta requer uma conexao com receptor; FPS/kbps sao calculados no terminal
usando contadores e timestamps nativos. RTT e perda podem ficar indisponiveis
ate o receptor enviar seu relatorio. Ctrl+C para apenas o monitor.


O monitor tambem mostra `captura` (quadros da fonte por segundo), `encode`
(tempo medio de codificacao por quadro) e `fila` (tempo medio de espera de envio
por pacote), calculados por intervalo. `rota` informa o tipo de candidato local,
protocolo e transporte TURN quando disponiveis, sem exibir enderecos.
`encoder` identifica a implementacao de codificacao reportada pelo WebRTC.
Campos ausentes aparecem como `--`. Essas metricas nao medem o buffer de
reproducao do receptor nem substituem uma medicao de atraso de ponta a ponta.
