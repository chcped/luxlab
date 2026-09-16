import { getStreamPreview, resolveStreamSelection } from '../src/roomSelection';

test('does not auto select a stream when the user has not chosen one yet', () => {
  expect(resolveStreamSelection(undefined, ['member-1', 'member-2'])).toBeUndefined();
});

test('keeps the selected stream only while it is still available', () => {
  expect(resolveStreamSelection('member-2', ['member-1', 'member-2'])).toBe('member-2');
  expect(resolveStreamSelection('member-9', ['member-1', 'member-2'])).toBeUndefined();
});

test('uses the first active stream only as a preview, never as the automatic viewer', () => {
  expect(getStreamPreview(['member-1', 'member-2'])).toBe('member-1');
});
