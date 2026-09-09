# P2P Desktop para Windows

Aplicativo Electron transmissor (`publisher`) para o servidor em `../Backend`. Permite selecionar tela/janela, transmitir vídeo e áudio do sistema, visualizar a captura e acompanhar espectadores conectados. A sinalização usa o mesmo envelope AES-GCM de `Backend/client/encryption.js`.

## Executar

Instale Node.js 22 ou superior com npm e, no PowerShell:

```powershell
cd Frontend
npm.cmd install
npm.cmd start
```

## Conectar

1. Adicione `app://desktop` à lista `ALLOWED_ORIGINS` em `Backend/.env`, preservando as origens existentes separadas por vírgula, e reinicie o backend.
2. Crie uma sala pelo endpoint administrativo `POST /api/rooms`, conforme o README do backend. Essa operação deve ser feita no seu ambiente administrativo ou backend autenticado.
3. No aplicativo, selecione uma fonte e use o servidor padrão `wss://luxlab.net.br/ws`. Cole o `publisher.token` retornado. Para desenvolvimento local, o campo pode ser alterado para `ws://localhost:8080/ws`.
4. Gere uma chave de sala ou informe uma chave existente. Os espectadores devem usar a mesma chave, compartilhada por canal confiável, preferencialmente no fragmento `#key=...` de uma URL da Activity. Não inclua a chave na query string.
5. Configure `iceServers` com os servidores STUN/TURN da sua infraestrutura e clique em **Iniciar transmissão**. A lista vazia permite tentar conexões locais, mas não garante conectividade pela internet.

Exemplo de `iceServers` (substitua os valores):

```json
[
  { "urls": "stun:turn.seudominio.com:3478" },
  { "urls": ["turn:turn.seudominio.com:3478?transport=udp", "turns:turn.seudominio.com:5349?transport=tcp"], "username": "USUARIO_TEMPORARIO", "credential": "SENHA_TEMPORARIA" }
]
```

O aplicativo não lê arquivos `.env`, não armazena tokens/chaves em disco e não solicita `ADMIN_API_KEY`. A chave copiada permanece na área de transferência do Windows. O áudio opcional captura o sistema, inclusive outros aplicativos, e não o microfone. A prévia fica sem som para evitar retorno. Encerrar, fechar o app ou perder o servidor desliga a captura; a reconexão é manual.

## Gerar instalador

No Windows, dentro de `Frontend`:

```powershell
npm.cmd run dist
```

O instalador NSIS `.exe` será criado em `dist/`. A configuração não inclui certificado de assinatura de código.

## Verificar

```powershell
npm.cmd test
```

Os testes verificam a compatibilidade criptográfica com o backend e a validação da configuração. Para validar a transmissão completa, conecte um viewer da mesma sala, com a mesma chave, que responda à offer SDP e envie/receba candidatos ICE cifrados. Verifique vídeo, áudio opcional, saída do viewer e encerramento da captura. Teste também uma rede externa com TURN.

Esta pasta contém o aplicativo transmissor Windows. O repositório ainda fornece somente um adaptador de exemplo para o viewer; a interface da Discord Activity e a emissão de tokens via login de usuário precisam de implementação separada.

Referências: [captura de desktop no Electron](https://www.electronjs.org/docs/latest/api/desktop-capturer), [configuração do electron-builder](https://www.electron.build/configuration/).
