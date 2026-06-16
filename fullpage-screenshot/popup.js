(async () => {
  const statusEl = document.getElementById('status');
  const progressBar = document.getElementById('progressBar');
  const progressFill = document.getElementById('progressFill');
  const btnFullPage = document.getElementById('btnFullPage');
  const btnVisible = document.getElementById('btnVisible');
  const btnSelectArea = document.getElementById('btnSelectArea');
  const btnSaveAs = document.getElementById('btnSaveAs');

  function setStatus(text, capturing = false) {
    statusEl.textContent = text;
    statusEl.className = capturing ? 'status capturing' : 'status';
  }

  function setProgress(percent) {
    progressBar.className = 'progress-bar active';
    progressFill.style.width = percent + '%';
  }

  function hideProgress() {
    progressBar.className = 'progress-bar';
    progressFill.style.width = '0%';
  }

  function disableButtons(disabled) {
    btnFullPage.disabled = disabled;
    btnVisible.disabled = disabled;
    btnSelectArea.disabled = disabled;
  }

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  // 截取整页：通知 content.js 开始滚动拼接
  btnFullPage.addEventListener('click', async () => {
    disableButtons(true);
    setStatus('正在准备截取整个网页...', true);
    setProgress(5);
    try {
      const tab = await getActiveTab();
      await chrome.tabs.sendMessage(tab.id, { action: 'fullPage' });
      setStatus('正在滚动截图中...', true);
      setProgress(30);
    } catch (e) {
      setStatus('错误: 请刷新页面后重试');
      hideProgress();
      disableButtons(false);
    }
  });

  // 截取当前可视区域
  btnVisible.addEventListener('click', async () => {
    disableButtons(true);
    setStatus('正在截取可见区域...', true);
    setProgress(50);
    try {
      const tab = await getActiveTab();
      await chrome.tabs.sendMessage(tab.id, { action: 'visible' });
    } catch (e) {
      setStatus('错误: 请刷新页面后重试');
      hideProgress();
      disableButtons(false);
    }
  });

  // 区域截图：进入页面选取模式，popup 先关掉不挡视线
  btnSelectArea.addEventListener('click', async () => {
    disableButtons(true);
    setStatus('请在网页上拖动选择截图区域...', true);
    try {
      const tab = await getActiveTab();
      await chrome.tabs.sendMessage(tab.id, { action: 'selectArea' });
      window.close();
    } catch (e) {
      setStatus('错误: 请刷新页面后重试');
      hideProgress();
      disableButtons(false);
    }
  });

  // 把最近一次截图用"另存为"对话框存下来
  btnSaveAs.addEventListener('click', async () => {
    try {
      await chrome.runtime.sendMessage({ action: 'saveLastScreenshot' });
    } catch (e) {
      setStatus('没有可保存的截图');
    }
  });

  // 接收来自 content.js / background.js 的状态更新
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'captureProgress') {
      setProgress(msg.percent);
      setStatus(msg.text || '截图中...', true);
    }
    if (msg.action === 'captureComplete') {
      hideProgress();
      setStatus('截图完成！已自动下载');
      disableButtons(false);
    }
    if (msg.action === 'captureError') {
      hideProgress();
      setStatus('截图失败: ' + (msg.error || '未知错误'));
      disableButtons(false);
    }
  });
})();
