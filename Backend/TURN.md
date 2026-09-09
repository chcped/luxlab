# TURN na VPS Luxlab

VPS: `154.29.76.178`. Pasta informada: `/home/luxlab/backend`.
Copie `compose.turn.yml` para essa pasta. Preserve o Compose atual do Backend:
o layout Linux existente pode ser diferente do workspace (`Backend` com maiúscula).

No terminal SSH da VPS:

```sh
cd /home/luxlab/backend
openssl rand -hex 32
nano .env
```

Preserve as outras variáveis do `.env`. Adicione ou substitua estas quatro linhas,
trocando `CHAVE_GERADA` pelo resultado de `openssl`:

```dotenv
TURN_PUBLIC_IP=154.29.76.178
TURN_SECRET=CHAVE_GERADA
TURN_URLS=turn:154.29.76.178:3478?transport=udp,turn:154.29.76.178:3478?transport=tcp
ICE_SERVERS=[{"urls":"stun:154.29.76.178:3478"}]
```

O Backend deve receber essas variáveis via `env_file: .env` ou `environment` no
Compose existente. O mesmo segredo é usado pelo Coturn para validar as credenciais
temporárias que o Backend já gera. Não envie o segredo ao chat nem ao Git.

Libere no firewall da VPS e no painel do provedor `3478/tcp`, `3478/udp` e
`49160–49200/udp`. Se a VPS usa UFW:

```sh
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
sudo ufw allow 49160:49200/udp
```

Suba o TURN em um projeto separado para não interferir no Compose existente:

```sh
docker compose -p luxlab-turn --env-file .env -f compose.turn.yml up -d
docker compose -p luxlab-turn --env-file .env -f compose.turn.yml logs --tail=50
```

Recrie o serviço Backend usando o arquivo e nome de projeto originais para
carregar as variáveis novas. `docker restart` sozinho não atualiza o ambiente.
Se o Compose está nessa pasta e o serviço se chama `backend`, o comando é:

```sh
docker compose up -d --force-recreate backend
```

Não use esse último comando se sua implantação utiliza outro arquivo/projeto:
nesse caso, acrescente os mesmos `-f` e `-p` usados na implantação original.

Saia da sala e entre novamente nos dois PCs. Não é necessário publicar outro
instalador: o aplicativo recebe `iceServers` do Backend ao entrar na sala.

## Limitações e validação

- Host networking é para a VPS Linux. Se o IP público não está diretamente na
  interface da VPS, configure `TURN_PUBLIC_IP=IP_PUBLICO/IP_PRIVADO` para o Coturn;
  as URLs anunciadas aos clientes continuam usando somente o IP público.
- O endereço TURN não passa pelo proxy HTTP/Nginx/Cloudflare.
- Este serviço oferece UDP/TCP na porta 3478 sem TLS. Redes que aceitam somente
  TLS na porta 443 podem exigir um endpoint TURN TLS com certificado.
- Confirme vídeo e áudio entre redes diferentes. URLs na resposta da API não
  comprovam o relay: as estatísticas WebRTC devem mostrar um candidato `relay`
  no par selecionado quando a mídia passa pelo TURN.

Referência: [Coturn Docker oficial](https://github.com/coturn/coturn/blob/master/docker/coturn/README.md).
