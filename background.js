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
