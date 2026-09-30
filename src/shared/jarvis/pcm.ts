/** Bounded memory-only mono 16 kHz PCM16; no audio file or browser persistence. */
export function encoderPCM16(channels: readonly Float32Array[], sampleRate: number): Uint8Array {
 const n = channels[0]?.length ?? 0;
 if (channels.length === 0 || channels.length > 2 || channels.some((c) => c.length !== n) || !Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 96000 || n === 0 || n / sampleRate > 30) throw new Error("audio-volume");
 const count = Math.floor(n * 16000 / sampleRate);
 const bytes = new Uint8Array(count * 2), view = new DataView(bytes.buffer);
 for (let i = 0; i < count; i++) {
  const position = i * sampleRate / 16000, left = Math.floor(position), right = Math.min(n - 1, left + 1), alpha = position - left;
  let sample = 0;
  for (const channel of channels) sample += (channel[left]! * (1 - alpha) + channel[right]! * alpha) / channels.length;
  if (!Number.isFinite(sample)) throw new Error("audio-format");
  sample = Math.min(1, Math.max(-1, sample)); view.setInt16(i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
 }
 return bytes;
}
