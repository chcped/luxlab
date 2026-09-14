// Feed process PCM to WebRTC without playing it on local speakers.
export async function captureProcessAudio(desktop, pid) {
  const token = crypto.randomUUID();
  const context = new AudioContext({ sampleRate: 48000 });
  const destination = context.createMediaStreamDestination();
  const playing = new Set();
  let next = 0, closed = false;
  const unsubscribe = desktop.onProcessAudio(data => {
    if (closed || data.token !== token || context.state !== 'running') return;
    const { buffer, channels, sampleRate } = data;
    if (!(buffer instanceof Float32Array) || channels !== 2 || sampleRate !== 48000 || !buffer.length || buffer.length % channels) return;
    // Discard stale queued audio after suspension rather than growing latency.
    if (next > context.currentTime + 0.2) return;
    const audio = context.createBuffer(channels, buffer.length / channels, sampleRate);
    for (let channel = 0; channel < channels; channel++) {
      const output = audio.getChannelData(channel);
      for (let frame = 0; frame < output.length; frame++) output[frame] = buffer[frame * channels + channel];
    }
    const source = context.createBufferSource();
    source.buffer = audio;
    source.connect(destination);
    playing.add(source);
    source.onended = () => { playing.delete(source); source.disconnect(); };
    if (next < context.currentTime + 0.005) next = context.currentTime + 0.04;
    source.start(next);
    next += audio.duration;
  });
  async function stop() {
    if (closed) return;
    closed = true;
    unsubscribe();
    for (const source of playing) { source.stop(); source.disconnect(); }
    playing.clear();
    destination.stream.getTracks().forEach(track => track.stop());
    await Promise.allSettled([desktop.stopProcessAudio(token), context.close()]);
  }
  try {
    await context.resume();
    await desktop.startProcessAudio(pid, token);
    return { stream: destination.stream, stop };
  } catch (error) { await stop(); throw error; }
}
