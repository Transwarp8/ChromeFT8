chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.set({
      minFreq: 200,
      maxFreq: 3000,
      minScore: 10,
      ldpcIterations: 25,
      autoStart: false
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'GET_SETTINGS':
      chrome.storage.local.get(null, (settings) => {
        sendResponse(settings);
      });
      return true;
      
    case 'SAVE_SETTINGS':
      chrome.storage.local.set(message.settings, () => {
        sendResponse({ success: true });
      });
      return true;
      
    case 'LOG':
      sendResponse({ received: true });
      break;
  }
});

let keepAliveInterval = null;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'keepalive') {
    keepAliveInterval = setInterval(() => {
    }, 25000);
    
    port.onDisconnect.addListener(() => {
      if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
      }
    });
  }
});
