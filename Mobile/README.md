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
