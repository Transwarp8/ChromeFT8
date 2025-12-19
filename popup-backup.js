/**
 * FT8 Browser Decoder - Popup UI Controller
 */

import { FT8Decoder, AudioResampler, FT8_SAMPLE_RATE, FT8_SLOT_TIME, testFFT } from './ft8-decoder.js';

// ============================================================================
// State
// ============================================================================

let decoder = null;
let audioContext = null;
let mediaStream = null;
let processorNode = null;
let analyserNode = null;
let resampler = null;
let isCapturing = false;
let decodedCount = 0;
let slotStartTime = null;
let animationFrame = null;
let lastDecodeSlot = -1;

// Waterfall scrolling buffer
let waterfallImageData = null;
let waterfallWidth = 0;
let waterfallHeight = 0;

// ============================================================================
// DOM Elements
// ============================================================================

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const clearBtn = document.getElementById('clearBtn');
const statusText = document.getElementById('statusText');
const sampleRateText = document.getElementById('sampleRateText');
const decodedCountEl = document.getElementById('decodedCount');
const waterfallCanvas = document.getElementById('waterfallCanvas');
const messagesList = document.getElementById('messagesList');
const slotProgressBar = document.getElementById('slotProgressBar');
const slotTimeEl = document.getElementById('slotTime');
const slotPhaseEl = document.getElementById('slotPhase');
const filterCQ = document.getElementById('filterCQ');
const filterAll = document.getElementById('filterAll');

const ctx = waterfallCanvas.getContext('2d');

// ============================================================================
// Waterfall Color Palette
// ============================================================================

// Pre-computed RGB values for waterfall colors
const WATERFALL_RGB = [];

function initWaterfallColors() {
  for (let i = 0; i < 256; i++) {
    let r, g, b;
    if (i < 64) {
      // Black to dark blue
      r = 0;
      g = 0;
      b = Math.floor(i * 2);
    } else if (i < 128) {
      // Dark blue to cyan
      r = 0;
      g = Math.floor((i - 64) * 4);
      b = 128 + Math.floor((i - 64) * 2);
    } else if (i < 192) {
      // Cyan to yellow
      r = Math.floor((i - 128) * 4);
      g = 255;
      b = 255 - Math.floor((i - 128) * 4);
    } else {
      // Yellow to red
      r = 255;
      g = 255 - Math.floor((i - 192) * 4);
      b = 0;
    }
    WATERFALL_RGB.push([r, g, b]);
  }
}

initWaterfallColors();

// ============================================================================
// Waterfall Visualization
// ============================================================================

function initWaterfallBuffer() {
  waterfallWidth = waterfallCanvas.width;
  waterfallHeight = waterfallCanvas.height;
  waterfallImageData = ctx.createImageData(waterfallWidth, waterfallHeight);
  
  // Fill with dark background
  for (let i = 0; i < waterfallImageData.data.length; i += 4) {
    waterfallImageData.data[i] = 10;
    waterfallImageData.data[i + 1] = 14;
    waterfallImageData.data[i + 2] = 20;
    waterfallImageData.data[i + 3] = 255;
  }
}

function drawWaterfallLine(frequencyData) {
  if (!waterfallImageData) return;
  
  // Use TypedArray's copyWithin for fast scrolling (much faster than loops)
  const data = waterfallImageData.data;
  const lineSize = waterfallWidth * 4;
  
  // Copy all data down by one line
  data.copyWithin(lineSize, 0, data.length - lineSize);
  
  // Draw new line at top (first row)
  const numBins = frequencyData.length;
  for (let x = 0; x < waterfallWidth; x++) {
    const binIndex = Math.floor(x * numBins / waterfallWidth);
    const value = frequencyData[binIndex] || 0;
    
    // Scale value (0-255 from analyser, but typically 0-200 range)
    const scaled = Math.min(255, Math.max(0, Math.floor(value * 1.3)));
    const [r, g, b] = WATERFALL_RGB[scaled];
    
    const idx = x * 4;
    data[idx] = r;
    data[idx + 1] = g;
    data[idx + 2] = b;
    data[idx + 3] = 255;
  }
  
  ctx.putImageData(waterfallImageData, 0, 0);
}

