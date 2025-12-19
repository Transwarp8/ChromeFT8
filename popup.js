const FT8_SAMPLE_RATE = 12000;
const FT8_SLOT_TIME = 15.0;
const FT8_SYMBOL_PERIOD = 0.160;

const TIME_APIS = [
  { url: 'https://timeapi.io/api/Time/current/zone?timeZone=UTC', type: 'timeapi' }
];

const SYNC_SAMPLES = 5;

let audioContext = null;
let mediaStream = null;
let workletNode = null;
let analyserNode = null;
let isCapturing = false;
let decodedCount = 0;
let lastDecodeSlot = -1;

let slotAudioBuffer = [];
let slotSampleRate = 0;

let wasmDecoder = null;
let wasmInitialized = false;

let clockOffsetMs = 0;
let timeSynced = false;

let waterfallImageData = null;
let waterfallWidth = 0;
let waterfallHeight = 0;

let decodeLog = [];
let filterMode = 'all';

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const clearBtn = document.getElementById('clearBtn');
const exportBtn = document.getElementById('exportBtn');
const filterToggle = document.getElementById('filterToggle');
const statusText = document.getElementById('statusText');
const timeSyncStatus = document.getElementById('timeSyncStatus');
const decodedCountEl = document.getElementById('decodedCount');
const waterfallCanvas = document.getElementById('waterfallCanvas');
const messagesList = document.getElementById('messagesList');
const slotProgressBar = document.getElementById('slotProgressBar');
const slotTimeEl = document.getElementById('slotTime');
const slotPhaseEl = document.getElementById('slotPhase');
const clockOffsetEl = document.getElementById('clockOffset');
const sessionStatsEl = document.getElementById('sessionStats');

const ctx = waterfallCanvas.getContext('2d');

const WATERFALL_RGB = [];
for (let i = 0; i < 256; i++) {
  let r, g, b;
  if (i < 128) {
    r = Math.floor(i * 0.3);
    g = Math.floor(i * 0.4);
    b = Math.floor(i * 0.8);
  } else if (i < 200) {
    const t = (i - 128) / 72;
    r = Math.floor(38 + t * 160);
    g = Math.floor(51 + t * 160);
    b = Math.floor(102 + t * 100);
  } else {
    const t = (i - 200) / 55;
    r = Math.floor(198 + t * 57);
    g = Math.floor(211 + t * 44);
    b = Math.floor(202 - t * 50);
  }
  WATERFALL_RGB.push([r, g, b]);
}

async function syncTime() {
  timeSyncStatus.textContent = 'Syncing...';
  timeSyncStatus.className = 'status-value';
  
  const samples = [];
  
  for (const api of TIME_APIS) {
    for (let i = 0; i < SYNC_SAMPLES; i++) {
      try {
        const localBefore = Date.now();
        const response = await fetch(api.url, { cache: 'no-store' });
        const localAfter = Date.now();
        
        if (!response.ok) continue;
        
        const data = await response.json();
        const roundTrip = localAfter - localBefore;
        
        if (!data.dateTime) {
          continue;
        }
        const serverTime = new Date(data.dateTime + 'Z').getTime();
        
        const localMidpoint = localBefore + (roundTrip / 2);
        const offset = serverTime - localMidpoint;
        
        samples.push({ offset, roundTrip, api: api.type });
        
        await new Promise(r => setTimeout(r, 100));
        
      } catch (error) {
      }
    }
  }
  
  if (samples.length === 0) {
    timeSyncStatus.textContent = '⚠ Failed';
    timeSyncStatus.className = 'status-value status-warning';
    clockOffsetEl.textContent = '(no sync)';
    return false;
  }
  
  samples.sort((a, b) => a.roundTrip - b.roundTrip);
  
  const best = samples[0];
  
  const topSamples = samples.slice(0, Math.min(3, samples.length));
  const medianOffset = topSamples.map(s => s.offset).sort((a, b) => a - b)[Math.floor(topSamples.length / 2)];
  
  if (Math.abs(best.offset - medianOffset) > 500) {
    clockOffsetMs = medianOffset;
  } else {
    clockOffsetMs = best.offset;
  }
  
  timeSynced = true;
  const offsetSign = clockOffsetMs >= 0 ? '+' : '';
  const offsetSec = Math.abs(clockOffsetMs / 1000);
  
  let quality = '';
  if (best.roundTrip < 200) {
    quality = '✓✓';
  } else if (best.roundTrip < 500) {
    quality = '✓';
  } else {
    quality = '~';
  }
  
  timeSyncStatus.textContent = `${quality} ${offsetSign}${Math.round(clockOffsetMs)}ms`;
  timeSyncStatus.className = 'status-value status-synced';
  clockOffsetEl.textContent = `(Δ${offsetSign}${offsetSec.toFixed(2)}s, RTT:${best.roundTrip}ms)`;
  
  return true;
}

