# Luxlab Desktop

Frontend definitivo em Electron, independente do Discord. A mesma interface funciona no navegador para receber convites.

Inclui salas, perfil local, chat, lista de transmissões, tela com áudio opcional do sistema, volume e saída de som. Não captura microfone ou câmera.

```powershell
npm.cmd ci
npm.cmd start
npm.cmd test
npm.cmd run dist
```

Abra **Servidor** para configurar o backend e depois crie uma sala ou cole um convite. A captura exige selecionar uma fonte e clicar em **Iniciar compartilhamento**.

Instalador: `dist/P2P Desktop Setup 0.3.0.exe`.

Consulte o [README principal](../README.md) para implantação, STUN/TURN e integração com seu login. `activity/`, `publisher.mjs` e `live-publisher.mjs` são legados e não são carregados pela interface atual.
