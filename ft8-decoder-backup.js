/**
 * FT8 Browser Decoder
 * 
 * A JavaScript implementation of FT8 signal decoding for browser audio.
 * Based on ft8_lib by Karlis Goba (YL3JG)
 * 
 * FT8 Protocol Parameters:
 * - Symbol period: 0.160 seconds
 * - Slot time: 15 seconds
 * - Tone spacing: 6.25 Hz
 * - 8-FSK modulation (3 bits per symbol)
 * - 79 total symbols: 7 sync + 29 data + 7 sync + 29 data + 7 sync
 * - 174 bit codeword (91 payload + 83 LDPC parity)
 * - 77 bit message + 14 bit CRC
 */

console.log('ft8-decoder.js module loading...');

// ============================================================================
// Constants
// ============================================================================

export const FT8_SYMBOL_PERIOD = 0.160;  // seconds
export const FT8_SLOT_TIME = 15.0;       // seconds
export const FT8_TONE_SPACING = 6.25;    // Hz
export const FT8_SAMPLE_RATE = 12000;    // Hz

export const FT8_ND = 58;      // Data symbols
export const FT8_NN = 79;      // Total symbols (7+29+7+29+7)
export const FT8_LENGTH_SYNC = 7;
export const FT8_NUM_SYNC = 3;
export const FT8_SYNC_OFFSET = 36;

export const FTX_LDPC_N = 174;  // Encoded message bits
export const FTX_LDPC_K = 91;   // Payload bits (including CRC)
export const FTX_LDPC_M = 83;   // Parity bits

// Costas sync pattern
export const FT8_COSTAS_PATTERN = [3, 1, 4, 0, 6, 5, 2];

// Gray code mapping for 8-FSK
export const FT8_GRAY_MAP = [0, 1, 3, 2, 5, 6, 4, 7];

// Character tables for message encoding/decoding
const CHAR_TABLE_ALPHANUM = " 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const CHAR_TABLE_ALPHANUM_SPACE_SLASH = " 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ/";
const CHAR_TABLE_FULL = " 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ+-./?";

// CRC-14 polynomial
const FT8_CRC_POLYNOMIAL = 0x2757;

// LDPC parity check matrix (Nm) - rows are parity checks, values are bit indices (1-origin)
const LDPC_Nm = [
  [4, 31, 59, 91, 92, 96, 153],
  [5, 32, 60, 93, 115, 146, 0],
  [6, 24, 61, 94, 122, 151, 0],
  [7, 33, 62, 95, 96, 143, 0],
  [8, 25, 63, 83, 93, 96, 148],
  [6, 32, 64, 97, 126, 138, 0],
  [5, 34, 65, 78, 98, 107, 154],
  [9, 35, 66, 99, 139, 146, 0],
  [10, 36, 67, 100, 107, 126, 0],
  [11, 37, 67, 87, 101, 139, 158],
  [12, 38, 68, 102, 105, 155, 0],
  [13, 39, 69, 103, 149, 162, 0],
  [8, 40, 70, 82, 104, 114, 145],
  [14, 41, 71, 88, 102, 123, 156],
  [15, 42, 59, 106, 123, 159, 0],
  [1, 33, 72, 106, 107, 157, 0],
  [16, 43, 73, 108, 141, 160, 0],
  [17, 37, 74, 81, 109, 131, 154],
  [11, 44, 75, 110, 121, 166, 0],
  [45, 55, 64, 111, 130, 161, 173],
  [8, 46, 71, 112, 119, 166, 0],
  [18, 36, 76, 89, 113, 114, 143],
  [19, 38, 77, 104, 116, 163, 0],
  [20, 47, 70, 92, 138, 165, 0],
  [2, 48, 74, 113, 128, 160, 0],
  [21, 45, 78, 83, 117, 121, 151],
  [22, 47, 58, 118, 127, 164, 0],
  [16, 39, 62, 112, 134, 158, 0],
  [23, 43, 79, 120, 131, 145, 0],
  [19, 35, 59, 73, 110, 125, 161],
  [20, 36, 63, 94, 136, 161, 0],
  [14, 31, 79, 98, 132, 164, 0],
  [3, 44, 80, 124, 127, 169, 0],
  [19, 46, 81, 117, 135, 167, 0],
  [7, 49, 58, 90, 100, 105, 168],
  [12, 50, 61, 118, 119, 144, 0],
  [13, 51, 64, 114, 118, 157, 0],
  [24, 52, 76, 129, 148, 149, 0],
  [25, 53, 69, 90, 101, 130, 156],
  [20, 46, 65, 80, 120, 140, 170],
  [21, 54, 77, 100, 140, 171, 0],
  [35, 82, 133, 142, 171, 174, 0],
  [14, 30, 83, 113, 125, 170, 0],
  [4, 29, 68, 120, 134, 173, 0],
  [1, 4, 52, 57, 86, 136, 152],
  [26, 51, 56, 91, 122, 137, 168],
  [52, 84, 110, 115, 145, 168, 0],
  [7, 50, 81, 99, 132, 173, 0],
  [23, 55, 67, 95, 172, 174, 0],
  [26, 41, 77, 109, 141, 148, 0],
  [2, 27, 41, 61, 62, 115, 133],
  [27, 40, 56, 124, 125, 126, 0],
  [18, 49, 55, 124, 141, 167, 0],
  [6, 33, 85, 108, 116, 156, 0],
  [28, 48, 70, 85, 105, 129, 158],
  [9, 54, 63, 131, 147, 155, 0],
  [22, 53, 68, 109, 121, 174, 0],
  [3, 13, 48, 78, 95, 123, 0],
  [31, 69, 133, 150, 155, 169, 0],
  [12, 43, 66, 89, 97, 135, 159],
  [5, 39, 75, 102, 136, 167, 0],
  [2, 54, 86, 101, 135, 164, 0],
  [15, 56, 87, 108, 119, 171, 0],
  [10, 44, 82, 91, 111, 144, 149],
  [23, 34, 71, 94, 127, 153, 0],
  [11, 49, 88, 92, 142, 157, 0],
  [29, 34, 87, 97, 147, 162, 0],
  [30, 50, 60, 86, 137, 142, 162],
  [10, 53, 66, 84, 112, 128, 165],
  [22, 57, 85, 93, 140, 159, 0],
  [28, 32, 72, 103, 132, 166, 0],
  [28, 29, 84, 88, 117, 143, 150],
  [1, 26, 45, 80, 128, 147, 0],
  [17, 27, 89, 103, 116, 153, 0],
  [51, 57, 98, 163, 165, 172, 0],
  [21, 37, 73, 138, 152, 169, 0],
  [16, 47, 76, 130, 137, 154, 0],
  [3, 24, 30, 72, 104, 139, 0],
  [9, 40, 90, 106, 134, 151, 0],
  [15, 58, 60, 74, 111, 150, 163],
  [18, 42, 79, 144, 146, 152, 0],
  [25, 38, 65, 99, 122, 160, 0],
  [17, 42, 75, 129, 170, 172, 0]
];

