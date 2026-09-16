import { captureScale, videoBitrate } from '../src/shareQuality';

test('caps capture at native resolution and scales using the short screen edge', () => {
  expect(captureScale(1080, 720)).toBeCloseTo(2 / 3);
  expect(captureScale(720, 1080)).toBe(1);
  expect(captureScale(0, 720)).toBe(1);
});

test('budgets bitrate for both resolution and FPS', () => {
  expect(videoBitrate({ resolution: 720, fps: 30 })).toBe(2_500_000);
  expect(videoBitrate({ resolution: 1080, fps: 15 })).toBe(2_500_000);
});
