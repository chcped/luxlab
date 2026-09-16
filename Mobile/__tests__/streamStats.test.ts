import { summarizeOutbound } from '../src/streamStats';

test('calculates interval bitrate and FPS and joins receiver feedback', () => {
  const old = { id: 'v', type: 'outbound-rtp', kind: 'video', timestamp: 1000, bytesSent: 1000, framesEncoded: 10 };
  const current = { ...old, timestamp: 3000, bytesSent: 251000, framesEncoded: 58, remoteId: 'r' };
  const reports = new Map<string, any>([['v', current], ['r', { packetsLost: 3, roundTripTime: 0.08 }]]);
  expect(summarizeOutbound(reports, new Map([['v', old]]))[0]).toMatchObject({ kbps: 1000, fps: 24, rttMs: 80, lostTotal: 3 });
});

test('does not invent zero metrics for missing samples or counter resets', () => {
  const report = { id: 'v', type: 'outbound-rtp', mediaType: 'video', timestamp: 3000, bytesSent: 20 };
  const reports = new Map([['v', report]]);
  expect(summarizeOutbound(reports)[0]).toMatchObject({ kbps: null, fps: null, rttMs: null, lostTotal: null });
  expect(summarizeOutbound(reports, new Map([['v', { ...report, timestamp: 1000, bytesSent: 100 }]]))[0].kbps).toBeNull();
});