// LDPC variable node connections (Mn) - which parity checks involve each bit
const LDPC_Mn = [
  [16, 45, 73], [25, 51, 62], [33, 58, 78], [1, 44, 45], [2, 7, 61],
  [3, 6, 54], [4, 35, 48], [5, 13, 21], [8, 56, 79], [9, 64, 69],
  [10, 19, 66], [11, 36, 60], [12, 37, 58], [14, 32, 43], [15, 63, 80],
  [17, 28, 77], [18, 74, 83], [22, 53, 81], [23, 30, 34], [24, 31, 40],
  [26, 41, 76], [27, 57, 70], [29, 49, 65], [3, 38, 78], [5, 39, 82],
  [46, 50, 73], [51, 52, 74], [55, 71, 72], [44, 67, 72], [43, 68, 78],
  [1, 32, 59], [2, 6, 71], [4, 16, 54], [7, 65, 67], [8, 30, 42],
  [9, 22, 31], [10, 18, 76], [11, 23, 82], [12, 28, 61], [13, 52, 79],
  [14, 50, 51], [15, 81, 83], [17, 29, 60], [19, 33, 64], [20, 26, 73],
  [21, 34, 40], [24, 27, 77], [25, 55, 58], [35, 53, 66], [36, 48, 68],
  [37, 46, 75], [38, 45, 47], [39, 57, 69], [41, 56, 62], [20, 49, 53],
  [46, 52, 63], [45, 70, 75], [27, 35, 80], [1, 15, 30], [2, 68, 80],
  [3, 36, 51], [4, 28, 51], [5, 31, 56], [6, 20, 37], [7, 40, 82],
  [8, 60, 69], [9, 10, 49], [11, 44, 57], [12, 39, 59], [13, 24, 55],
  [14, 21, 65], [16, 71, 78], [17, 30, 76], [18, 25, 80], [19, 61, 83],
  [22, 38, 77], [23, 41, 50], [7, 26, 58], [29, 32, 81], [33, 40, 73],
  [18, 34, 48], [13, 42, 64], [5, 26, 43], [47, 69, 72], [54, 55, 70],
  [45, 62, 68], [10, 63, 67], [14, 66, 72], [22, 60, 74], [35, 39, 79],
  [1, 46, 64], [1, 24, 66], [2, 5, 70], [3, 31, 65], [4, 49, 58],
  [1, 4, 5], [6, 60, 67], [7, 32, 75], [8, 48, 82], [9, 35, 41],
  [10, 39, 62], [11, 14, 61], [12, 71, 74], [13, 23, 78], [11, 35, 55],
  [15, 16, 79], [7, 9, 16], [17, 54, 63], [18, 50, 57], [19, 30, 47],
  [20, 64, 80], [21, 28, 69], [22, 25, 43], [13, 22, 37], [2, 47, 51],
  [23, 54, 74], [26, 34, 72], [27, 36, 37], [21, 36, 63], [29, 40, 44],
  [19, 26, 57], [3, 46, 82], [14, 15, 58], [33, 52, 53], [30, 43, 52],
  [6, 9, 52], [27, 33, 65], [25, 69, 73], [38, 55, 83], [20, 39, 77],
  [18, 29, 56], [32, 48, 71], [42, 51, 59], [28, 44, 79], [34, 60, 62],
  [31, 45, 61], [46, 68, 77], [6, 24, 76], [8, 10, 78], [40, 41, 70],
  [17, 50, 53], [42, 66, 68], [4, 22, 72], [36, 64, 81], [13, 29, 47],
  [2, 8, 81], [56, 67, 73], [5, 38, 50], [12, 38, 64], [59, 72, 80],
  [3, 26, 79], [45, 76, 81], [1, 65, 74], [7, 18, 77], [11, 56, 59],
  [14, 39, 54], [16, 37, 66], [10, 28, 55], [15, 60, 70], [17, 25, 82],
  [20, 30, 31], [12, 67, 68], [23, 75, 80], [27, 32, 62], [24, 69, 75],
  [19, 21, 71], [34, 53, 61], [35, 46, 47], [33, 59, 76], [40, 43, 83],
  [41, 42, 63], [49, 75, 83], [20, 44, 48], [42, 49, 57]
];

