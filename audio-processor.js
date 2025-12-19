class FT8AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096;
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    
    if (input.length === 0) return true;
    
    const inputChannel = input[0];
    const outputChannel = output[0];
    
    if (inputChannel && outputChannel) {
      outputChannel.set(inputChannel);
    }
    
    if (inputChannel) {
      for (let i = 0; i < inputChannel.length; i++) {
        this.buffer[this.bufferIndex++] = inputChannel[i];
        
        if (this.bufferIndex >= this.bufferSize) {
          this.port.postMessage({
            type: 'audio',
            samples: this.buffer.slice()
          });
          this.bufferIndex = 0;
        }
      }
    }
    
    return true;
  }
}

registerProcessor('ft8-audio-processor', FT8AudioProcessor);
