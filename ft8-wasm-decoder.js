/**
 * FT8 WASM Decoder Wrapper
 * Uses the ft8js WASM module for FT8 decoding
 */

// The decode module from ft8js
let wasmModule = null;
let decoder = null;
let decodeFunc = null;
let resultPtr = null;
let isInitialized = false;
let initPromise = null;

const SAMPLE_RATE = 12000;
const RESULT_SIZE = 4096;

/**
 * Initialize the WASM decoder
 */
export async function initDecoder() {
  if (isInitialized) return true;
  if (initPromise) return initPromise;
  
  initPromise = (async () => {
    try {
      console.log('Loading FT8 WASM decoder...');
      
      // Fetch the WASM binary
      const wasmUrl = chrome.runtime.getURL('decode.wasm');
      const wasmResponse = await fetch(wasmUrl);
      const wasmBinary = await wasmResponse.arrayBuffer();
      
      // Create the module configuration
      const moduleConfig = {
        wasmBinary: wasmBinary,
        locateFile: (path) => {
          if (path.endsWith('.wasm')) {
            return chrome.runtime.getURL(path);
          }
          return path;
        }
      };
      
      // Dynamically import and initialize the WASM module
      // We need to inline the essential parts since import.meta.url doesn't work
      wasmModule = await createFT8DecodeModule(moduleConfig);
      
      // Initialize the decoder
      const _initDecode = wasmModule.cwrap("init_decode", "number", [], []);
      decodeFunc = wasmModule.cwrap("exec_decode", "number", ["number", "number", "number"], { async: true });
      
      resultPtr = wasmModule._malloc(RESULT_SIZE);
      decoder = _initDecode();
      
      isInitialized = true;
      console.log('FT8 WASM decoder initialized successfully');
      return true;
    } catch (error) {
      console.error('Failed to initialize FT8 WASM decoder:', error);
      throw error;
    }
  })();
  
  return initPromise;
}

/**
 * Decode FT8 signals from audio samples
 * @param {Float32Array} samples - Audio samples at 12000 Hz
 * @returns {Promise<Array<{db: number, dt: number, df: number, text: string}>>}
 */
export async function decode(samples) {
  if (!isInitialized) {
    await initDecoder();
  }
  
  if (!wasmModule || !decodeFunc) {
    throw new Error('WASM decoder not initialized');
  }
  
  // Allocate memory for input samples
  const inputPtr = wasmModule._malloc(samples.length * samples.BYTES_PER_ELEMENT);
  wasmModule.HEAPF32.set(samples, inputPtr / samples.BYTES_PER_ELEMENT);
  
  try {
    // Call the decode function
    await decodeFunc(decoder, inputPtr, resultPtr);
    
    // Parse the results (CSV format: db,dt,df,text)
    const rawResult = new Uint8Array(wasmModule.HEAPU8.buffer, resultPtr, RESULT_SIZE);
    const textDecoder = new TextDecoder("utf8");
    const resultStr = textDecoder
      .decode(rawResult)
      .replaceAll("\x00", "")
      .trim();
    
    if (!resultStr) {
      return [];
    }
    
    const results = resultStr
      .split("\n")
      .filter(row => row.length > 0)
      .map(row => {
        const parts = row.split(",");
        return {
          db: Number(parts[0]),
          dt: Number(parts[1]),
          df: Number(parts[2]),
          text: parts[3] || ''
        };
      });
    
    return results;
  } finally {
    // Free input memory
    wasmModule._free(inputPtr);
  }
}

/**
 * Minimal Emscripten module factory for FT8 decode
 * This is a simplified version that works in Chrome extensions
 */
async function createFT8DecodeModule(config = {}) {
  const Module = {
    wasmBinary: config.wasmBinary,
    locateFile: config.locateFile,
    ready: null
  };
  
  // Set up ready promise
  let readyResolve, readyReject;
  Module.ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  
  try {
    // Compile and instantiate the WASM module
    const wasmImports = {
      env: {
        memory: new WebAssembly.Memory({ initial: 256, maximum: 2048 }),
        __indirect_function_table: new WebAssembly.Table({ initial: 0, element: 'anyfunc' }),
        emscripten_resize_heap: () => false,
        emscripten_memcpy_js: (dest, src, num) => {
          Module.HEAPU8.copyWithin(dest, src, src + num);
        },
        _emscripten_get_now: () => performance.now(),
        abort: (what) => { throw new Error('abort: ' + what); }
      },
      wasi_snapshot_preview1: {
        fd_close: () => 0,
        fd_write: () => 0,
        fd_seek: () => 0,
        fd_read: () => 0,
        proc_exit: () => {}
      }
    };
    
    // Try to use streaming instantiation if possible
    let wasmInstance;
    if (config.wasmBinary) {
      const result = await WebAssembly.instantiate(config.wasmBinary, wasmImports);
      wasmInstance = result.instance;
    } else {
      throw new Error('WASM binary not provided');
    }
    
    // Set up module exports
    Module.asm = wasmInstance.exports;
    Module.HEAPU8 = new Uint8Array(wasmInstance.exports.memory.buffer);
    Module.HEAPF32 = new Float32Array(wasmInstance.exports.memory.buffer);
    
    // Wrap malloc and free
    Module._malloc = wasmInstance.exports.malloc;
    Module._free = wasmInstance.exports.free;
    
    // Create cwrap helper
    Module.cwrap = (name, returnType, argTypes, options = {}) => {
      const func = wasmInstance.exports[name];
      if (!func) {
        throw new Error(`Function ${name} not found in WASM exports`);
      }
      
      return (...args) => {
        const result = func(...args);
        return options.async ? Promise.resolve(result) : result;
      };
    };
    
    // Initialize if there's an init function
    if (wasmInstance.exports.__wasm_call_ctors) {
      wasmInstance.exports.__wasm_call_ctors();
    }
    
    readyResolve(Module);
    return Module;
    
  } catch (error) {
    readyReject(error);
    throw error;
  }
}

// Export constants
export const FT8_SAMPLE_RATE = SAMPLE_RATE;
export const FT8_SLOT_TIME = 15.0;