// Number of bits in each parity check
const LDPC_Num_rows = [
  7, 6, 6, 6, 7, 6, 7, 6, 6, 7, 6, 6, 7, 7, 6, 6,
  6, 7, 6, 7, 6, 7, 6, 6, 6, 7, 6, 6, 6, 7, 6, 6,
  6, 6, 7, 6, 6, 6, 7, 7, 6, 6, 6, 6, 7, 7, 6, 6,
  6, 6, 7, 6, 6, 6, 7, 6, 6, 6, 6, 7, 6, 6, 6, 7,
  6, 6, 6, 7, 7, 6, 6, 7, 6, 6, 6, 6, 6, 6, 6, 7,
  6, 6, 6
];

// ============================================================================
// FFT Implementation (DFT with optional Cooley-Tukey for power-of-2)
// ============================================================================

class FFT {
  constructor(size) {
    this.size = size;
    this.isPowerOf2 = (size & (size - 1)) === 0;
    
    if (this.isPowerOf2) {
      this.levels = Math.log2(size);
      
      // Precompute bit-reversal permutation
      this.reverseBits = new Uint32Array(size);
      for (let i = 0; i < size; i++) {
        let reversed = 0;
        for (let j = 0; j < this.levels; j++) {
          reversed = (reversed << 1) | ((i >> j) & 1);
        }
        this.reverseBits[i] = reversed;
      }
    }
    
    // Precompute twiddle factors for all cases
    this.cosTable = new Float32Array(size);
    this.sinTable = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      const angle = -2 * Math.PI * i / size;
      this.cosTable[i] = Math.cos(angle);
      this.sinTable[i] = Math.sin(angle);
    }
  }
  
  // In-place complex FFT (Cooley-Tukey for power-of-2)
  transform(real, imag) {
    const n = this.size;
    
    if (!this.isPowerOf2) {
      // Use DFT for non-power-of-2 sizes
      this.dft(real, imag);
      return;
    }
    
    // Bit-reversal permutation
    for (let i = 0; i < n; i++) {
      const j = this.reverseBits[i];
      if (j > i) {
        [real[i], real[j]] = [real[j], real[i]];
        [imag[i], imag[j]] = [imag[j], imag[i]];
      }
    }
    
    // Cooley-Tukey FFT
    for (let size = 2; size <= n; size *= 2) {
      const halfSize = size / 2;
      const tableStep = n / size;
      
      for (let i = 0; i < n; i += size) {
        for (let j = 0; j < halfSize; j++) {
          const idx = j * tableStep;
          const tpre = real[i + j + halfSize] * this.cosTable[idx] - 
                       imag[i + j + halfSize] * this.sinTable[idx];
          const tpim = real[i + j + halfSize] * this.sinTable[idx] + 
                       imag[i + j + halfSize] * this.cosTable[idx];
          
          real[i + j + halfSize] = real[i + j] - tpre;
          imag[i + j + halfSize] = imag[i + j] - tpim;
          real[i + j] += tpre;
          imag[i + j] += tpim;
        }
      }
    }
  }
  
  // Direct DFT for any size (slower but works for non-power-of-2)
  dft(real, imag) {
    const n = this.size;
    const tempReal = new Float32Array(n);
    const tempImag = new Float32Array(n);
    
    for (let k = 0; k < n; k++) {
      let sumReal = 0;
      let sumImag = 0;
      for (let t = 0; t < n; t++) {
        const idx = (k * t) % n;
        sumReal += real[t] * this.cosTable[idx] - imag[t] * this.sinTable[idx];
        sumImag += real[t] * this.sinTable[idx] + imag[t] * this.cosTable[idx];
      }
      tempReal[k] = sumReal;
      tempImag[k] = sumImag;
    }
    
    for (let i = 0; i < n; i++) {
      real[i] = tempReal[i];
      imag[i] = tempImag[i];
    }
  }
  
  // Real FFT - returns magnitude spectrum
  realTransform(input) {
    const n = this.size;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    
    // Copy input to real array
    for (let i = 0; i < n; i++) {
      real[i] = i < input.length ? input[i] : 0;
      imag[i] = 0;
    }
    
    this.transform(real, imag);
    
    // Return first half + 1 (DC to Nyquist)
    const magnitudes = new Float32Array(n / 2 + 1);
    for (let i = 0; i <= n / 2; i++) {
      magnitudes[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
    }
    
    return magnitudes;
  }
}

// ============================================================================
// Window Functions
// ============================================================================

function createHannWindow(size) {
  const window = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const x = Math.sin(Math.PI * i / size);
    window[i] = x * x;
  }
  return window;
}

// ============================================================================
// Waterfall / Spectrogram
// ============================================================================

