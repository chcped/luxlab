# Teste de carga TURN

Na pasta `Frontend`, use `npm run test:turn:load -- ...`. Sem `--run`, o comando
somente mostra o plano e não abre conexões. Com `--run`, cria salas temporárias no
servidor indicado e transmite vídeo em movimento e áudio sintético, sem microfone
ou captura da tela. Os participantes ficam em janelas ocultas e o áudio local é mudo.

Comece pequeno e compare UDP e TCP separadamente:

```powershell
npm run test:turn:load -- --pairs=1 --duration=60 --mbps=3 --transport=udp --run
npm run test:turn:load -- --pairs=2 --duration=120 --mbps=3 --transport=udp --run
npm run test:turn:load -- --pairs=4 --duration=120 --mbps=3 --transport=udp --run
npm run test:turn:load -- --pairs=4 --duration=120 --mbps=3 --transport=tcp --run
```

Aguarde pelo menos um minuto entre execuções se encontrar HTTP 429. Não execute
vários geradores no mesmo IP sem levar em conta o limite de requisições do backend.
Use Ctrl+C para interromper; os participantes são encerrados e a mídia é sintética.
Uma interrupção forçada do processo pode deixar apenas o relatório parcial JSONL.

| Opção | Padrão | Limites / significado |
| --- | --- | --- |
| `--server` | `https://luxlab.net.br` | Backend que fornecerá as credenciais TURN |
| `--pairs` | 2 | 1–32; cada par tem um emissor e um receptor em uma sala própria |
| `--duration` | 60 | 10–1800 segundos de medição, após a preparação |
| `--warmup` | 20 | 5–120 segundos após iniciar todos os pares |
| `--width` / `--height` | 1280 / 720 | 320–3840 / 180–2160 |
| `--fps` | 30 | 5–60 FPS solicitados |
| `--mbps` | 3 | 0,1–30 Mbps como teto de vídeo por emissor; use ponto decimal |
| `--transport` | udp | `udp` ou `tcp`, filtrando as URLs TURN disponibilizadas |

Exemplo em 1080p:

```powershell
npm run test:turn:load -- --pairs=4 --duration=180 --width=1920 --height=1080 --fps=30 --mbps=5 --transport=udp --run
```

São oito participantes, com teto agregado de vídeo de 20 Mbps. O codec pode enviar
menos: `maxBitrate` não garante tráfego constante. Áudio e overhead se somam, e o
tráfego contado na interface do TURN depende do caminho de entrada/saída e de ambos
os participantes usarem relay. Não interprete o teto agregado como tráfego exato
ou estimativa de cobrança. O vídeo sintético é deliberadamente mais complexo que
os quadros simples do teste `test:turn`.

## Relatórios e interpretação

Os resultados ficam em `Frontend/diagnostics/turn-load-<data>.json` (resumo) e
`.jsonl` (configuração e amostras a cada aproximadamente 2 segundos). Credenciais
TURN, tokens, SDP e endereços dos candidatos não são gravados.

- `completed`: a duração foi concluída sem interrupção/erro do script.
- `connectivityPassed`: todos os pares tiveram relay conectado e mídia recebida,
  sem intervalos medidos de vídeo sem novos frames. Não é um selo de estabilidade.
- `averageReceiveMbps` / `peakReceiveMbps`: tráfego de mídia efetivamente recebido,
  somando áudio e vídeo dos receptores, não contadores da interface do servidor.
- `results[].peers[].streams`: bitrate, FPS, dimensões reais, perdas por intervalo,
  jitter e contadores de congelamentos, quando o navegador fornece esses campos.
- `relayProtocol`: transporte cliente–TURN, quando exposto. `candidateProtocol`
  pode mostrar UDP mesmo ao usar TCP até o servidor TURN.
- `qualityLimitation`: `cpu` aponta limitação do codificador; `bandwidth` indica
  adaptação por banda. Observe também `bitrateConfigured` no emissor.
- `generator`: CPU e memória dos processos Electron do gerador. Não mede o servidor.
- `results[].generatedFps`: frequência real de desenho na origem. Compare com os
  FPS codificados/enviados e recebidos; a primeira amostra não tem essa diferença.

Os contadores de frames/perdas/freezes são cumulativos e incluem a preparação;
bitrate, `frameDelta` e `lossPercent` usam diferenças entre amostras. A primeira
amostra não tem essas diferenças e fica fora da média do resumo. Campos `null`
representam uma métrica indisponível, não zero.

No servidor, acompanhe em outro terminal:

```sh
docker stats
docker compose logs -f --tail=100 --timestamps backend turn
```

Observe CPU, memória, NET I/O, desconexões, limites de alocação e erros do coturn.
NET I/O no `docker stats` é cumulativo e pode não representar a interface usada se
o TURN estiver em rede do host; nesse caso observe também os contadores da interface
do servidor (`ip -s link`).

Para estimar capacidade, aumente os pares (1, 2, 4, 8...) mantendo a mesma qualidade
e duração. Interrompa a escalada quando as métricas piorarem, repita o último nível
bom por 10–30 minutos e compare com CPU/banda do servidor e do gerador. Se o gerador
saturar, distribua a carga entre máquinas/redes. O resultado é capacidade observada
para esse cenário, não um máximo universal do TURN.

## Requisitos e escopo

O teste usa o backend publicado: não lê `Backend/.env` local. Requer visitantes
habilitados (`ALLOW_GUESTS=true`), limite de salas ativas suficiente (`MAX_ROOMS`) e
URLs TURN para o transporte selecionado. Não aumenta nem desativa os limites do
backend/coturn. HTTP 401/429/503 pode indicar autenticação ou limite da API, não
esgotamento de capacidade do TURN.

Cada sala tem dois participantes para medir vários fluxos independentes. Isso não
simula a topologia completa de uma única sala com muitos participantes nem o custo
de um emissor enviando cópias para vários receptores. Como ambas as pontas rodam no
seu PC, CPU, memória e conexão local podem limitar o resultado antes da VPS.