function getSyncedTime() {
  return Date.now() + clockOffsetMs;
}

async function initWasmDecoder() {
  if (wasmInitialized) return true;
  
  try {
    const wasmUrl = chrome.runtime.getURL('decode.wasm');
    const moduleScript = await import(chrome.runtime.getURL('ft8-wasm.js'));
    wasmDecoder = moduleScript;
    wasmInitialized = true;
    return true;
  } catch (error) {
    return false;
  }
}

async function decodeWithWasm(samples) {
  if (!wasmInitialized || !wasmDecoder) {
    return [];
  }
  
  try {
    const results = await wasmDecoder.decode(samples);
    return results.map(r => ({
      db: r.db,
      dt: r.dt,
      freq: r.df,
      text: r.text,
      snr: r.db
    }));
  } catch (error) {
    return [];
  }
}

class AudioResampler {
  constructor(inputRate, outputRate) {
    this.inputRate = inputRate;
    this.outputRate = outputRate;
    this.ratio = inputRate / outputRate;
  }
  
  resample(input) {
    if (this.inputRate === this.outputRate) {
      return input;
    }
    
    const outputLength = Math.floor(input.length / this.ratio);
    const output = new Float32Array(outputLength);
    
    for (let i = 0; i < outputLength; i++) {
      const srcStart = Math.floor(i * this.ratio);
      const srcEnd = Math.floor((i + 1) * this.ratio);
      let sum = 0;
      let count = 0;
      for (let j = srcStart; j < srcEnd && j < input.length; j++) {
        sum += input[j];
        count++;
      }
      output[i] = count > 0 ? sum / count : 0;
    }
    
    return output;
  }
}

function initWaterfallBuffer() {
  waterfallWidth = waterfallCanvas.width;
  waterfallHeight = waterfallCanvas.height;
  waterfallImageData = ctx.createImageData(waterfallWidth, waterfallHeight);
  
  for (let i = 0; i < waterfallImageData.data.length; i += 4) {
    waterfallImageData.data[i] = 10;
    waterfallImageData.data[i + 1] = 14;
    waterfallImageData.data[i + 2] = 20;
    waterfallImageData.data[i + 3] = 255;
  }
}