export class FT8Waterfall {
  constructor(config = {}) {
    this.sampleRate = config.sampleRate || FT8_SAMPLE_RATE;
    this.symbolPeriod = FT8_SYMBOL_PERIOD;
    this.fMin = config.fMin || 200;
    this.fMax = config.fMax || 3000;
    
    // Simplified: no oversampling for robustness
    this.freqOsr = 1;
    this.timeOsr = 1;
    
    // Calculate DSP parameters - block size is one symbol period
    this.blockSize = Math.floor(this.sampleRate * this.symbolPeriod);  // 1920 samples at 12kHz
    this.subblockSize = this.blockSize;
    
    // Use 2048-point FFT (power of 2, fast)
    // At 12000 Hz: binWidth = 12000/2048 = 5.86 Hz per bin
    // Each FT8 tone (6.25 Hz) is ~1.07 bins apart
    this.nfft = 2048;
    
    // Frequency resolution
    this.binWidth = this.sampleRate / this.nfft;  // ~5.86 Hz per bin
    this.binsPerTone = FT8_TONE_SPACING / this.binWidth;  // ~1.07 bins per tone
    
    // Frequency bin range
    this.minBin = Math.floor(this.fMin / this.binWidth);
    this.maxBin = Math.ceil(this.fMax / this.binWidth);
    this.numBins = this.maxBin - this.minBin;
    
    console.log(`FT8 Waterfall: blockSize=${this.blockSize}, nfft=${this.nfft}, binWidth=${this.binWidth.toFixed(2)}Hz, numBins=${this.numBins}, binsPerTone=${this.binsPerTone.toFixed(2)}`);
    
    // Create window (sized for blockSize, not nfft)
    this.window = createHannWindow(this.blockSize);
    this.fftNorm = 2.0 / this.nfft;
    for (let i = 0; i < this.blockSize; i++) {
      this.window[i] *= this.fftNorm;
    }
    
    this.fft = new FFT(this.nfft);
    
    // Storage for waterfall data - simple 2D array [block][bin]
    const maxBlocks = Math.ceil(FT8_SLOT_TIME / this.symbolPeriod) + 10;  // Extra buffer
    this.maxBlocks = maxBlocks;
    this.blockStride = this.numBins;
    this.mag = new Float32Array(maxBlocks * this.numBins);
    
    // Processing state
    this.numBlocks = 0;
    this.maxMag = -120.0;
  }
  
  reset() {
    this.numBlocks = 0;
    this.maxMag = -120.0;
    this.mag.fill(0);
  }
  
  // Process one symbol period of audio samples
  processBlock(frame) {
    if (this.numBlocks >= this.maxBlocks) {
      return;  // Silently ignore if full
    }
    
    // Apply window and zero-pad for FFT
    const windowed = new Float32Array(this.nfft);
    const frameLen = Math.min(frame.length, this.blockSize);
    for (let i = 0; i < frameLen; i++) {
      windowed[i] = this.window[i] * (frame[i] || 0);
    }
    // Rest is zero-padded
    
    const magnitudes = this.fft.realTransform(windowed);
    
    // Store magnitude data
    const offset = this.numBlocks * this.numBins;
    
    for (let bin = 0; bin < this.numBins; bin++) {
      const srcBin = this.minBin + bin;
      const mag = magnitudes[srcBin] || 0;
      const mag2 = mag * mag;
      const db = 10 * Math.log10(1e-12 + mag2);
      
      // Scale to 0-255 range (0.5 dB per step, -120 to 0 dB)
      let scaled = Math.floor(2 * db + 240);
      scaled = Math.max(0, Math.min(255, scaled));
      this.mag[offset + bin] = scaled;
      
      if (db > this.maxMag) this.maxMag = db;
    }
    
    this.numBlocks++;
  }
  
  // Get magnitude at specific position (simplified - no oversampling)
  getMag(block, timeSub, freqSub, bin) {
    if (block < 0 || block >= this.numBlocks || bin < 0 || bin >= this.numBins) {
      return 0;
    }
    return this.mag[block * this.numBins + bin];
  }
  
  // Convert frequency in Hz to bin index (relative to minBin)
  freqToBin(freqHz) {
    return Math.round((freqHz - this.fMin) / this.binWidth);
  }
  
  // Convert stored magnitude to dB
  magToDb(magValue) {
    return magValue * 0.5 - 120.0;
  }
}

// ============================================================================
// Sync Detection (Costas Pattern)
// ============================================================================

// Convert tone index (0-7) to bin index for a given base frequency bin
function toneToBin(wf, baseFreqHz, toneIndex) {
  const toneFreqHz = baseFreqHz + toneIndex * FT8_TONE_SPACING;
  const bin = Math.round((toneFreqHz - wf.fMin) / wf.binWidth);
  return Math.max(0, Math.min(wf.numBins - 1, bin));
}

function computeSyncScore(wf, candidate) {
  let score = 0;
  let numAverage = 0;
  
  const { timeOffset, baseFreqHz } = candidate;
  
  // Check sync symbols at positions 0-6, 36-42, 72-78
  for (let m = 0; m < FT8_NUM_SYNC; m++) {
    for (let k = 0; k < FT8_LENGTH_SYNC; k++) {
      const block = FT8_SYNC_OFFSET * m + k;
      const blockAbs = timeOffset + block;
      
      if (blockAbs < 0) continue;
      if (blockAbs >= wf.numBlocks) break;
      
      // Expected tone for this sync symbol (0-7)
      const expectedTone = FT8_COSTAS_PATTERN[k];
      const expectedBin = toneToBin(wf, baseFreqHz, expectedTone);
      
      const magExpected = wf.getMag(blockAbs, 0, 0, expectedBin);
      
      // Compare to frequency neighbors (adjacent tones)
      if (expectedTone > 0) {
        const lowerBin = toneToBin(wf, baseFreqHz, expectedTone - 1);
        const magLower = wf.getMag(blockAbs, 0, 0, lowerBin);
        score += magExpected - magLower;
        numAverage++;
      }
      if (expectedTone < 7) {
        const higherBin = toneToBin(wf, baseFreqHz, expectedTone + 1);
        const magHigher = wf.getMag(blockAbs, 0, 0, higherBin);
        score += magExpected - magHigher;
        numAverage++;
      }
      
      // Compare to time neighbors (previous/next symbol at same frequency)
      if (k > 0 && blockAbs > 0) {
        const magPrev = wf.getMag(blockAbs - 1, 0, 0, expectedBin);
        score += magExpected - magPrev;
        numAverage++;
      }
      if (k + 1 < FT8_LENGTH_SYNC && blockAbs + 1 < wf.numBlocks) {
        const magNext = wf.getMag(blockAbs + 1, 0, 0, expectedBin);
        score += magExpected - magNext;
        numAverage++;
      }
    }
  }
  
  return numAverage > 0 ? Math.floor(score / numAverage) : 0;
}

