document.addEventListener('DOMContentLoaded', () => {
  const img = document.getElementById('preview-image');
  const filenameEl = document.getElementById('filename');
  const dimensionsEl = document.getElementById('dimensions');
  const copyBtn = document.getElementById('btn-copy');
  const downloadBtn = document.getElementById('btn-download');
  const zoomInBtn = document.getElementById('btn-zoom-in');
  const zoomOutBtn = document.getElementById('btn-zoom-out');
  const zoomResetBtn = document.getElementById('btn-zoom-reset');
  const zoomDisplay = document.getElementById('zoom-display');
  const previewArea = document.querySelector('.preview-area');

  let dataUrl = '';
  let filename = '';
  let zoomPercent = 100;
  let isFitMode = true;
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let scrollLeftStart = 0;
  let scrollTopStart = 0;

  // Load preview data
  chrome.storage.local.get('previewData', (result) => {
    if (result.previewData) {
      dataUrl = result.previewData.dataUrl;
      filename = result.previewData.filename || 'capture.png';
      img.src = dataUrl;
      filenameEl.textContent = filename;
      chrome.storage.local.remove('previewData');
    }
  });

  img.addEventListener('load', () => {
    dimensionsEl.textContent = `${img.naturalWidth} × ${img.naturalHeight}`;
    applyZoom();
  });

  // Copy to clipboard
  copyBtn.addEventListener('click', async () => {
    try {
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob })
      ]);
      const originalText = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      setTimeout(() => {
        copyBtn.textContent = originalText;
      }, 1500);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  });

  // Download
  downloadBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'download', dataUrl, filename });
  });

  // Zoom functions
  function zoomIn() {
    if (isFitMode) {
      leaveFitMode();
    }
    zoomPercent = Math.min(400, zoomPercent + 25);
    applyZoom();
  }

  function zoomOut() {
    if (isFitMode) {
      leaveFitMode();
    }
    zoomPercent = Math.max(25, zoomPercent - 25);
    applyZoom();
  }

  function zoomReset() {
    zoomPercent = 100;
    isFitMode = true;
    applyZoom();
  }

  function leaveFitMode() {
    // Calculate effective zoom from current display size
    const displayedWidth = img.clientWidth;
    const effectiveZoom = Math.round((displayedWidth / img.naturalWidth) * 100);
    zoomPercent = Math.round(effectiveZoom / 25) * 25;
    if (zoomPercent < 25) zoomPercent = 25;
    if (zoomPercent > 400) zoomPercent = 400;
    isFitMode = false;
  }

  function applyZoom() {
    if (isFitMode) {
      previewArea.classList.add('fit');
      previewArea.classList.remove('zoomed');
      img.style.width = '';
      img.style.height = '';
      zoomDisplay.textContent = 'Fit';
    } else {
      previewArea.classList.remove('fit');
      previewArea.classList.add('zoomed');
      const w = img.naturalWidth * zoomPercent / 100;
      const h = img.naturalHeight * zoomPercent / 100;
      img.style.width = w + 'px';
      img.style.height = h + 'px';
      zoomDisplay.textContent = zoomPercent + '%';
    }
  }

  zoomInBtn.addEventListener('click', zoomIn);
  zoomOutBtn.addEventListener('click', zoomOut);
  zoomResetBtn.addEventListener('click', zoomReset);

  // Ctrl+Scroll zoom
  previewArea.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
      e.preventDefault();
      if (e.deltaY < 0) {
        zoomIn();
      } else {
        zoomOut();
      }
    }
  }, { passive: false });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      zoomIn();
    } else if (e.ctrlKey && e.key === '-') {
      e.preventDefault();
      zoomOut();
    } else if (e.ctrlKey && e.key === '0') {
      e.preventDefault();
      zoomReset();
    }
  });

  // Drag to pan
  previewArea.addEventListener('mousedown', (e) => {
    if (!previewArea.classList.contains('zoomed')) return;
    if (e.button !== 0) return;
    if (e.target.tagName === 'BUTTON') return;

    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    scrollLeftStart = previewArea.scrollLeft;
    scrollTopStart = previewArea.scrollTop;
    previewArea.classList.add('dragging');
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    previewArea.scrollLeft = scrollLeftStart - dx;
    previewArea.scrollTop = scrollTopStart - dy;
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      previewArea.classList.remove('dragging');
    }
  });

  previewArea.addEventListener('mouseleave', () => {
    if (isDragging) {
      isDragging = false;
      previewArea.classList.remove('dragging');
    }
  });
});
