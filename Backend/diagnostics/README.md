# Verificação TURN — 2026-09-11

`turn-2026-09-11.jsonl` registra dois navegadores Chromium headless executados nesta VPS,
com sinalização HTTPS pública e mídia sintética (canvas 1280x720 e oscilador de áudio).
Cada transporte foi observado por aproximadamente 22 segundos. Não representa uma
medição na rede do usuário nem um teste prolongado de estabilidade.

UDP e TCP autenticaram e transportaram áudio/vídeo, com relay nas duas pontas e zero
pacotes perdidos. UDP: 650 frames, 29 FPS, zero congelamentos, largura recebida 960.
TCP: 644 frames, 31 FPS no instante final, um congelamento, largura recebida 640.
A resolução sofreu adaptação automática; este teste não comprova HD sustentado.
O resultado `passed` valida conectividade e mídia decodificada, não ausência de travamentos.

`check-turn.cjs` depende de Playwright/Chromium em ambiente de diagnóstico separado.
Cria salas temporárias na instância pública e as fecha ao terminar. Para reproduzir,
instale Playwright e Chromium nesse ambiente e execute o script com Node.js.