export function findCandidates(wf, maxCandidates = 200, minScore = 2) {
  const candidates = [];
  
  // Width of 8 tones in Hz
  const signalWidthHz = 8 * FT8_TONE_SPACING;  // 50 Hz
  
  // Scan through possible time and frequency offsets
  // Search every ~3 Hz for better frequency resolution
  const freqStepHz = 3.0;  // Finer than bin width for better coverage
  
  for (let timeOffset = -5; timeOffset < 15; timeOffset++) {
    // Check if we have enough blocks for this offset
    if (timeOffset + FT8_NN > wf.numBlocks) continue;
    if (timeOffset < 0 && -timeOffset > wf.numBlocks) continue;
    
    for (let freqHz = wf.fMin + 10; freqHz + signalWidthHz < wf.fMax - 10; freqHz += freqStepHz) {
      const candidate = { 
        timeOffset, 
        baseFreqHz: freqHz,
        score: 0
      };
      candidate.score = computeSyncScore(wf, candidate);
      
      if (candidate.score >= minScore) {
        candidates.push(candidate);
      }
    }
  }
  
  // Sort by score and limit
  candidates.sort((a, b) => b.score - a.score);
  
  // Remove nearby duplicates (within 10 Hz and 2 time slots)
  const filtered = [];
  for (const cand of candidates) {
    let dominated = false;
    for (const existing of filtered) {
      if (Math.abs(existing.baseFreqHz - cand.baseFreqHz) < 15 &&
          Math.abs(existing.timeOffset - cand.timeOffset) < 3) {
        dominated = true;
        break;
      }
    }
    if (!dominated) {
      filtered.push(cand);
    }
    if (filtered.length >= maxCandidates) break;
  }
  
  return filtered;
}

// ============================================================================
// LDPC Decoding (Belief Propagation)
// ============================================================================

function fastTanh(x) {
  if (x < -4.97) return -1.0;
  if (x > 4.97) return 1.0;
  const x2 = x * x;
  const a = x * (945.0 + x2 * (105.0 + x2));
  const b = 945.0 + x2 * (420.0 + x2 * 15.0);
  return a / b;
}

function fastAtanh(x) {
  const x2 = x * x;
  const a = x * (945.0 + x2 * (-735.0 + x2 * 64.0));
  const b = 945.0 + x2 * (-1050.0 + x2 * 225.0);
  return a / b;
}

function ldpcCheck(codeword) {
  let errors = 0;
  
  for (let m = 0; m < FTX_LDPC_M; m++) {
    let x = 0;
    const numRows = LDPC_Num_rows[m];
    for (let i = 0; i < numRows; i++) {
      const idx = LDPC_Nm[m][i];
      if (idx > 0) {
        x ^= codeword[idx - 1];
      }
    }
    if (x !== 0) errors++;
  }
  
  return errors;
}

export function bpDecode(codeword, maxIters = 25) {
  const tov = [];
  const toc = [];
  
  // Initialize
  for (let n = 0; n < FTX_LDPC_N; n++) {
    tov[n] = [0, 0, 0];
  }
  for (let m = 0; m < FTX_LDPC_M; m++) {
    toc[m] = new Float32Array(7);
  }
  
  const plain = new Uint8Array(FTX_LDPC_N);
  let minErrors = FTX_LDPC_M;
  
  for (let iter = 0; iter < maxIters; iter++) {
    // Hard decision
    let plainSum = 0;
    for (let n = 0; n < FTX_LDPC_N; n++) {
      const sum = codeword[n] + tov[n][0] + tov[n][1] + tov[n][2];
      plain[n] = sum > 0 ? 1 : 0;
      plainSum += plain[n];
    }
    
    if (plainSum === 0) break;  // All zeros is invalid
    
    // Check for valid codeword
    const errors = ldpcCheck(plain);
    if (errors < minErrors) {
      minErrors = errors;
      if (errors === 0) break;  // Success!
    }
    
    // Messages from bits to check nodes
    for (let m = 0; m < FTX_LDPC_M; m++) {
      const numRows = LDPC_Num_rows[m];
      for (let nIdx = 0; nIdx < numRows; nIdx++) {
        const idx = LDPC_Nm[m][nIdx];
        if (idx === 0) continue;
        const n = idx - 1;
        
        let Tnm = codeword[n];
        for (let mIdx = 0; mIdx < 3; mIdx++) {
          if (LDPC_Mn[n][mIdx] - 1 !== m) {
            Tnm += tov[n][mIdx];
          }
        }
        toc[m][nIdx] = fastTanh(-Tnm / 2);
      }
    }
    
    // Messages from check nodes to variable nodes
    for (let n = 0; n < FTX_LDPC_N; n++) {
      for (let mIdx = 0; mIdx < 3; mIdx++) {
        const m = LDPC_Mn[n][mIdx] - 1;
        const numRows = LDPC_Num_rows[m];
        
        let Tmn = 1.0;
        for (let nIdx = 0; nIdx < numRows; nIdx++) {
          const idx = LDPC_Nm[m][nIdx];
          if (idx > 0 && idx - 1 !== n) {
            Tmn *= toc[m][nIdx];
          }
        }
        tov[n][mIdx] = -2 * fastAtanh(Tmn);
      }
    }
  }
  
  return { plain, errors: minErrors };
}

// ============================================================================
// Symbol Extraction
// ============================================================================

