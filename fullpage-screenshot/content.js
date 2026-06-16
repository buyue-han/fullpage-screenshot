(() => {
  let isCapturing = false;
  let selectMode = false;
  let startX, startY, selectionBox;

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'fullPage') {
      captureFullPage();
    } else if (msg.action === 'visible') {
      captureVisible();
    } else if (msg.action === 'selectArea') {
      startAreaSelection();
    }
  });

  // Chrome 的 captureVisibleTab 有调用频率限制，不能太猛
  let lastCaptureTime = 0;
  const CAPTURE_INTERVAL = 800;

  async function captureTab() {
    const now = Date.now();
    const elapsed = now - lastCaptureTime;
    if (elapsed < CAPTURE_INTERVAL) {
      await new Promise(r => setTimeout(r, CAPTURE_INTERVAL - elapsed));
    }

    // 如果还是触发上限，就多试几次，每次递增等待时间
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await chrome.runtime.sendMessage({ action: 'captureTab' });
        lastCaptureTime = Date.now();
        if (res && res.error) {
          throw new Error(res.error);
        }
        if (typeof res !== 'string' || !res.startsWith('data:')) {
          throw new Error('截图返回数据无效');
        }
        return res;
      } catch (e) {
        if (e.message && e.message.includes('MAX_CAPTURE_VISIBLE_TAB')) {
          const waitTime = 1500 * (attempt + 1);
          await new Promise(r => setTimeout(r, waitTime));
          continue;
        }
        throw e;
      }
    }
    throw new Error('截图调用超频，请稍后重试');
  }

  async function captureVisible() {
    try {
      const dataUrl = await captureTab();
      downloadImage(dataUrl);
      notifyPopup('captureComplete');
    } catch (e) {
      notifyPopup('captureError', { error: e.message });
    }
  }

  async function captureFullPage() {
    if (isCapturing) return;
    isCapturing = true;

    const originalScrollX = window.scrollX;
    const originalScrollY = window.scrollY;

    // 先把滚动条干掉，不然拼出来会有重复滚动条
    const scrollbarStyle = document.createElement('style');
    scrollbarStyle.id = 'fps-hide-scrollbar';
    scrollbarStyle.textContent = [
      'html::-webkit-scrollbar { width: 0 !important; height: 0 !important; }',
      'html { scrollbar-width: none !important; }',
      'body::-webkit-scrollbar { width: 0 !important; height: 0 !important; }',
      'body { scrollbar-width: none !important; }'
    ].join('\n');
    document.head.appendChild(scrollbarStyle);

    // 找出所有 fixed / sticky 元素，截图时先隐藏，避免每屏都出现
    const fixedElements = [];
    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      const style = getComputedStyle(el);
      const pos = style.position;
      if (pos === 'fixed' || pos === 'sticky') {
        fixedElements.push({
          el,
          originalDisplay: el.style.display,
          originalVisibility: el.style.visibility,
          originalOpacity: el.style.opacity
        });
      }
    }

    const fixedStyle = document.createElement('style');
    fixedStyle.id = 'fps-hide-fixed';
    fixedStyle.textContent = `
      [data-fps-hidden="true"] {
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
    `;
    document.head.appendChild(fixedStyle);

    // 等样式生效
    await new Promise(r => setTimeout(r, 200));

    const totalWidth = document.documentElement.scrollWidth;
    const totalHeight = document.documentElement.scrollHeight;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;

    // 浏览器对 canvas 尺寸有限制，超大页面需要降采样
    const MAX_CANVAS_PIXELS = 268435456;
    let canvasW = totalWidth * dpr;
    let canvasH = totalHeight * dpr;
    let scale = 1;

    if (canvasW * canvasH > MAX_CANVAS_PIXELS) {
      scale = Math.sqrt(MAX_CANVAS_PIXELS / (canvasW * canvasH));
      canvasW = Math.floor(canvasW * scale);
      canvasH = Math.floor(canvasH * scale);
    }

    const cols = Math.ceil(totalWidth / viewportWidth);
    const rows = Math.ceil(totalHeight / viewportHeight);

    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d');
    if (scale < 1) {
      ctx.scale(scale * dpr, scale * dpr);
    }

    let captures = [];

    try {
      window.scrollTo(0, 0);
      await new Promise(r => setTimeout(r, 300));

      for (const item of fixedElements) {
        item.el.setAttribute('data-fps-hidden', 'true');
      }

      // 按视口网格逐块截图
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const targetX = col * viewportWidth;
          const targetY = row * viewportHeight;

          window.scrollTo(targetX, targetY);
          await new Promise(r => setTimeout(r, 300));

          const actualX = window.scrollX;
          const actualY = window.scrollY;

          const step = row * cols + col + 1;
          const total = rows * cols;
          notifyPopup('captureProgress', {
            percent: 30 + Math.round((step / total) * 60),
            text: `截图中... ${step}/${total}`
          });

          const dataUrl = await captureTab();
          captures.push({ dataUrl, x: actualX, y: actualY });
        }
      }

      window.scrollTo(0, 0);
      await new Promise(r => setTimeout(r, 300));

      for (const item of fixedElements) {
        item.el.removeAttribute('data-fps-hidden');
      }

      // 固定元素在滚回顶部后需要单独补一张，再贴回去，不然导航栏会缺失
      let topCapture = null;
      if (fixedElements.length > 0 && captures.length > 0) {
        topCapture = await captureTab();
        for (const item of fixedElements) {
          item.el.setAttribute('data-fps-hidden', 'true');
        }
      }

      notifyPopup('captureProgress', { percent: 92, text: '正在拼接图片...' });

      const topImg = topCapture ? await loadImage(topCapture) : null;
      const topFixedRects = [];
      for (const item of fixedElements) {
        const rect = item.el.getBoundingClientRect();
        const cs = getComputedStyle(item.el);
        // 只把真正固定在顶部附近的元素贴回去
        if (cs.position === 'fixed' || (cs.position === 'sticky' && originalScrollY <= 0 && rect.top < viewportHeight * 0.5)) {
          topFixedRects.push({
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height
          });
        }
      }

      // 把各块截图按坐标拼到大画布上
      for (let i = 0; i < captures.length; i++) {
        const cap = captures[i];
        const img = await loadImage(cap.dataUrl);

        const srcW = Math.min(img.width, (totalWidth - cap.x) * dpr);
        const srcH = Math.min(img.height, (totalHeight - cap.y) * dpr);

        if (scale >= 1) {
          ctx.drawImage(
            img,
            0, 0, srcW, srcH,
            cap.x * dpr, cap.y * dpr, srcW, srcH
          );
        } else {
          ctx.drawImage(
            img,
            0, 0, srcW, srcH,
            cap.x, cap.y, srcW / dpr, srcH / dpr
          );
        }
      }

      // 把顶部固定元素（导航栏之类）从 topCapture 里抠出来盖上去
      if (topImg && topFixedRects.length > 0) {
        for (const fr of topFixedRects) {
          ctx.drawImage(
            topImg,
            fr.left * dpr, fr.top * dpr,
            fr.width * dpr, fr.height * dpr,
            fr.left * dpr, fr.top * dpr,
            fr.width * dpr, fr.height * dpr
          );
        }
      }

      notifyPopup('captureProgress', { percent: 96, text: '正在生成图片...' });

      const resultDataUrl = canvas.toDataURL('image/png');
      downloadImage(resultDataUrl);

      cleanup();
      window.scrollTo(originalScrollX, originalScrollY);
      notifyPopup('captureComplete');
    } catch (e) {
      cleanup();
      window.scrollTo(originalScrollX, originalScrollY);
      notifyPopup('captureError', { error: e.message || '长截图失败' });
    }

    isCapturing = false;

    function cleanup() {
      const s1 = document.getElementById('fps-hide-scrollbar');
      if (s1) s1.remove();
      const s2 = document.getElementById('fps-hide-fixed');
      if (s2) s2.remove();
      for (const item of fixedElements) {
        item.el.removeAttribute('data-fps-hidden');
      }
    }
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = dataUrl;
    });
  }

  // 触发浏览器下载，同时把数据暂存到 background，方便用户后续"另存为"
  function downloadImage(dataUrl) {
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    link.download = `screenshot_${timestamp}.png`;
    link.href = dataUrl;
    link.click();

    chrome.runtime.sendMessage({
      action: 'storeScreenshot',
      dataUrl: dataUrl
    }).catch(() => {});
  }

  function notifyPopup(action, extra = {}) {
    chrome.runtime.sendMessage({ action, ...extra }).catch(() => {});
  }

  // 区域截图：在页面上盖一层遮罩，让用户拖动选区
  function startAreaSelection() {
    if (selectMode) return;
    selectMode = true;

    selectionBox = document.createElement('div');
    selectionBox.id = 'fps-selection-box';
    document.body.appendChild(selectionBox);

    const overlay = document.createElement('div');
    overlay.id = 'fps-overlay';
    document.body.appendChild(overlay);

    const hint = document.createElement('div');
    hint.id = 'fps-hint';
    hint.textContent = '按住鼠标拖动选择截图区域 | ESC取消';
    document.body.appendChild(hint);

    let isDragging = false;

    function onMouseDown(e) {
      if (e.target.id === 'fps-overlay' || e.target.id === 'fps-hint') {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        selectionBox.style.left = startX + 'px';
        selectionBox.style.top = startY + 'px';
        selectionBox.style.width = '0px';
        selectionBox.style.height = '0px';
        selectionBox.style.display = 'block';
        hint.style.display = 'none';
      }
    }

    function onMouseMove(e) {
      if (!isDragging) return;
      const curX = e.clientX;
      const curY = e.clientY;
      const left = Math.min(startX, curX);
      const top = Math.min(startY, curY);
      const width = Math.abs(curX - startX);
      const height = Math.abs(curY - startY);
      selectionBox.style.left = left + 'px';
      selectionBox.style.top = top + 'px';
      selectionBox.style.width = width + 'px';
      selectionBox.style.height = height + 'px';
    }

    async function onMouseUp(e) {
      if (!isDragging) return;
      isDragging = false;

      const curX = e.clientX;
      const curY = e.clientY;
      const left = Math.min(startX, curX);
      const top = Math.min(startY, curY);
      const width = Math.abs(curX - startX);
      const height = Math.abs(curY - startY);

      cleanup();

      if (width < 10 || height < 10) {
        selectMode = false;
        return;
      }

      try {
        const dataUrl = await captureTab();

        const dpr = window.devicePixelRatio || 1;
        const canvas = document.createElement('canvas');
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        const ctx = canvas.getContext('2d');

        const img = await loadImage(dataUrl);
        ctx.drawImage(
          img,
          left * dpr, top * dpr,
          width * dpr, height * dpr,
          0, 0,
          width * dpr, height * dpr
        );

        const resultDataUrl = canvas.toDataURL('image/png');
        downloadImage(resultDataUrl);
        notifyPopup('captureComplete');
      } catch (err) {
        notifyPopup('captureError', { error: err.message || '区域截图失败' });
      }

      selectMode = false;
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        cleanup();
        selectMode = false;
      }
    }

    function cleanup() {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('keydown', onKeyDown);
      const box = document.getElementById('fps-selection-box');
      const ov = document.getElementById('fps-overlay');
      const ht = document.getElementById('fps-hint');
      if (box) box.remove();
      if (ov) ov.remove();
      if (ht) ht.remove();
    }

    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('keydown', onKeyDown);
  }
})();