function drawWaterfallFromDecoder() {
  if (!decoder) return;
  
  const wf = decoder.waterfall;
  if (wf.numBlocks === 0) return;
  
  const width = waterfallCanvas.width;
  const height = waterfallCanvas.height;
  const numBins = wf.numBins;
  const numBlocks = wf.numBlocks;
  
  // Use ImageData for fast pixel manipulation
  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;
  
  // Scale factors
  const xScale = numBins / width;
  const yScale = numBlocks / height;
  
  // Fill pixel by pixel
  for (let y = 0; y < height; y++) {
    const block = Math.floor(y * yScale);
    for (let x = 0; x < width; x++) {
      const bin = Math.floor(x * xScale);
      
      const mag = wf.getMag(block, 0, 0, bin);
      const colorIdx = Math.min(255, Math.max(0, Math.floor(mag)));
      const [r, g, b] = WATERFALL_RGB[colorIdx];
      
      const idx = (y * width + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }
  
  ctx.putImageData(imageData, 0, 0);
}

// ============================================================================
// Message Display
// ============================================================================

function clearMessages() {
  messagesList.innerHTML = `
    <div class="empty-state">
      <span class="empty-icon">📻</span>
      <p>No messages decoded yet</p>
      <p class="hint">Click Start to begin decoding FT8 signals from browser audio</p>
    </div>
  `;
  decodedCount = 0;
  decodedCountEl.textContent = '0';
}

function addMessage(msg) {
  // Remove empty state if present
  const emptyState = messagesList.querySelector('.empty-state');
  if (emptyState) {
    emptyState.remove();
  }
  
  // Check filters
  const isCQ = msg.text.includes('CQ');
  if (filterCQ.checked && !filterAll.checked && !isCQ) {
    return;
  }
  
  // Format time
  const now = new Date();
  const timeStr = now.toTimeString().slice(0, 8);
  
  // Create message row
  const row = document.createElement('div');
  row.className = `message-row ${isCQ ? 'cq' : 'reply'}`;
  
  // Highlight callsigns and grids in the message
  const formattedText = formatMessageText(msg.text);
  
  row.innerHTML = `
    <span class="msg-time">${timeStr}</span>
    <span class="msg-snr">${msg.snr > 0 ? '+' : ''}${msg.snr}</span>
    <span class="msg-freq">${msg.freq}</span>
    <span class="msg-text">${formattedText}</span>
  `;
  
  // Add to top of list
  messagesList.insertBefore(row, messagesList.firstChild);
  
  // Update count
  decodedCount++;
  decodedCountEl.textContent = decodedCount.toString();
  
  // Limit messages shown
  while (messagesList.children.length > 100) {
    messagesList.removeChild(messagesList.lastChild);
  }
}

function formatMessageText(text) {
  // Simple callsign pattern
  const callsignPattern = /\b([A-Z0-9]{1,3}[0-9][A-Z0-9]{0,3}[A-Z](?:\/[A-Z0-9]+)?)\b/g;
  // Grid pattern
  const gridPattern = /\b([A-R]{2}[0-9]{2})\b/g;
  
  let formatted = text
    .replace(callsignPattern, '<span class="callsign">$1</span>')
    .replace(gridPattern, '<span class="grid">$1</span>');
  
  return formatted;
}

// ============================================================================
// Time Slot Management
// ============================================================================

function updateSlotProgress() {
  const now = Date.now() / 1000;
  const slotPosition = now % FT8_SLOT_TIME;
  const progress = (slotPosition / FT8_SLOT_TIME) * 100;
  
  slotProgressBar.style.width = `${progress}%`;
  
  // Update time display
  const date = new Date();
  slotTimeEl.textContent = date.toTimeString().slice(0, 8);
  
  // Update phase (even/odd 15-second slots)
  const slotNumber = Math.floor(now / FT8_SLOT_TIME);
  const isEven = slotNumber % 2 === 0;
  slotPhaseEl.textContent = isEven ? 'Even' : 'Odd';
  slotPhaseEl.className = `slot-phase ${isEven ? '' : 'odd'}`;
  
  // Check for slot boundary - decode when we've collected enough data
  if (isCapturing && slotPosition < 1.0 && slotNumber !== lastDecodeSlot) {
    lastDecodeSlot = slotNumber;
    triggerDecode();
  }
}

function triggerDecode() {
  if (!decoder) return;
  
  const numBlocks = decoder.waterfall.numBlocks;
  
  if (numBlocks < 79) {
    console.log(`Incomplete slot: ${numBlocks}/79 blocks - resetting`);
    decoder.reset();
    return;
  }
  
  // Draw waterfall before decode
  drawWaterfallFromDecoder();
  
  const startTime = performance.now();
  const messages = decoder.decode();
  const elapsed = performance.now() - startTime;
  
  if (messages.length > 0) {
    console.log(`Decoded ${messages.length} message(s) in ${elapsed.toFixed(0)}ms`);
    messages.forEach(msg => {
      console.log(`  ${msg.freq}Hz: ${msg.text}`);
      addMessage(msg);
    });
  } else {
    console.log(`No decodes this slot (${numBlocks} blocks)`);
  }
  
  // Reset for next slot
  decoder.reset();
}

// ============================================================================
// Audio Capture
// ============================================================================

async function startCapture() {
  try {
    // Get the current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab) {
      throw new Error('No active tab found');
    }
    
    console.log('Capturing tab:', tab.title);
    
    // Request tab capture
    mediaStream = await new Promise((resolve, reject) => {
      chrome.tabCapture.capture({
        audio: true,
        video: false
      }, (stream) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (!stream) {
          reject(new Error('Failed to capture tab audio'));
        } else {
          resolve(stream);
        }
      });
    });
    
    console.log('Got media stream');
    
    // Create audio context - let browser choose sample rate
    audioContext = new AudioContext();
    const actualSampleRate = audioContext.sampleRate;
    
    console.log(`Audio context sample rate: ${actualSampleRate}`);
    sampleRateText.textContent = `${actualSampleRate} Hz`;
    
    // Create resampler if needed
    if (actualSampleRate !== FT8_SAMPLE_RATE) {
      resampler = new AudioResampler(actualSampleRate, FT8_SAMPLE_RATE);
      console.log(`Created resampler: ${actualSampleRate} -> ${FT8_SAMPLE_RATE}`);
    }
    
    // Create media stream source
    const source = audioContext.createMediaStreamSource(mediaStream);
    
    // Create analyser for visualization
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 2048;
    analyserNode.smoothingTimeConstant = 0.5;
    const frequencyData = new Uint8Array(analyserNode.frequencyBinCount);
    
    // Create script processor for raw sample access
    // Buffer size of 4096 at 48kHz = ~85ms of audio
    const bufferSize = 4096;
    processorNode = audioContext.createScriptProcessor(bufferSize, 1, 1);
    
    let sampleCount = 0;
    
    let audioCallbackCount = 0;
    let maxInputLevel = 0;
    
    processorNode.onaudioprocess = (event) => {
      try {
        // IMPORTANT: Copy input to output to keep audio playing!
        const inputData = event.inputBuffer.getChannelData(0);
        const outputData = event.outputBuffer.getChannelData(0);
        outputData.set(inputData);
        
        if (!isCapturing || !decoder) return;
        
        audioCallbackCount++;
        
        // Check input level
        let maxAbs = 0;
        for (let i = 0; i < inputData.length; i++) {
          const abs = Math.abs(inputData[i]);
          if (abs > maxAbs) maxAbs = abs;
        }
        if (maxAbs > maxInputLevel) maxInputLevel = maxAbs;
        
        // Make a copy for processing
        let samples = new Float32Array(inputData);
        
        // Resample if needed (48kHz -> 12kHz)
        if (resampler) {
          samples = resampler.resample(samples);
        }
        
        // Feed to decoder
        decoder.addSamples(samples);
        
        sampleCount += samples.length;
        
        // Log progress periodically (every ~15 seconds = one slot)
        if (sampleCount % (FT8_SAMPLE_RATE * 15) < samples.length) {
          console.log(`Audio capture: ${(sampleCount / FT8_SAMPLE_RATE).toFixed(0)}s, level=${maxInputLevel.toFixed(3)}`);
        }
      } catch (err) {
        console.error('Error in audio processing:', err);
      }
    };
    
    // Connect audio graph:
    // source -> analyser -> processor -> destination
    source.connect(analyserNode);
    analyserNode.connect(processorNode);
    processorNode.connect(audioContext.destination);
    
    // Initialize decoder
    decoder = new FT8Decoder({
      sampleRate: FT8_SAMPLE_RATE,
      onMessage: (msg) => addMessage(msg)
    });
    
    isCapturing = true;
    slotStartTime = Date.now();
    lastDecodeSlot = -1;
    
    // Initialize waterfall buffer
    initWaterfallBuffer();
    
    // Animation loop for waterfall and slot progress (runs at ~20fps for efficiency)
    let lastWaterfallUpdate = 0;
    function animate(timestamp) {
      if (!isCapturing) return;
      
      updateSlotProgress();
      
      // Update waterfall visualization from analyser (20fps max for efficiency)
      if (timestamp - lastWaterfallUpdate > 50) {
        try {
          analyserNode.getByteFrequencyData(frequencyData);
          
          // Only draw the frequency range we care about (200-3000 Hz)
          const binWidth = actualSampleRate / analyserNode.fftSize;
          const minBin = Math.floor(200 / binWidth);
          const maxBin = Math.ceil(3000 / binWidth);
          const relevantData = frequencyData.slice(minBin, maxBin);
          
          drawWaterfallLine(relevantData);
        } catch (err) {
          console.error('Error drawing waterfall:', err);
        }
        lastWaterfallUpdate = timestamp;
      }
      
      animationFrame = requestAnimationFrame(animate);
    }
    animate(0);
    
    // Update UI
    startBtn.disabled = true;
    stopBtn.disabled = false;
    statusText.textContent = 'Recording';
    statusText.className = 'status-value status-running';
    waterfallCanvas.classList.add('recording');
    
    console.log('Audio capture started successfully');
    
  } catch (error) {
    console.error('Failed to start capture:', error);
    statusText.textContent = 'Error: ' + error.message;
    statusText.className = 'status-value status-error';
    
    // Clean up on error
    stopCapture();
  }
}