function extractSymbol(wf, candidate, symbolIdx) {
  const { timeOffset, baseFreqHz } = candidate;
  const blockAbs = timeOffset + symbolIdx;
  
  if (blockAbs < 0 || blockAbs >= wf.numBlocks) {
    return [0, 0, 0];  // Out of bounds
  }
  
  // Get magnitudes for all 8 tones (using Gray code mapping)
  // Gray code maps 3-bit values to tone indices to minimize bit errors
  const s2 = new Float32Array(8);
  for (let j = 0; j < 8; j++) {
    // FT8_GRAY_MAP[j] gives the tone index for symbol value j
    const toneIdx = FT8_GRAY_MAP[j];
    const bin = toneToBin(wf, baseFreqHz, toneIdx);
    const mag = wf.getMag(blockAbs, 0, 0, bin);
    s2[j] = wf.magToDb(mag);
  }
  
  // Compute log-likelihoods for 3 bits using max approximation
  // Bit 0 (MSB): symbols 4-7 have bit0=1, symbols 0-3 have bit0=0
  // Bit 1: symbols 2,3,6,7 have bit1=1, symbols 0,1,4,5 have bit1=0
  // Bit 2 (LSB): symbols 1,3,5,7 have bit2=1, symbols 0,2,4,6 have bit2=0
  const logl = new Float32Array(3);
  logl[0] = Math.max(s2[4], s2[5], s2[6], s2[7]) - Math.max(s2[0], s2[1], s2[2], s2[3]);
  logl[1] = Math.max(s2[2], s2[3], s2[6], s2[7]) - Math.max(s2[0], s2[1], s2[4], s2[5]);
  logl[2] = Math.max(s2[1], s2[3], s2[5], s2[7]) - Math.max(s2[0], s2[2], s2[4], s2[6]);
  
  return logl;
}

function extractLikelihood(wf, candidate) {
  const log174 = new Float32Array(FTX_LDPC_N);
  
  // FT8 message structure: 7 sync + 29 data + 7 sync + 29 data + 7 sync = 79 symbols
  // Data symbols are at positions: 7-35 and 43-71
  for (let k = 0; k < FT8_ND; k++) {
    // Calculate symbol index, skipping sync blocks
    // First 29 data symbols: positions 7-35 (after first sync)
    // Second 29 data symbols: positions 43-71 (after second sync)
    const symIdx = k + (k < 29 ? 7 : 14);
    const bitIdx = 3 * k;
    
    const logl = extractSymbol(wf, candidate, symIdx);
    log174[bitIdx + 0] = logl[0];
    log174[bitIdx + 1] = logl[1];
    log174[bitIdx + 2] = logl[2];
  }
  
  // Normalize log-likelihoods for LDPC decoder
  let sum = 0, sum2 = 0;
  for (let i = 0; i < FTX_LDPC_N; i++) {
    sum += log174[i];
    sum2 += log174[i] * log174[i];
  }
  const invN = 1.0 / FTX_LDPC_N;
  const variance = (sum2 - sum * sum * invN) * invN;
  
  if (variance > 0.001) {
    const normFactor = Math.sqrt(24.0 / variance);
    for (let i = 0; i < FTX_LDPC_N; i++) {
      log174[i] *= normFactor;
    }
  }
  
  return log174;
}

// ============================================================================
// CRC-14 for FT8
// ============================================================================

function computeCRC(message, numBits) {
  // CRC-14 computation as per FT8 spec
  const TOPBIT = 1 << 13;  // 0x2000
  let remainder = 0;
  let idxByte = 0;
  
  for (let idxBit = 0; idxBit < numBits; idxBit++) {
    if (idxBit % 8 === 0) {
      // Bring next byte into remainder (shifted to align with 14-bit CRC)
      remainder ^= (message[idxByte++] || 0) << 6;
    }
    
    // Process one bit
    if (remainder & TOPBIT) {
      remainder = ((remainder << 1) ^ FT8_CRC_POLYNOMIAL) & 0x3FFF;
    } else {
      remainder = (remainder << 1) & 0x3FFF;
    }
  }
  
  return remainder & 0x3FFF;
}

function extractCRC(a91) {
  // CRC is stored in bits 77-90 of the 91-bit payload
  // a91[9] has bits 72-79, we need bits 77-79 (& 0x07)
  // a91[10] has bits 80-87
  // a91[11] has bits 88-90 in the top 3 bits (>> 5)
  if (a91.length < 12) return 0;
  return ((a91[9] & 0x07) << 11) | ((a91[10] || 0) << 3) | ((a91[11] || 0) >> 5);
}

// ============================================================================
// Message Unpacking
// ============================================================================

function packBits(bitArray, numBits) {
  // We need 12 bytes to hold 91 bits + have room for CRC extraction
  const numBytes = 12;  // Always use 12 bytes for FT8
  const packed = new Uint8Array(numBytes);
  
  for (let i = 0; i < numBits && i < bitArray.length; i++) {
    if (bitArray[i]) {
      packed[Math.floor(i / 8)] |= (0x80 >> (i % 8));
    }
  }
  
  return packed;
}

function charn(index, table) {
  if (index >= 0 && index < table.length) {
    return table[index];
  }
  return '?';
}

