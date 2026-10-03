// Memory-only 20 ms frames. No recognition, storage, provider or network connection.
class AlexaLocalCapture extends AudioWorkletProcessor {
  constructor() { super(); this.frame = new Float32Array(Math.round(sampleRate / 50)); this.offset = 0; }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (input) for (const sample of input) {
      this.frame[this.offset++] = sample;
      if (this.offset === this.frame.length) {
        this.port.postMessage(this.frame, [this.frame.buffer]);
        this.frame = new Float32Array(Math.round(sampleRate / 50)); this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor("alexa-local-capture", AlexaLocalCapture);