function stopCapture() {
  console.log('Stopping capture...');
  isCapturing = false;
  
  // Final decode if we have data
  if (decoder && decoder.waterfall.numBlocks > 50) {
    console.log('Performing final decode...');
    triggerDecode();
  }
  
  // Clean up audio
  if (processorNode) {
    processorNode.disconnect();
    processorNode = null;
  }
  
  if (analyserNode) {
    analyserNode.disconnect();
    analyserNode = null;
  }
  
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }
  
  if (animationFrame) {
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }
  
  resampler = null;
  
  // Update UI
  startBtn.disabled = false;
  stopBtn.disabled = true;
  statusText.textContent = 'Stopped';
  statusText.className = 'status-value status-idle';
  waterfallCanvas.classList.remove('recording');
  
  console.log('Audio capture stopped');
}

// ============================================================================
// Event Handlers
// ============================================================================

startBtn.addEventListener('click', () => {
  startCapture();
});

stopBtn.addEventListener('click', () => {
  stopCapture();
});

clearBtn.addEventListener('click', () => {
  clearMessages();
  if (decoder) {
    decoder.reset();
  }
  initWaterfallBuffer();
  ctx.putImageData(waterfallImageData, 0, 0);
});

// Add double-click on waterfall to force decode (for testing)
waterfallCanvas.addEventListener('dblclick', () => {
  if (decoder) {
    console.log('Manual decode triggered by double-click');
    console.log(`Waterfall state: ${decoder.waterfall.numBlocks} blocks, maxMag=${decoder.waterfall.maxMag.toFixed(1)}dB`);
    
    // Show some waterfall data for debugging
    if (decoder.waterfall.numBlocks > 0) {
      const midBlock = Math.floor(decoder.waterfall.numBlocks / 2);
      const mags = [];
      for (let bin = 0; bin < Math.min(20, decoder.waterfall.numBins); bin++) {
        mags.push(decoder.waterfall.getMag(midBlock, 0, 0, bin));
      }
      console.log(`Sample magnitudes at block ${midBlock}: ${mags.join(', ')}`);
    }
    
    triggerDecode();
  }
});

// Filter change handlers
filterCQ.addEventListener('change', () => {
  if (filterCQ.checked) {
    filterAll.checked = false;
  }
});

filterAll.addEventListener('change', () => {
  if (filterAll.checked) {
    filterCQ.checked = true;
  }
});

// ============================================================================
// Initialization
// ============================================================================

function init() {
  console.log('=== FT8 Browser Decoder Starting ===');
  
  try {
    // Set canvas resolution (use integer dimensions)
    waterfallCanvas.width = 560;
    waterfallCanvas.height = 150;
    
    // Initialize waterfall buffer
    initWaterfallBuffer();
    ctx.putImageData(waterfallImageData, 0, 0);
    
    // Update slot time display
    updateSlotProgress();
    setInterval(updateSlotProgress, 100);
    
    // Run FFT test
    console.log('Running FFT test...');
    testFFT();
    
    console.log('FT8 Browser Decoder initialized successfully');
    console.log('Canvas size:', waterfallCanvas.width, 'x', waterfallCanvas.height);
  } catch (err) {
    console.error('Initialization error:', err);
  }
}

// Start initialization
console.log('popup.js loaded');
init();