function unpackCallsign(n28, i3) {
  const NTOKENS = 2063592;
  const MAX22 = 4194304;
  
  if (n28 < NTOKENS) {
    if (n28 === 0) return 'DE';
    if (n28 === 1) return 'QRZ';
    if (n28 === 2) return 'CQ';
    if (n28 <= 1002) {
      const num = n28 - 3;
      return `CQ ${num.toString().padStart(3, '0')}`;
    }
    if (n28 <= 532443) {
      let n = n28 - 1003;
      let result = '';
      for (let i = 3; i >= 0; i--) {
        const ch = charn(n % 27, ' ABCDEFGHIJKLMNOPQRSTUVWXYZ');
        result = ch + result;
        n = Math.floor(n / 27);
      }
      return 'CQ ' + result.trim();
    }
    return '<...>';
  }
  
  n28 -= NTOKENS;
  
  if (n28 < MAX22) {
    // Hash lookup would go here
    return '<...>';
  }
  
  // Standard callsign
  let n = n28 - MAX22;
  const callsign = new Array(6);
  
  callsign[5] = charn(n % 27, ' ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  n = Math.floor(n / 27);
  callsign[4] = charn(n % 27, ' ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  n = Math.floor(n / 27);
  callsign[3] = charn(n % 27, ' ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  n = Math.floor(n / 27);
  callsign[2] = charn(n % 10, '0123456789');
  n = Math.floor(n / 10);
  callsign[1] = charn(n % 36, '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  n = Math.floor(n / 36);
  callsign[0] = charn(n % 37, ' 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  
  return callsign.join('').trim();
}

function unpackGrid(igrid4, ir) {
  const MAXGRID4 = 32400;
  
  if (igrid4 <= MAXGRID4) {
    let n = igrid4;
    const grid = new Array(4);
    grid[3] = String.fromCharCode(48 + (n % 10));
    n = Math.floor(n / 10);
    grid[2] = String.fromCharCode(48 + (n % 10));
    n = Math.floor(n / 10);
    grid[1] = String.fromCharCode(65 + (n % 18));
    n = Math.floor(n / 18);
    grid[0] = String.fromCharCode(65 + (n % 18));
    
    const prefix = ir > 0 ? 'R ' : '';
    return prefix + grid.join('');
  }
  
  const irpt = igrid4 - MAXGRID4;
  
  switch (irpt) {
    case 1: return '';
    case 2: return 'RRR';
    case 3: return 'RR73';
    case 4: return '73';
    default:
      const signedRpt = irpt - 35;
      const prefix = ir > 0 ? 'R' : '';
      const sign = signedRpt >= 0 ? '+' : '';
      return prefix + sign + signedRpt;
  }
}

function unpackFreeText(payload) {
  const b71 = new Uint8Array(9);
  
  // Extract 71 bits (shift right by 1)
  for (let i = 0; i < 9; i++) {
    b71[i] = ((payload[i] >> 1) | ((i > 0 ? payload[i - 1] & 1 : 0) << 7));
  }
  
  const text = new Array(13);
  for (let idx = 12; idx >= 0; idx--) {
    let rem = 0;
    for (let i = 0; i < 9; i++) {
      rem = (rem << 8) | b71[i];
      b71[i] = Math.floor(rem / 42);
      rem = rem % 42;
    }
    text[idx] = charn(rem, CHAR_TABLE_FULL);
  }
  
  return text.join('').trim();
}

export function unpackMessage(payload) {
  // Get message type (i3.n3)
  const i3 = (payload[9] >> 3) & 0x07;
  const n3 = ((payload[8] << 2) & 0x04) | ((payload[9] >> 6) & 0x03);
  
  if (i3 === 0 && n3 === 0) {
    // Free text
    return unpackFreeText(payload);
  }
  
  if (i3 === 0 && n3 === 5) {
    // Telemetry
    const hex = Array.from(payload.slice(0, 9))
      .map(b => b.toString(16).padStart(2, '0').toUpperCase())
      .join('');
    return hex.slice(0, 18);
  }
  
  if (i3 === 1 || i3 === 2) {
    // Standard message
    let n29a = (payload[0] << 21) | (payload[1] << 13) | (payload[2] << 5) | (payload[3] >> 3);
    let n29b = ((payload[3] & 0x07) << 26) | (payload[4] << 18) | (payload[5] << 10) | 
               (payload[6] << 2) | (payload[7] >> 6);
    const ir = (payload[7] >> 5) & 0x01;
    let igrid4 = ((payload[7] & 0x1F) << 10) | (payload[8] << 2) | (payload[9] >> 6);
    
    const n28a = n29a >> 1;
    const n28b = n29b >> 1;
    
    const call1 = unpackCallsign(n28a, i3);
    const call2 = unpackCallsign(n28b, i3);
    const extra = unpackGrid(igrid4, ir);
    
    const parts = [call1, call2];
    if (extra) parts.push(extra);
    
    return parts.join(' ');
  }
  
  return `[Type ${i3}.${n3}]`;
}

// ============================================================================
// Test/Debug Functions
// ============================================================================

export function testFFT() {
  console.log('=== Testing FFT ===');
  const fft = new FFT(256);
  
  // Generate a test signal: 100 Hz sine wave at 1000 Hz sample rate
  const sampleRate = 1000;
  const testFreq = 100;
  const input = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    input[i] = Math.sin(2 * Math.PI * testFreq * i / sampleRate);
  }
  
  const mags = fft.realTransform(input);
  
  // Expected peak at bin = testFreq * N / sampleRate = 100 * 256 / 1000 = 25.6
  let maxMag = 0, maxBin = 0;
  for (let i = 0; i < mags.length; i++) {
    if (mags[i] > maxMag) {
      maxMag = mags[i];
      maxBin = i;
    }
  }
  
  const expectedBin = Math.round(testFreq * 256 / sampleRate);
  console.log(`Test signal: ${testFreq}Hz sine, expected bin=${expectedBin}, found bin=${maxBin}, mag=${maxMag.toFixed(1)}`);
  
  if (Math.abs(maxBin - expectedBin) <= 1 && maxMag > 50) {
    console.log('FFT test PASSED ✓');
    return true;
  } else {
    console.log('FFT test FAILED ✗');
    return false;
  }
}

// ============================================================================
// Main Decoder
// ============================================================================

export class FT8Decoder {
  constructor(config = {}) {
    this.sampleRate = config.sampleRate || FT8_SAMPLE_RATE;
    this.symbolPeriod = FT8_SYMBOL_PERIOD;
    this.blockSize = Math.floor(this.sampleRate * this.symbolPeriod);
    
    this.waterfall = new FT8Waterfall(config);
    this.minScore = config.minScore || 2;  // Lower threshold to catch more signals
    this.maxCandidates = config.maxCandidates || 200;
    this.ldpcIterations = config.ldpcIterations || 40;  // More iterations for better error correction
    
    // Audio buffer for accumulating samples
    this.audioBuffer = new Float32Array(this.blockSize * 2);
    this.bufferWritePos = 0;
    
    this.decodedMessages = [];
    this.onMessage = config.onMessage || (() => {});
    
    console.log(`FT8Decoder created: blockSize=${this.blockSize}, sampleRate=${this.sampleRate}`);
  }
  
  reset() {
    this.waterfall.reset();
    this.audioBuffer = new Float32Array(this.blockSize * 2);  // Ring buffer
    this.bufferWritePos = 0;
  }
  
  // Add audio samples to buffer (optimized for real-time)
  addSamples(samples) {
    // Simple circular buffer approach
    for (let i = 0; i < samples.length; i++) {
      this.audioBuffer[this.bufferWritePos++] = samples[i];
      
      // When we have a complete block, process it
      if (this.bufferWritePos >= this.blockSize) {
        // Process the block (create a copy for FFT)
        const block = this.audioBuffer.slice(0, this.blockSize);
        this.waterfall.processBlock(block);
        
        // Shift remaining samples to start
        const remaining = this.bufferWritePos - this.blockSize;
        for (let j = 0; j < remaining; j++) {
          this.audioBuffer[j] = this.audioBuffer[this.blockSize + j];
        }
        this.bufferWritePos = remaining;
      }
    }
  }
  
  // Decode all messages in the waterfall
  decode() {
    const messages = [];
    
    // Find sync candidates
    const candidates = findCandidates(this.waterfall, this.maxCandidates, this.minScore);
    
    if (candidates.length === 0) {
      return messages;
    }
    
    // Track already decoded messages (by hash)
    const decoded = new Set();
    let ldpcFails = 0;
    let crcFails = 0;
    
    for (let ci = 0; ci < candidates.length; ci++) {
      const candidate = candidates[ci];
      
      // Extract log-likelihoods
      const log174 = extractLikelihood(this.waterfall, candidate);
      
      // LDPC decode
      const { plain, errors } = bpDecode(log174, this.ldpcIterations);
      
      if (errors > 0) {
        ldpcFails++;
        continue;
      }
      
      // Pack bits into bytes
      const a91 = packBits(plain, FTX_LDPC_K);
      
      // Extract and verify CRC
      const crcExtracted = extractCRC(a91);
      
      // Zero out CRC bits for calculation
      const a91Copy = new Uint8Array(a91);
      a91Copy[9] &= 0xF8;
      a91Copy[10] = 0;
      
      const crcCalculated = computeCRC(a91Copy, 82);
      
      if (crcExtracted !== crcCalculated) {
        crcFails++;
        continue;
      }
      
      // Check for duplicate
      const msgHash = a91.slice(0, 10).join(',');
      if (decoded.has(msgHash)) continue;
      decoded.add(msgHash);
      
      // Unpack message
      const text = unpackMessage(a91);
      
      // Calculate frequency and time
      const freqHz = candidate.baseFreqHz;
      const time = candidate.timeOffset * this.symbolPeriod;
      const snr = candidate.score * 0.5;  // Approximate SNR
      
      const message = {
        text,
        freq: Math.round(freqHz),
        time: time.toFixed(2),
        snr: snr.toFixed(1),
        candidate
      };
      
      messages.push(message);
      this.onMessage(message);
    }
    
    return messages;
  }
  
  // Get waterfall data for visualization
  getWaterfallData() {
    const width = this.waterfall.numBins;
    const height = this.waterfall.numBlocks;
    const data = new Uint8Array(width * height);
    
    for (let block = 0; block < height; block++) {
      for (let bin = 0; bin < width; bin++) {
        const mag = this.waterfall.getMag(block, 0, 0, bin);
        data[block * width + bin] = mag;
      }
    }
    
    return { data, width, height };
  }
}

// ============================================================================
// Audio Resampler with anti-aliasing filter
// ============================================================================

export class AudioResampler {
  constructor(inputRate, outputRate) {
    this.inputRate = inputRate;
    this.outputRate = outputRate;
    this.ratio = outputRate / inputRate;
    this.decimation = Math.round(inputRate / outputRate);
    
    // For 48kHz -> 12kHz (4:1 decimation), use averaging
    // This acts as a simple low-pass filter to prevent aliasing
    console.log(`Resampler: ${inputRate}Hz -> ${outputRate}Hz (${this.decimation}:1 decimation)`);
  }
  
  resample(input) {
    if (this.inputRate === this.outputRate) {
      return input;
    }
    
    // Use decimation with averaging for anti-aliasing
    const outputLength = Math.floor(input.length / this.decimation);
    const output = new Float32Array(outputLength);
    
    for (let i = 0; i < outputLength; i++) {
      // Average 'decimation' samples together
      let sum = 0;
      const startIdx = i * this.decimation;
      for (let j = 0; j < this.decimation && (startIdx + j) < input.length; j++) {
        sum += input[startIdx + j];
      }
      output[i] = sum / this.decimation;
    }
    
    return output;
  }
}
