# Servidor de sinalização P2P para Discord Activity

Servidor Node.js para negociar conexões WebRTC entre um capturador desktop (`publisher`) e espectadores dentro de uma Discord Activity (`viewer`). O vídeo e o áudio não atravessam este servidor: seguem por WebRTC P2P ou por TURN quando a conexão direta falha.

## Segurança e criptografia

- WebRTC cifra mídia obrigatoriamente com DTLS-SRTP.
- Produção usa HTTPS/WSS por Nginx.
- Tokens JWT HS256 têm função, sala, peer e expiração.
- O módulo `client/encryption.js` cifra SDP e ICE com AES-256-GCM antes do envio; o servidor recebe apenas uma string opaca.
- A chave AES deve ser criada no cliente e compartilhada no fragmento da URL (`#key=...`), pois fragmentos não são enviados ao servidor.
- O TURN consegue retransmitir pacotes, mas a mídia continua cifrada por DTLS-SRTP.

> Não coloque `ADMIN_API_KEY` na Activity nem no aplicativo distribuído. Seu backend autenticado deve criar os tokens.

## Instalação

### Gerar as chaves pelo PowerShell

No Windows, abra o PowerShell dentro da pasta do projeto e execute:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\New-P2PSecrets.ps1 -Mode All
```

Isso cria o `.env` com `JWT_SECRET` e `ADMIN_API_KEY` sem mostrar os valores no terminal, restringe o arquivo ao usuário atual e copia uma chave AES-256 de sala para a área de transferência.

Outras opções:

```powershell
# Criar somente o .env
.\scripts\New-P2PSecrets.ps1 -Mode Env

# Gerar somente uma nova chave AES-256 de sala
.\scripts\New-P2PSecrets.ps1 -Mode RoomKey

# Substituir um .env existente (invalida tokens JWT anteriores)
.\scripts\New-P2PSecrets.ps1 -Mode Env -Force
```

Não publique o `.env`, não coloque a `ADMIN_API_KEY` no frontend e não compartilhe a chave da sala em parâmetros antes do `#`.

```bash
cp .env.example .env
openssl rand -base64 48
# use duas chaves diferentes no .env
npm install
npm test
npm start
```

Ou execute com Docker:

```bash
cp .env.example .env
docker compose up -d --build
```

## Criar sala e espectadores

```bash
curl -X POST https://signal.seudominio.com/api/rooms \
  -H 'x-admin-key: SUA_ADMIN_API_KEY' \
  -H 'content-type: application/json'

curl -X POST https://signal.seudominio.com/api/rooms/ROOM_ID/viewers \
  -H 'x-admin-key: SUA_ADMIN_API_KEY' \
  -H 'content-type: application/json'
```

Conecte em `wss://signal.seudominio.com/ws` e envie primeiro:

```json
{"type":"join","token":"JWT_RECEBIDO"}
```

Para retransmitir um envelope já criptografado:

```json
{"type":"signal","to":"PEER_ID","payload":"ENVELOPE_AES_GCM"}
```

O servidor responde com `joined`, `peer-joined`, `peer-left`, `signal` ou `error`. Use `client/example.js` como adaptador inicial para a Activity.

## Integração WebRTC

O publisher cria uma `RTCPeerConnection` por espectador, adiciona as tracks, gera a offer e envia via `signal()`. O viewer recebe a offer, define `setRemoteDescription`, cria a answer e devolve. Ambos enviam cada `icecandidate`. Para mais de poucos espectadores, migre para um SFU, pois P2P multiplica o upload do publisher.

Configure um servidor coturn real. STUN sozinho não resolve todos os casos, sobretudo CGNAT e redes corporativas.

## Discord Activity

Cadastre `https://signal.seudominio.com` nos URL Mappings da aplicação. O domínio público deve ter certificado TLS válido. Em produção, valide a identidade do usuário Discord no seu backend antes de emitir um token viewer.