function drawWaterfallLine(frequencyData) {
  if (!waterfallImageData) return;
  
  const data = waterfallImageData.data;
  const lineSize = waterfallWidth * 4;
  
  data.copyWithin(lineSize, 0, data.length - lineSize);
  
  const numBins = frequencyData.length;
  for (let x = 0; x < waterfallWidth; x++) {
    const binIndex = Math.floor(x * numBins / waterfallWidth);
    const value = frequencyData[binIndex] || 0;
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

function clearMessages() {
  messagesList.innerHTML = `
    <div class="empty-state">
      <span class="empty-icon">📻</span>
      <p>No messages decoded yet</p>
      <p class="hint">Click Start to begin decoding FT8 signals from browser audio</p>
    </div>
  `;
  decodedCount = 0;
  decodeLog = [];
  decodedCountEl.textContent = '0';
  updateSessionStats();
}

function addMessage(msg) {
  const logEntry = {
    timestamp: new Date(getSyncedTime()).toISOString(),
    utc: new Date(getSyncedTime()).toUTCString(),
    freq: Math.round(msg.freq),
    snr: msg.snr,
    dt: msg.dt,
    text: msg.text || '',
    isCQ: (msg.text || '').toUpperCase().startsWith('CQ')
  };
  decodeLog.push(logEntry);
  
  if (filterMode === 'cq' && !logEntry.isCQ) {
    decodedCount++;
    decodedCountEl.textContent = decodedCount.toString();
    updateSessionStats();
    return;
  }
  
  const emptyState = messagesList.querySelector('.empty-state');
  if (emptyState) {
    emptyState.remove();
  }
  
  const msgEl = document.createElement('div');
  msgEl.className = 'message-item';
  if (logEntry.isCQ) msgEl.classList.add('cq');
  
  const timeStr = new Date(getSyncedTime()).toISOString().slice(11, 19);
  
  msgEl.innerHTML = `
    <span class="msg-time">${timeStr}</span>
    <span class="msg-freq">${logEntry.freq} Hz</span>
    <span class="msg-snr">${logEntry.snr > 0 ? '+' : ''}${Math.round(logEntry.snr)} dB</span>
    <span class="msg-text">${logEntry.text}</span>
  `;
  
  messagesList.insertBefore(msgEl, messagesList.firstChild);
  
  decodedCount++;
  decodedCountEl.textContent = decodedCount.toString();
  updateSessionStats();
  
  while (messagesList.children.length > 100) {
    messagesList.removeChild(messagesList.lastChild);
  }
}

function toggleFilter() {
  if (filterMode === 'all') {
    filterMode = 'cq';
    filterToggle.textContent = 'CQ Only';
    filterToggle.classList.add('cq-mode');
  } else {
    filterMode = 'all';
    filterToggle.textContent = 'All';
    filterToggle.classList.remove('cq-mode');
  }
  
  applyFilter();
}

function applyFilter() {
  const messages = messagesList.querySelectorAll('.message-item');
  messages.forEach(msg => {
    if (filterMode === 'cq') {
      if (msg.classList.contains('cq')) {
        msg.style.display = '';
      } else {
        msg.style.display = 'none';
      }
    } else {
      msg.style.display = '';
    }
  });
}

function updateSessionStats() {
  const cqCount = decodeLog.filter(e => e.isCQ).length;
  sessionStatsEl.textContent = `${decodeLog.length} decodes (${cqCount} CQ)`;
}

function exportDecodeLog() {
  if (decodeLog.length === 0) {
    alert('No decodes to export');
    return;
  }
  
  const headers = ['Timestamp', 'UTC', 'Frequency (Hz)', 'SNR (dB)', 'DT (s)', 'Message'];
  const rows = decodeLog.map(entry => [
    entry.timestamp,
    entry.utc,
    entry.freq,
    entry.snr,
    entry.dt ? entry.dt.toFixed(2) : '0.00',
    `"${entry.text.replace(/"/g, '""')}"`
  ]);
  
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ft8_decodes_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function updateSlotProgress() {
  const now = getSyncedTime() / 1000;
  const slotPosition = now % FT8_SLOT_TIME;
  const progress = (slotPosition / FT8_SLOT_TIME) * 100;
  
  slotProgressBar.style.width = `${progress}%`;
  
  const date = new Date(getSyncedTime());
  slotTimeEl.textContent = date.toISOString().slice(11, 19);
  
  const slotNumber = Math.floor(now / FT8_SLOT_TIME);
  const isEven = slotNumber % 2 === 0;
  slotPhaseEl.textContent = isEven ? 'EVEN' : 'ODD';
  slotPhaseEl.className = `slot-phase ${isEven ? '' : 'odd'}`;
  
  if (isCapturing && slotPosition < 1.0 && slotNumber !== lastDecodeSlot) {
    lastDecodeSlot = slotNumber;
    triggerDecode();
  }
}

async function triggerDecode() {
  if (slotAudioBuffer.length === 0) {
    slotAudioBuffer = [];
    return;
  }
  
  const totalSamples = slotAudioBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
  
  if (totalSamples < FT8_SAMPLE_RATE * 10) {
    slotAudioBuffer = [];
    return;
  }
  
  const merged = new Float32Array(totalSamples);
  let offset = 0;
  for (const chunk of slotAudioBuffer) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  
  let samples = merged;
  if (slotSampleRate !== FT8_SAMPLE_RATE) {
    const resampler = new AudioResampler(slotSampleRate, FT8_SAMPLE_RATE);
    samples = resampler.resample(merged);
  }
  
  slotAudioBuffer = [];
  
  const messages = await decodeWithWasm(samples);
  
  if (messages.length > 0) {
    messages.forEach(msg => {
      addMessage(msg);
    });
  }
}

async function startCapture() {
  try {
    statusText.textContent = 'Syncing time...';
    statusText.className = 'status-value';
    
    await syncTime();
    
    statusText.textContent = 'Loading decoder...';
    const wasmReady = await initWasmDecoder();
    if (!wasmReady) {
      statusText.textContent = 'WASM init failed';
      statusText.className = 'status-value status-error';
      return;
    }
    
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      throw new Error('No active tab found');
    }
    
    statusText.textContent = 'Capturing...';
    
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
    
    audioContext = new AudioContext();
    slotSampleRate = audioContext.sampleRate;
    
    statusText.textContent = 'Loading audio processor...';
    const processorUrl = chrome.runtime.getURL('audio-processor.js');
    await audioContext.audioWorklet.addModule(processorUrl);
    
    const source = audioContext.createMediaStreamSource(mediaStream);
    
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 2048;
    analyserNode.smoothingTimeConstant = 0.5;
    const frequencyData = new Uint8Array(analyserNode.frequencyBinCount);
    
    workletNode = new AudioWorkletNode(audioContext, 'ft8-audio-processor');
    
    workletNode.port.onmessage = (event) => {
      if (event.data.type === 'audio' && isCapturing) {
        slotAudioBuffer.push(new Float32Array(event.data.samples));
      }
    };
    
    source.connect(analyserNode);
    analyserNode.connect(workletNode);
    workletNode.connect(audioContext.destination);
    
    isCapturing = true;
    slotAudioBuffer = [];
    lastDecodeSlot = -1;
    
    initWaterfallBuffer();
    
    let lastWaterfallUpdate = 0;
    function animate(timestamp) {
      if (!isCapturing) return;
      
      updateSlotProgress();
      
      if (timestamp - lastWaterfallUpdate > 50) {
        try {
          analyserNode.getByteFrequencyData(frequencyData);
          const binWidth = slotSampleRate / analyserNode.fftSize;
          const minBin = Math.floor(200 / binWidth);
          const maxBin = Math.ceil(3000 / binWidth);
          const relevantData = frequencyData.slice(minBin, maxBin);
          drawWaterfallLine(relevantData);
        } catch (err) {
        }
        lastWaterfallUpdate = timestamp;
      }
      
      requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);
    
    startBtn.disabled = true;
    stopBtn.disabled = false;
    statusText.textContent = 'Recording';
    statusText.className = 'status-value status-running';
    waterfallCanvas.classList.add('recording');
    
  } catch (error) {
    statusText.textContent = 'Error: ' + error.message;
    statusText.className = 'status-value status-error';
    stopCapture();
  }
}

function stopCapture() {
  isCapturing = false;
  
  if (slotAudioBuffer.length > 0) {
    triggerDecode();
  }
  
  if (workletNode) {
    workletNode.port.close();
    workletNode.disconnect();
    workletNode = null;
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
  
  slotAudioBuffer = [];
  
  startBtn.disabled = false;
  stopBtn.disabled = true;
  statusText.textContent = 'Stopped';
  statusText.className = 'status-value status-idle';
  waterfallCanvas.classList.remove('recording');
}

startBtn.addEventListener('click', startCapture);
stopBtn.addEventListener('click', stopCapture);
clearBtn.addEventListener('click', clearMessages);
exportBtn.addEventListener('click', exportDecodeLog);
filterToggle.addEventListener('click', toggleFilter);

function init() {
  try {
    waterfallCanvas.width = 560;
    waterfallCanvas.height = 150;
    initWaterfallBuffer();
    ctx.putImageData(waterfallImageData, 0, 0);
    
    updateSlotProgress();
    setInterval(updateSlotProgress, 100);
    
    updateSessionStats();
  } catch (err) {
  }
}

init();
