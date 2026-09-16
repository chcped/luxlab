export const RESOLUTIONS = [480, 720, 1080] as const;
export const FRAME_RATES = [15, 24, 30] as const;
export type ShareQuality = { resolution: typeof RESOLUTIONS[number]; fps: typeof FRAME_RATES[number] };
export const DEFAULT_SHARE_QUALITY: ShareQuality = { resolution: 720, fps: 24 };

export function captureScale(shortEdgePixels: number, resolution: number) {
  return Number.isFinite(shortEdgePixels) && shortEdgePixels > 0
    ? Math.min(1, resolution / shortEdgePixels) : 1;
}

export function videoBitrate(quality: ShareQuality) {
  const base = { 480: 1_200_000, 720: 2_500_000, 1080: 5_000_000 }[quality.resolution];
  return Math.round(base * quality.fps / 30);
}
