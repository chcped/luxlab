type Report = Record<string, any>;

function rate(current: Report, previous: Report | undefined, field: string) {
  if (!previous || typeof current[field] !== 'number' || typeof previous[field] !== 'number') return null;
  const seconds = (current.timestamp - previous.timestamp) / 1000;
  const delta = current[field] - previous[field];
  return seconds > 0 && delta >= 0 ? delta / seconds : null;
}

export function summarizeOutbound(reports: Map<string, Report>, previous?: Map<string, Report>) {
  return [...reports.values()]
    .filter(report => report.type === 'outbound-rtp' && (report.kind || report.mediaType) === 'video' && !report.isRemote)
    .map(report => {
      const old = previous?.get(report.id);
      const bytes = rate(report, old, 'bytesSent');
      const remote = reports.get(report.remoteId);
      const transport = reports.get(report.transportId);
      const pair = reports.get(transport?.selectedCandidatePairId);
      return {
        kbps: bytes === null ? null : Math.round(bytes * 8 / 1000),
        fps: rate(report, old, 'framesEncoded'),
        width: report.frameWidth ?? null,
        height: report.frameHeight ?? null,
        rttMs: typeof remote?.roundTripTime === 'number' ? Math.round(remote.roundTripTime * 1000)
          : typeof pair?.currentRoundTripTime === 'number' ? Math.round(pair.currentRoundTripTime * 1000) : null,
        lostTotal: remote?.packetsLost ?? null,
        limitation: report.qualityLimitationReason ?? null,
      };
    });
}
