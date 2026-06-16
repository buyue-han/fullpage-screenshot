// 用来暂存最近一次截图，方便"另存为"功能
let lastScreenshotDataUrl = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // content.js 调用的实际截图接口
  if (msg.action === 'captureTab') {
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        sendResponse(dataUrl);
      }
    });
    return true;
  }

  if (msg.action === 'storeScreenshot') {
    lastScreenshotDataUrl = msg.dataUrl;
    return false;
  }

  // 弹出"另存为"对话框保存上一次的截图
  if (msg.action === 'saveLastScreenshot') {
    if (lastScreenshotDataUrl) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `screenshot_save_${timestamp}.png`;
      chrome.downloads.download({
        url: lastScreenshotDataUrl,
        filename: filename,
        saveAs: true
      });
    } else {
      chrome.runtime.sendMessage({ action: 'captureError', error: '没有可保存的截图' }).catch(() => {});
    }
    return true;
  }

  // 把截图过程中的状态转发给 popup
  if (msg.action === 'captureProgress' || msg.action === 'captureComplete' || msg.action === 'captureError') {
    chrome.runtime.sendMessage(msg).catch(() => {});
    return false;
  }
});
