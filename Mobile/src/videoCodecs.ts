type Codec = { mimeType: string; sdpFmtpLine?: string };

export function preferBaseline<T extends Codec>(codecs: T[]): T[] {
  const baseline = codecs.filter(codec => codec.mimeType.toLowerCase() === 'video/h264'
    && /(?:^|;)\s*profile-level-id=42e0[0-9a-f]{2}(?:;|$)/i.test(codec.sdpFmtpLine || ''));
  if (!baseline.length) return codecs;
  // Exclude other H264 profiles so negotiation cannot silently select High profile.
  return [...baseline, ...codecs.filter(codec => codec.mimeType.toLowerCase() !== 'video/h264')];
}

export function applyBaselinePreferences(pc: { getTransceivers(): { receiver?: { track?: { kind?: string } | null }; sender?: { track?: { kind?: string } | null }; setCodecPreferences(codecs: Codec[]): void }[] }, codecs?: Codec[]) {
  if (!codecs?.length) return;
  const preferred = preferBaseline(codecs);
  for (const transceiver of pc.getTransceivers()) {
    const kind = transceiver.receiver?.track?.kind || transceiver.sender?.track?.kind;
    if (kind !== 'video') continue;
    try { transceiver.setCodecPreferences(preferred); } catch { /* native WebRTC rejected an unsupported reorder */ }
  }
}
