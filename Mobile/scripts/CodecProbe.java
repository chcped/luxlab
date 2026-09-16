import android.media.*;
import java.nio.ByteBuffer;

// Run with app_process via debug-codecs.ps1. Synthetic YUV frames, no screen capture.
public class CodecProbe {
    public static void main(String[] args) {
        for (String mime : new String[]{"video/x-vnd.on2.vp8", "video/x-vnd.on2.vp9", "video/avc"}) {
            boolean found = false;
            for (MediaCodecInfo info : new MediaCodecList(MediaCodecList.REGULAR_CODECS).getCodecInfos()) {
                if (!info.isEncoder() || info.isAlias()) continue;
                for (String type : info.getSupportedTypes()) if (type.equals(mime)) {
                    found = true;
                    test(info, mime);
                }
            }
            if (!found) System.out.println("RESULT " + mime + " no MediaCodec encoder exposed");
        }
    }

    static void test(MediaCodecInfo info, String mime) {
        MediaCodec codec = null;
        try {
            int w = 720, h = 1560, frames = 90;
            MediaCodecInfo.CodecCapabilities caps = info.getCapabilitiesForType(mime);
            if (!caps.getVideoCapabilities().areSizeAndRateSupported(w, h, 30)) {
                System.out.println("RESULT " + info.getName() + " hw=" + info.isHardwareAccelerated() + " 720x1560@30 not advertised; trying configuration");
            }
            int color = -1;
            for (int c : caps.colorFormats) if (c == MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible) color = c;
            if (color < 0) {
                System.out.println("RESULT " + info.getName() + " no flexible YUV input; test skipped");
                return;
            }
            MediaFormat format = MediaFormat.createVideoFormat(mime, w, h);
            format.setInteger(MediaFormat.KEY_COLOR_FORMAT, color);
            format.setInteger(MediaFormat.KEY_BIT_RATE, 2500000);
            format.setInteger(MediaFormat.KEY_FRAME_RATE, 30);
            format.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1);
            format.setInteger(MediaFormat.KEY_MAX_B_FRAMES, 0);
            if (mime.equals("video/avc")) format.setInteger(MediaFormat.KEY_PROFILE, MediaCodecInfo.CodecProfileLevel.AVCProfileBaseline);
            codec = MediaCodec.createByCodecName(info.getName());
            codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
            codec.start();
            byte[] pixels = new byte[w * h * 3 / 2];
            java.util.Arrays.fill(pixels, w*h, pixels.length, (byte)128);
            MediaCodec.BufferInfo buffer = new MediaCodec.BufferInfo();
            int sent = 0, received = 0;
            long start = System.nanoTime(), first = 0, lastPts = -1;
            boolean reordered = false, eos = false;
            while (System.nanoTime() - start < 15000000000L && !eos) {
                if (sent <= frames) {
                    int index = codec.dequeueInputBuffer(1000);
                    if (index >= 0) {
                        if (sent == frames) codec.queueInputBuffer(index, 0, 0, sent * 1000000L / 30, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                        else {
                            for (int y = 0; y < h; y++) java.util.Arrays.fill(pixels, y*w, (y+1)*w, (byte)((y + sent*7) % 220 + 16));
                            ByteBuffer input = codec.getInputBuffer(index);
                            input.clear(); input.put(pixels);
                            codec.queueInputBuffer(index, 0, pixels.length, sent * 1000000L / 30, 0);
                        }
                        sent++;
                    }
                }
                int output;
                while ((output = codec.dequeueOutputBuffer(buffer, 1000)) >= 0) {
                    if (buffer.size > 0 && (buffer.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0) {
                        if (first == 0) first = System.nanoTime();
                        if (buffer.presentationTimeUs < lastPts) reordered = true;
                        lastPts = buffer.presentationTimeUs;
                        received++;
                    }
                    eos = (buffer.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0;
                    codec.releaseOutputBuffer(output, false);
                }
            }
            double seconds = (System.nanoTime() - start) / 1e9;
            System.out.printf(java.util.Locale.ROOT, "RESULT %s hw=%s frames=%d/%d throughput=%.1f fps first=%.1f ms reordered=%s eos=%s%n", info.getName(), info.isHardwareAccelerated(), received, frames, received/seconds, first == 0 ? -1 : (first-start)/1e6, reordered, eos);
        } catch (Exception error) {
            System.out.println("RESULT " + info.getName() + " failed " + error);
        } finally {
            if (codec != null) { try { codec.stop(); } catch (Exception ignored) {} codec.release(); }
        }
    }
}
