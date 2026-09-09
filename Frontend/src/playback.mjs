export function createPlayback(player, { prompt, report }) {
  let generation = 0;
  async function play() {
    const stream = player.srcObject;
    if (!stream?.getTracks().some(track => track.readyState === 'live' && !track.muted)) {
      prompt(false);
      return;
    }
    const attempt = ++generation;
    try {
      await player.play();
      if (attempt === generation) prompt(false);
    } catch (error) {
      if (attempt !== generation || player.srcObject !== stream || error.name === 'AbortError') return;
      prompt(true);
      if (error.name !== 'NotAllowedError') report(error);
    }
  }
  return {
    setStream(stream) {
      if (player.srcObject !== stream) {
        generation++;
        player.srcObject = stream;
        prompt(false);
      }
      return play();
    },
    play,
  };
}
