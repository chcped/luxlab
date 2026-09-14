# Contas e salas permanentes

O backend agora oferece login por código de e-mail, salas persistentes, membros
autorizados e convites fixos. As rotas antigas de salas temporárias continuam
funcionando. Este documento é o contrato para a próxima implementação no front.
Esta alteração não cria telas de login nem publica uma release Windows.

## Instalação no servidor

Requer **Node.js 22.16 ou superior**. O Dockerfile usa Node 22. O banco SQLite é
criado e migrado automaticamente no primeiro início. Contas, sessões, salas,
convites e autorizações persistem; presença, chat e conexões WebRTC ficam em memória.

1. Envie os arquivos atualizados de `Backend`, incluindo `package.json`,
   `package-lock.json`, `src`, Dockerfiles e `docker-compose.yml`.
2. Preserve `JWT_SECRET`, `AUTH_JWT_SECRET` (se utilizado), as variáveis TURN e os
   demais segredos atuais. Para Resend, configure no `.env` do servidor:

   ```dotenv
   RESEND_API_KEY=sua-chave-do-resend
   RESEND_FROM=Luxlab <acesso@seudominio.com>
   ```

   O dom?nio do remetente precisa estar verificado no Resend para enviar aos usu?rios.
   A chave fica somente no backend. A API do Resend tem prioridade sobre SMTP; se
   apenas uma das vari?veis Resend estiver preenchida, o login fica indispon?vel
   at? completar a configura??o. N?o h? troca autom?tica de provedor ap?s falhas.
   Refer?ncia: https://resend.com/docs/api-reference/emails/send-email

   Como alternativa, configure SMTP:

   ```dotenv
   SMTP_HOST=smtp.seuprovedor.com
   SMTP_PORT=587
   SMTP_USER=seu-usuario
   SMTP_PASS=sua-senha
   SMTP_FROM=Luxlab <acesso@seudominio.com>
   ```

   Porta 465 usa TLS direto; as demais exigem STARTTLS. Certificados são validados.
   Configure o domínio remetente no provedor. Não há envio real durante os testes.

3. No Compose fornecido, o volume `luxlab-data` é montado em `/app/data` e o banco
   fica em `/app/data/luxlab.sqlite`. Mantenha o mesmo nome de projeto Compose para
   reutilizar o mesmo volume. Se usar um Compose próprio, inclua esse volume gravável
   mesmo com o restante do contêiner em modo somente leitura. `DATABASE_PATH`, se
   definido no `.env`, deve apontar para dentro do volume.
4. Na pasta `Backend`: `docker compose up -d --build backend`.
   Se o servidor usa arquivos Compose adicionais, mantenha os mesmos `-f` usados
   no deployment atual. Não é necessário recriar o TURN para esta mudança.
5. Consulte `/health` e `/api/v2/config`. `emailLogin: true` indica que o provedor de e-mail foi
   configurado, não que a entrega foi testada. Faça um login real com um e-mail seu.

Sem Resend completo nem `SMTP_HOST`/`SMTP_FROM`, o servidor inicia e as salas antigas funcionam, mas
solicitar um código retorna 503. Não existe código de teste, senha universal ou
retorno do código na resposta HTTP. A configuração SMTP não deve ir para o Git.

Em execução local, o padrão é `Backend/data/luxlab.sqlite`. Para atualizar as
dependências e testar: `npm ci` e `npm test` dentro de `Backend`.

## Login por e-mail

Todas as chamadas usam JSON e HTTPS em produção.

| Método e rota | Corpo / resultado |
| --- | --- |
| `POST /api/v2/auth/email/request` | `{ "email": "ana@example.com" }`; retorna 202 e envia código quando permitido |
| `POST /api/v2/auth/email/verify` | `{ "email": "ana@example.com", "code": "12345678" }`; retorna a conta e sessão |
| `GET /api/v2/auth/me` | Conta e validade da sessão atual |
| `POST /api/v2/auth/logout` | Revoga a sessão atual, incluindo suas conexões; retorna 204 |

A conta só é criada após confirmar o código. E-mails são normalizados para minúsculas.
O código tem 8 dígitos, expira em 10 minutos e funciona uma única vez. São permitidas
5 tentativas por código, 1 envio por minuto e 5 envios por hora para cada e-mail;
o endpoint de envio também limita cada IP a 5 pedidos por 15 minutos. Há ainda os
limites gerais da API. A resposta 202 é a mesma para contas novas/existentes e pedidos
suprimidos pelo limite de e-mail. Falhas de entrega retornam 503 e invalidam o código.

Exemplo da confirmação:

```json
{
  "account": { "id": "uuid-da-conta", "email": "ana@example.com" },
  "accessToken": "ll_...",
  "tokenType": "Bearer",
  "expiresAt": 1800000000000
}
```

Envie `Authorization: Bearer <accessToken>` em todas as chamadas autenticadas.
Essa sessão dura 30 dias e é armazenada somente por hash no banco. O logout a revoga.
Não existe refresh token nesta versão; após expirar, solicite outro código. O front
deve guardar o token em memória ou, no desktop, em armazenamento protegido pelo SO.
Não envie tokens, códigos ou e-mails em parâmetros de URL ou logs.

