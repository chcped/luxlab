# Luxlab — backend de salas

Express e WebSocket para salas independentes do Discord. Serve a mesma interface usada no Electron e faz a sinalização WebRTC, presença e chat. Mídia trafega entre os participantes ou via TURN; não há FFmpeg/HLS no serviço ativo.

```powershell
npm.cmd ci
npm.cmd start
npm.cmd test
```

Configure `.env` a partir de `.env.example`, preservando seus segredos existentes. Para Docker, execute `docker compose up -d --build` na raiz do projeto. O contexto de build inclui `Frontend/src`.

Consulte o [README principal](../README.md) para variáveis, API, limites, configuração TURN e integração do seu login. `src/live.js`, `src/rooms.js` e `src/auth.js` são módulos legados preservados; `src/server.js` carrega `src/standalone.js`.
