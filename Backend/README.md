# Luxlab — backend de salas

Express e WebSocket para salas independentes do Discord. Serve a mesma interface usada no Electron e faz a sinalização WebRTC, presença e chat. Mídia trafega entre os participantes ou via TURN; não há FFmpeg/HLS no serviço ativo.

```powershell
npm.cmd ci
npm.cmd start
npm.cmd test
```

Configure `.env` a partir de `.env.example`, preservando seus segredos existentes. Para Docker, execute `docker compose up -d --build` na pasta `Backend`. O contexto de build inclui `Frontend/src`.

Consulte o [README principal](../README.md) para variáveis, API, limites, configuração TURN e integração do seu login. `src/live.js`, `src/rooms.js` e `src/auth.js` são módulos legados preservados; `src/server.js` carrega `src/standalone.js`.

## Contas e salas permanentes

O backend inclui login por código de e-mail e salas salvas com membros autorizados.
Consulte [ACCOUNTS.md](ACCOUNTS.md) para configurar SMTP, o volume persistente SQLite,
as rotas da API e a atualização no servidor. Requer Node.js 22.16 ou superior.
O front de login e gestão dessas salas ainda precisa ser implementado.

## Logs e estabilidade WebRTC

Na pasta `Backend`, `docker compose up -d --build` inicia backend e TURN no mesmo projeto.
Acompanhe ambos com `docker compose logs -f --tail=100 --timestamps`; filtre com
`docker compose logs -f backend` ou `docker compose logs -f turn`.
Os logs giram em cinco arquivos de até 20 MB por serviço.

`ICE_TRANSPORT_POLICY=relay` obriga os clientes atualizados a usar TURN (UDP/TCP disponíveis).
Sem TURN configurado, o backend recusa iniciar nesse modo. `all` permite também conexão direta.
O `/health` confirma o processo HTTP, não testa o relay nem a experiência do cliente.

`LOG_LEVEL=debug` mostra `ws.in` e `ws.out` com tipo, bytes e identificador da conexão;
`room.join`, `ws.close`, `ws.error` e `ws.heartbeat_timeout` mostram presença e falhas.
HTTP registra status e duração. Tokens, credenciais, SDP e conteúdo do chat não entram nesses logs.
O próprio coturn registra alocações, autenticação e tráfego; seus logs podem conter endereços de rede.

Clientes atualizados enviam `rtc.client` a cada 10 segundos por conexão: rota selecionada,
RTT, bitrate, jitter, perdas, FPS, frames descartados, congelamentos e limitação do encoder.
São medições informadas pelo cliente, não uma medição independente do backend.
Contadores como perdas e congelamentos são acumulados; bitrate é calculado entre amostras.
`qualityLimitationReason=cpu` aponta limitação de codificação; `bandwidth` aponta limitação de rede.
Uma sala envia uma cópia da mídia por participante; TURN não elimina essa multiplicação de upload.

O iniciador tenta reiniciar ICE até três vezes quando há falha ou desconexão persistente.
No Electron, `backgroundThrottling=false` evita redução de atividade com a janela em segundo plano.
Aplicativos Windows já instalados precisam de nova compilação/distribuição para receber estas mudanças;
no site, recarregue a página e entre novamente na sala.

Referências: [estatísticas WebRTC](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/getStats),
[recuperação ICE](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/restartIce),
[logs do coturn](https://github.com/coturn/coturn/blob/master/README.turnserver).