O JWT de provedores externos continua aceito pelas salas temporárias quando
configurado; ele não autoriza as novas salas persistentes. Estas usam exclusivamente
as contas verificadas desta API. `ALLOW_GUESTS` continua controlando apenas o fluxo antigo.

## Salas e autorizações

Todas as rotas abaixo exigem uma conta autenticada. `:id` é o ID da sala.

| Método e rota | Comportamento |
| --- | --- |
| `GET /api/v2/saved-rooms` | Retorna `{ rooms: [...] }` com as salas da conta, inclusive vazias |
| `POST /api/v2/saved-rooms` | `{ "name": "Amigos", "inviteEnabled": true }`; cria sala e retorna `{ room, invite }` (201) |
| `GET /api/v2/saved-rooms/:id` | Dados da sala, somente para membros |
| `PATCH /api/v2/saved-rooms/:id` | `{ "name": "Novo nome" }`; somente o dono |
| `DELETE /api/v2/saved-rooms/:id` | Exclui sala e autorizações, desconecta participantes; somente o dono |
| `POST /api/v2/saved-rooms/:id/join` | `{ "profile": { "name": "Ana" } }`; emite sessão WebRTC para membro autorizado |
| `GET /api/v2/saved-rooms/:id/members` | Lista contas/e-mails autorizados; somente o dono |
| `POST /api/v2/saved-rooms/:id/members` | `{ "email": "amigo@example.com" }`; adiciona uma conta já existente, somente o dono |
| `DELETE /api/v2/saved-rooms/:id/members/:accountId` | Remove autorização e conexões dessa conta; somente o dono |
| `POST /api/v2/saved-rooms/:id/leave` | Sai voluntariamente da lista de membros; o dono deve excluir a sala para encerrá-la |
| `GET /api/v2/saved-rooms/:id/invite` | Consulta convite atual; somente o dono |
| `POST /api/v2/saved-rooms/:id/invite` | `{ "enabled": true }` gera/renova convite; `false` desativa; somente o dono |
| `POST /api/v2/invites/accept` | `{ "code": "id-da-sala.assinatura" }`; adiciona a conta como membro e retorna `{ room }` |

Cada sala retorna `id`, `name`, `ownerId`, `role` (`owner` ou `member`) e `createdAt`
em milissegundos. O nome aceita 1 a 80 caracteres. Limites iniciais: 20 salas próprias
por conta, 1.000 salas salvas no servidor e 100 membros autorizados por sala. O limite
simultâneo continua sendo `MAX_MEMBERS_PER_ROOM` (padrão 8), contando conexões/dispositivos;
`MAX_ROOMS` limita salas ativas em memória, não o total salvo.

A resposta de `join` mantém o formato usado pelo aplicativo: `roomId`, `token`,
`iceServers`, `iceTransportPolicy` e `expiresAt`. Envie esse **token de sala** na primeira
mensagem do `/ws`: `{ "type": "join", "token": "..." }`. O `accessToken` da conta
não substitui o token de sala. A rota antiga `/api/v2/rooms/:id/join` também reconhece
uma sala persistente e exige a mesma autorização. O token de sala expira segundo
`ROOM_TTL_SECONDS`; a sala salva permanece após sua expiração.

Convites vêm como `{ "enabled": true, "code": "..." }`. O front pode montar um link
com fragmento, por exemplo `https://seusite/#invite=<code>`, e guardar o convite durante
o login. O tratamento desse fragmento ainda deve ser implementado no front. O backend
aceita o código via corpo JSON, evitando sua inclusão nos logs de URL.

O convite é fixo até o dono renovar/desativar; o primeiro aceite adiciona a conta como
membro. Depois, ela entra pela lista de salas, sem reapresentar o convite. Renovar ou
desativar o link não expulsa os membros existentes. Uma conta removida pelo dono não
pode voltar por convite, nem com um link novo: o dono precisa adicioná-la novamente
por e-mail. Tokens anteriores à remoção continuam inválidos mesmo após a readmissão.
Quem sai voluntariamente pode aceitar o convite outra vez.

O dono nunca é transferido automaticamente numa sala permanente. O comando WebSocket
`kick` nessa sala remove a autorização da conta e encerra todos os dispositivos dela.
Não é possível remover o dono. Nas salas temporárias, o comportamento antigo é mantido.

## Persistência, operação e validação

SQLite usa WAL e migração transacional com `PRAGMA user_version = 1`. Use uma única
instância do backend: presença e sinalização continuam em memória. Escalar horizontalmente
exigirá compartilhar esse estado e os mecanismos de revogação/limitação de solicitações.

Faça backup consistente do banco usando uma ferramenta de backup SQLite ou pare o
backend antes de copiar o diretório `/app/data` inteiro. Não copie apenas o arquivo
principal enquanto houver escrita em WAL. Preserve o volume nas atualizações: remover
volumes com `docker compose down -v` também removeria as contas e salas. A chave
`JWT_SECRET` participa da assinatura dos convites; trocá-la invalida links existentes
e códigos de login pendentes. Sessões opacas de conta são revogadas no banco, não pela
troca dessa chave. Um downgrade não deve modificar o banco mais recente.

Os testes cobrem confirmação e uso único de código, expiração e limites, falha de envio,
autorização das rotas, convites, readmissão, revogação de WebSockets e persistência após
reabrir o banco. O envio real de e-mail e o Compose precisam ser validados no servidor.
