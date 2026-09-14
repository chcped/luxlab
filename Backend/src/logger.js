const levels = { debug: 10, info: 20, warn: 30, error: 40 };
export function log(level, event, fields = {}) {
  if (levels[level] < (levels[process.env.LOG_LEVEL || 'info'] ?? 20)) return;
  console.log(JSON.stringify({ time: new Date().toISOString(), level, event, ...fields }));
}
// Accept only bounded diagnostic fields; never log SDP, ICE addresses, tokens or chat.
export function diagnostic(value) {
  const result = {};
  const numbers = ['rttMs', 'availableOutgoingBitrate', 'bytesReceived', 'bytesSent', 'bitrateKbps', 'packetsLost', 'jitterMs', 'framesDecoded', 'framesDropped', 'framesPerSecond', 'freezeCount', 'totalFreezesDuration', 'errorCode', 'attempt'];
  const strings = ['event', 'connection', 'ice', 'gathering', 'localType', 'remoteType', 'protocol', 'relayProtocol', 'kind', 'direction', 'qualityLimitationReason'];
  for (const key of numbers) if (typeof value?.[key] === 'number' && Number.isFinite(value[key])) result[key] = value[key];
  for (const key of strings) if (typeof value?.[key] === 'string') result[key] = value[key].replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
  return result;
}
