const H264 = /^video\/h264$/i;
const VP8 = /^video\/vp8$/i;
const BASELINE = /(?:^|;)\s*profile-level-id=42e0[0-9a-f]{2}(?:;|$)/i;

export function preferHardwareAcceleration(codecs, enabled = true) {
  if (!enabled) {
    const vp8 = codecs.filter(codec => VP8.test(codec.mimeType));
    return vp8.length ? [...vp8, ...codecs.filter(codec => !VP8.test(codec.mimeType))] : codecs;
  }
  const baseline = codecs.filter(codec => H264.test(codec.mimeType) && BASELINE.test(codec.sdpFmtpLine || ''));
  if (!baseline.length) return codecs;
  // Drop other H.264 profiles so negotiation cannot silently select High/Main.
  return [...baseline, ...codecs.filter(codec => !H264.test(codec.mimeType))];
}

export function applyVideoCodecPreferences(pc, enabled = true) {
  const codecs = globalThis.RTCRtpSender?.getCapabilities?.('video')?.codecs;
  if (!pc || !codecs?.length) return;
  const preferred = preferHardwareAcceleration(codecs, enabled);
  for (const transceiver of pc.getTransceivers()) {
    const kind = transceiver.receiver?.track?.kind || transceiver.sender?.track?.kind;
    if (kind !== 'video') continue;
    try { transceiver.setCodecPreferences(preferred); } catch { /* browser rejected an unsupported reorder */ }
  }
}
