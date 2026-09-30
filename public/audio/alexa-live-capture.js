// PCM capture only; no speech recognition, persistence or provider connection.
class AlexaLiveCapture extends AudioWorkletProcessor {
  constructor() { super(); this.frame = new Float32Array(Math.round(sampleRate / 4)); this.offset = 0; }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (input) for (const sample of input) {
      this.frame[this.offset++] = sample;
      if (this.offset === this.frame.length) {
        this.port.postMessage(this.frame, [this.frame.buffer]);
        this.frame = new Float32Array(Math.round(sampleRate / 4)); this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor("alexa-live-capture", AlexaLiveCapture);
