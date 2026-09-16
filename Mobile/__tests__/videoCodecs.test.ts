import { applyBaselinePreferences, preferBaseline } from '../src/videoCodecs';

const vp8 = { mimeType: 'video/VP8' };
const high = { mimeType: 'video/H264', sdpFmtpLine: 'profile-level-id=640c1f' };
const baseline = { mimeType: 'video/H264', sdpFmtpLine: 'packetization-mode=1;profile-level-id=42e01f' };
const rtx = { mimeType: 'video/rtx' };

test('prefers constrained baseline, removes high profile and preserves fallback/repair codecs', () => {
  expect(preferBaseline([vp8, high, baseline, rtx])).toEqual([baseline, vp8, rtx]);
});

test('keeps original capabilities when constrained baseline is unavailable', () => {
  const codecs = [{ mimeType: 'video/VP8' }];
  expect(preferBaseline(codecs)).toBe(codecs);
});

test('applies baseline preferences only to video transceivers', () => {
  const video = { receiver: { track: { kind: 'video' } }, sender: {}, setCodecPreferences: jest.fn() };
  const audio = { receiver: { track: { kind: 'audio' } }, sender: {}, setCodecPreferences: jest.fn() };
  applyBaselinePreferences({ getTransceivers: () => [video, audio] }, [vp8, high, baseline, rtx]);
  expect(video.setCodecPreferences).toHaveBeenCalledWith([baseline, vp8, rtx]);
  expect(audio.setCodecPreferences).not.toHaveBeenCalled();
});
