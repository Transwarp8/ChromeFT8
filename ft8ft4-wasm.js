let Decoder = null;
let _initDecodeEx = null;
let _initDecode = null;
let _resetDecode = null;
let _addSamples = null;
let _execDecode = null;
let _getBlockSize = null;
let _getNumBlocks = null;
let _getMaxBlocks = null;
let _getProtocol = null;

const RESULT_SIZE = 4096;
let resultPtr = null;
let currentProtocol = 0;

async function initModule() {
    if (Decoder) return true;
    
    try {
        const modulePath = chrome.runtime.getURL('ft8ft4_decode.js');
        const module = await import(modulePath);
        const ModuleFactory = module.default;
        
        Decoder = await ModuleFactory({
            locateFile: (path) => chrome.runtime.getURL(path)
        });
        
        _initDecodeEx = Decoder.cwrap('init_decode_ex', 'number', ['number']);
        _initDecode = Decoder.cwrap('init_decode', 'number', []);
        _resetDecode = Decoder.cwrap('reset_decode', null, []);
        _addSamples = Decoder.cwrap('add_samples', 'number', ['number', 'number']);
        _execDecode = Decoder.cwrap('exec_decode', 'number', ['number', 'number', 'number']);
        _getBlockSize = Decoder.cwrap('get_block_size', 'number', []);
        _getNumBlocks = Decoder.cwrap('get_num_blocks', 'number', []);
        _getMaxBlocks = Decoder.cwrap('get_max_blocks', 'number', []);
        _getProtocol = Decoder.cwrap('get_protocol', 'number', []);
        
        resultPtr = Decoder._malloc(RESULT_SIZE);
        
        _initDecode();
        
        return true;
    } catch (e) {
        console.error('Failed to initialize FT8/FT4 WASM decoder:', e);
        return false;
    }
}

function setProtocol(protocol) {
    if (!Decoder) return false;
    
    const protoNum = (protocol === 'FT4') ? 1 : 0;
    if (protoNum !== currentProtocol) {
        currentProtocol = protoNum;
        _initDecodeEx(protoNum);
    }
    return true;
}

function getProtocol() {
    if (!Decoder) return 'FT8';
    return _getProtocol() === 1 ? 'FT4' : 'FT8';
}

function reset() {
    if (!Decoder) return;
    _resetDecode();
}

function getBlockSize() {
    if (!Decoder) return 1920;
    return _getBlockSize();
}

function getNumBlocks() {
    if (!Decoder) return 0;
    return _getNumBlocks();
}

function getMaxBlocks() {
    if (!Decoder) return 0;
    return _getMaxBlocks();
}

function addSamples(samples) {
    if (!Decoder || !samples || samples.length === 0) return false;
    
    const inputPtr = Decoder._malloc(samples.length * 4);
    Decoder.HEAPF32.set(samples, inputPtr / 4);
    
    const result = _addSamples(inputPtr, samples.length);
    
    Decoder._free(inputPtr);
    return result === 1;
}

async function decode(audio12k) {
    if (!Decoder) {
        const ok = await initModule();
        if (!ok) return [];
    }
    
    if (!audio12k || audio12k.length === 0) return [];
    
    reset();
    
    const blockSize = getBlockSize();
    let offset = 0;
    
    while (offset + blockSize <= audio12k.length) {
        const block = audio12k.subarray(offset, offset + blockSize);
        addSamples(block);
        offset += blockSize;
    }
    
    for (let i = 0; i < RESULT_SIZE; i++) {
        Decoder.HEAPU8[resultPtr + i] = 0;
    }
    
    const numDecoded = _execDecode(0, 0, resultPtr);
    
    if (numDecoded === 0) return [];
    
    const rawResult = new Uint8Array(Decoder.HEAPU8.buffer, resultPtr, RESULT_SIZE);
    const decoder = new TextDecoder('utf8');
    const resultStr = decoder.decode(rawResult).replace(/\x00/g, '').trim();
    
    if (!resultStr) return [];
    
    const results = resultStr.split('\n')
        .filter(row => row.length > 0)
        .map(row => {
            const parts = row.split(',');
            if (parts.length >= 4) {
                return {
                    db: parseInt(parts[0], 10),
                    dt: parseFloat(parts[1]),
                    df: parseFloat(parts[2]),
                    text: parts.slice(3).join(',').trim()
                };
            }
            return null;
        })
        .filter(r => r !== null);
    
    return results;
}

export { initModule, setProtocol, getProtocol, reset, getBlockSize, addSamples, decode };
