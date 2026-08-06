// Content script for Google Sheets Screenshot Extension
// Handles 4 capture modes: screenshot, area, tall (scroll), selection

// `var`, not `const` — this script can be re-injected into the same page
// (popup.js's fallback executeScript path), and a top-level `const` throws
// "already declared" on re-injection while `var`/`function` do not.
var api = typeof browser !== 'undefined' ? browser : chrome;

// Prevent multiple injections from re-registering listeners
if (!window.__sheetsScreenshotLoaded) {
  window.__sheetsScreenshotLoaded = true;

  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'screenshot') startScreenshot();
    if (msg.action === 'area') startAreaCapture();
    if (msg.action === 'tall') startTallCapture();
    if (msg.action === 'selection') startSelectionCapture();
  });
}

// ===== Helper Functions =====

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Firefox's `browser.*` namespace is promise-only (no callback param), so
// this must be awaited rather than passed a callback + checked via lastError.
async function captureVisible() {
  const resp = await api.runtime.sendMessage({ action: 'capture-visible' });
  if (resp && resp.dataUrl) return resp.dataUrl;
  throw new Error((resp && resp.error) || 'No capture data');
}

function imageDataToCanvas(imageData) {
  const c = document.createElement('canvas');
  c.width = imageData.width;
  c.height = imageData.height;
  c.getContext('2d', { willReadFrequently: true }).putImageData(imageData, 0, 0);
  return c;
}

// ===== 1. Simple Screenshot =====

async function startScreenshot() {
  try {
    const dataUrl = await captureVisible();
    api.runtime.sendMessage({
      action: 'preview',
      dataUrl: dataUrl,
      filename: 'screenshot-' + Date.now() + '.png'
    });
  } catch (err) {
    console.error('Screenshot failed:', err);
    alert('Screenshot failed: ' + err.message);
  }
}

// ===== 2. Area Capture =====

async function startAreaCapture() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'screenshot-overlay';
    document.body.appendChild(overlay);

    let startX, startY, selection, dimLabel;
    let isSelecting = false;

    overlay.addEventListener('mousedown', (e) => {
      isSelecting = true;
      startX = e.clientX;
      startY = e.clientY;

      selection = document.createElement('div');
      selection.className = 'screenshot-selection';
      overlay.appendChild(selection);

      dimLabel = document.createElement('div');
      dimLabel.className = 'screenshot-dimensions';
      overlay.appendChild(dimLabel);
    });

    overlay.addEventListener('mousemove', (e) => {
      if (!isSelecting) return;
      const x = Math.min(e.clientX, startX);
      const y = Math.min(e.clientY, startY);
      const w = Math.abs(e.clientX - startX);
      const h = Math.abs(e.clientY - startY);

      selection.style.left = x + 'px';
      selection.style.top = y + 'px';
      selection.style.width = w + 'px';
      selection.style.height = h + 'px';

      dimLabel.style.left = (x + w + 5) + 'px';
      dimLabel.style.top = (y + h + 5) + 'px';
      dimLabel.textContent = w + ' \u00d7 ' + h;
    });

    overlay.addEventListener('mouseup', async (e) => {
      if (!isSelecting) return;
      isSelecting = false;

      const x = Math.min(e.clientX, startX);
      const y = Math.min(e.clientY, startY);
      const w = Math.abs(e.clientX - startX);
      const h = Math.abs(e.clientY - startY);

      overlay.remove();

      if (w < 5 || h < 5) return;

      await sleep(100);
      const dpr = window.devicePixelRatio || 1;
      const rect = { x, y, width: w, height: h };

      try {
        const dataUrl = await captureVisible();

        const cropped = await cropToImageData(dataUrl, rect, dpr);
        const canvas = imageDataToCanvas(cropped);
        const finalDataUrl = canvas.toDataURL('image/png');
        api.runtime.sendMessage({
          action: 'preview',
          dataUrl: finalDataUrl,
          filename: 'area-' + Date.now() + '.png'
        });
      } catch (err) {
        console.error('Area capture failed:', err);
        alert('Area capture failed: ' + err.message);
      }
    });

    // ESC to cancel
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  });
}

// ===== 3. Tall (Scroll) Capture =====

async function startTallCapture() {
  try {
    const dpr = window.devicePixelRatio || 1;
    const container = findGridContainer();
    const scrollMeasure = document.querySelector('.native-scrollbar-y') || container;
    console.log('[Tall capture] Scroll measure element:', scrollMeasure.className);
    const gridRect = findGridCanvasRect();

    console.log('[Tall capture] Starting...');
    console.log('[Tall capture] Container:', container.tagName, container.className,
      'scrollHeight:', container.scrollHeight, 'clientHeight:', container.clientHeight);

    // Show progress overlay
    const progressEl = document.createElement('div');
    progressEl.style.cssText = 'position:fixed;top:10px;right:10px;background:rgba(0,0,0,0.8);color:#fff;padding:8px 16px;border-radius:8px;font-size:14px;z-index:999999;font-family:sans-serif;';
    progressEl.textContent = 'Capturing frame 0...';
    document.body.appendChild(progressEl);

    // Reset scroll to top
    scrollMeasure.scrollTop = 0;
    container.scrollTop = 0;
    console.log('[Tall capture] Reset to top, scrollTop:', scrollMeasure.scrollTop);
    await sleep(500);

    const frames = [];
    let frame = 0;
    const maxFrames = 80;
    let consecutiveNoScroll = 0;
    let consecutiveDuplicates = 0;
    let lastDeltaPx = 0;
    let cancelTall = false;

    // ESC to cancel
    const escHandler = (e) => { if (e.key === 'Escape') cancelTall = true; };
    document.addEventListener('keydown', escHandler);

    while (frame < maxFrames) {
      try {
        console.log('[Tall capture] Frame', frame, '- capturing...');
        await sleep(frame === 0 ? 550 : 700);

        // Capture
        const dataUrl = await captureVisible();

        // Crop to grid area
        const cropped = await cropToImageData(dataUrl, gridRect, dpr);
        frames.push(cropped);
        console.log('[Tall capture] Frame', frame, 'size:', cropped.width, 'x', cropped.height);

        // Check for duplicate frames
        if (frames.length >= 2) {
          if (framesAreIdentical(frames[frames.length - 1], frames[frames.length - 2])) {
            consecutiveDuplicates++;
            console.log('[Tall capture] Duplicate frame detected (' + consecutiveDuplicates + ')');
            if (consecutiveDuplicates >= 3) {
              console.log('[Tall capture] Too many duplicate frames, stopping.');
              break;
            }
          } else {
            consecutiveDuplicates = 0;
          }
        }

        frame++;
        progressEl.textContent = 'Capturing frame ' + frame + '...';
        if (cancelTall) break;

        // === SCROLL SECTION ===
        const beforeScrollTop = scrollMeasure.scrollTop;
        const stepCss = Math.floor(gridRect.height * 0.70);

        // Method 1: WheelEvent on canvas (simulates user scrolling over the grid)
        const canvases = document.querySelectorAll('canvas');
        let targetCanvas = null;
        let bestArea = 0;
        for (const c of canvases) {
          const r = c.getBoundingClientRect();
          if (r.width < 200 || r.height < 200) continue;
          if (r.bottom < 0 || r.top > window.innerHeight) continue;
          const a = r.width * r.height;
          if (a > bestArea) { bestArea = a; targetCanvas = c; }
        }

        if (targetCanvas) {
          targetCanvas.dispatchEvent(new WheelEvent('wheel', {
            deltaY: stepCss, deltaMode: 0, bubbles: true, cancelable: true
          }));
        }
        await sleep(800);
        let afterScrollTop = scrollMeasure.scrollTop;

        // Method 2: Direct scrollTop on measurement element (fallback)
        if (afterScrollTop === beforeScrollTop) {
          scrollMeasure.scrollTop = beforeScrollTop + stepCss;
          await sleep(800);
          afterScrollTop = scrollMeasure.scrollTop;
        }

        // Method 3: WheelEvent on container (last resort)
        if (afterScrollTop === beforeScrollTop) {
          container.dispatchEvent(new WheelEvent('wheel', {
            deltaY: stepCss, deltaMode: 0, bubbles: true, cancelable: true
          }));
          await sleep(500);
          afterScrollTop = scrollMeasure.scrollTop;
        }

        console.log('[Tall capture] Scroll attempt - scrollTop:', beforeScrollTop, '->', afterScrollTop);

        if (afterScrollTop === beforeScrollTop) {
          consecutiveNoScroll++;
          if (consecutiveNoScroll >= 3) break;
        } else {
          consecutiveNoScroll = 0;
        }

        lastDeltaPx = Math.round((afterScrollTop - beforeScrollTop) * dpr);

      } catch (frameErr) {
        console.error('[Tall capture] Frame error:', frameErr);
        break;
      }
    }

    document.removeEventListener('keydown', escHandler);
    console.log('[Tall capture] Loop ended. Frames captured:', frames.length,
      'consecutiveNoScroll:', consecutiveNoScroll, 'consecutiveDuplicates:', consecutiveDuplicates);

    if (frames.length === 0) { progressEl.remove(); return; }

    progressEl.textContent = 'Stitching ' + frames.length + ' frames...';

    // Stitch all frames
    let stitched = frames[0];
    for (let i = 1; i < frames.length; i++) {
      stitched = stitchVertical(stitched, frames[i], lastDeltaPx);
    }
    console.log('[Tall capture] Final stitched image:', stitched.width, 'x', stitched.height, 'from', frames.length, 'frames');

    // Convert to dataUrl and send to preview
    const finalCanvas = imageDataToCanvas(stitched);
    const finalDataUrl = finalCanvas.toDataURL('image/png');
    api.runtime.sendMessage({
      action: 'preview',
      dataUrl: finalDataUrl,
      filename: 'scroll-capture-' + Date.now() + '.png'
    });

    progressEl.remove();

  } catch (err) {
    console.error('[Tall capture] failed:', err);
    alert('Scroll capture failed: ' + err.message);
  }
}

// ===== 4. Selection Capture =====

async function startSelectionCapture() {
  try {
    const nameBoxText = findNameBox();
    if (!nameBoxText) {
      alert('No selection detected. Please select cells in Google Sheets first.');
      return;
    }
    console.log('[Selection capture] Name Box:', nameBoxText);

    const range = parseA1Notation(nameBoxText);
    if (!range) {
      alert('Could not parse selection: ' + nameBoxText);
      return;
    }
    console.log('[Selection capture] Parsed range:', JSON.stringify(range));

    const dpr = window.devicePixelRatio || 1;
    const gridRect = findGridCanvasRect();
    const totalRows = range.endRow - range.startRow + 1;

    if (totalRows <= 3) {
      // Simple capture — just screenshot and crop to selection bounds
      await sleep(300);
      const dataUrl = await captureVisible();

      const selRect = getSelectionBoundingRect();
      const cropRect = selRect || gridRect;
      const cropped = await cropToImageData(dataUrl, cropRect, dpr);
      const canvas = imageDataToCanvas(cropped);
      const finalDataUrl = canvas.toDataURL('image/png');
      api.runtime.sendMessage({
        action: 'preview',
        dataUrl: finalDataUrl,
        filename: 'selection-' + Date.now() + '.png'
      });
      return;
    }

    // Scroll-stitch mode for large selections
    const container = findGridContainer();
    const scrollMeasure = document.querySelector('.native-scrollbar-y') || container;

    // Show progress overlay
    const progressEl = document.createElement('div');
    progressEl.style.cssText = 'position:fixed;top:10px;right:10px;background:rgba(0,0,0,0.8);color:#fff;padding:8px 16px;border-radius:8px;font-size:14px;z-index:999999;font-family:sans-serif;';
    progressEl.textContent = 'Capturing frame 0...';
    document.body.appendChild(progressEl);

    // Reset to top
    scrollMeasure.scrollTop = 0;
    if (container) container.scrollTop = 0;
    await sleep(500);

    const initialScrollTop = scrollMeasure.scrollTop;
    const frames = [];
    let frame = 0;
    const maxFrames = 80;
    let consecutiveNoScroll = 0;
    let consecutiveDuplicates = 0;
    let lastDeltaPx = 0;
    let cancelCapture = false;

    const escHandler = (e) => { if (e.key === 'Escape') cancelCapture = true; };
    document.addEventListener('keydown', escHandler);

    while (frame < maxFrames) {
      try {
        console.log('[Selection capture] Frame', frame, '- capturing...');
        await sleep(frame === 0 ? 550 : 700);

        const dataUrl = await captureVisible();

        const curGridRect = findGridCanvasRect();
        const cropped = await cropToImageData(dataUrl, curGridRect || gridRect, dpr);
        frames.push(cropped);
        console.log('[Selection capture] Frame', frame, 'size:', cropped.width, 'x', cropped.height);

        // Check duplicate
        if (frames.length >= 2) {
          if (framesAreIdentical(frames[frames.length - 1], frames[frames.length - 2])) {
            consecutiveDuplicates++;
            if (consecutiveDuplicates >= 3) break;
          } else {
            consecutiveDuplicates = 0;
          }
        }

        // Check if we've scrolled past the selection
        if (frame > 0 && hasScrolledPastSelection(range, scrollMeasure, initialScrollTop, gridRect)) {
          console.log('[Selection capture] Scrolled past selection, stopping.');
          break;
        }

        frame++;
        progressEl.textContent = 'Capturing frame ' + frame + '...';
        if (cancelCapture) break;

        // Scroll (same as startTallCapture)
        const beforeScrollTop = scrollMeasure.scrollTop;
        const stepCss = Math.floor((curGridRect || gridRect).height * 0.70);

        // Method 1: WheelEvent on canvas
        const canvases = document.querySelectorAll('canvas');
        let targetCanvas = null;
        let bestArea = 0;
        for (const c of canvases) {
          const r = c.getBoundingClientRect();
          if (r.width < 200 || r.height < 200) continue;
          if (r.bottom < 0 || r.top > window.innerHeight) continue;
          const a = r.width * r.height;
          if (a > bestArea) { bestArea = a; targetCanvas = c; }
        }
        if (targetCanvas) {
          targetCanvas.dispatchEvent(new WheelEvent('wheel', {
            deltaY: stepCss, deltaMode: 0, bubbles: true, cancelable: true
          }));
        }
        await sleep(800);
        let afterScrollTop = scrollMeasure.scrollTop;

        // Method 2: Direct scrollTop
        if (afterScrollTop === beforeScrollTop) {
          scrollMeasure.scrollTop = beforeScrollTop + stepCss;
          await sleep(800);
          afterScrollTop = scrollMeasure.scrollTop;
        }

        // Method 3: WheelEvent on container
        if (afterScrollTop === beforeScrollTop && container) {
          container.dispatchEvent(new WheelEvent('wheel', {
            deltaY: stepCss, deltaMode: 0, bubbles: true, cancelable: true
          }));
          await sleep(500);
          afterScrollTop = scrollMeasure.scrollTop;
        }

        if (afterScrollTop === beforeScrollTop) {
          consecutiveNoScroll++;
          if (consecutiveNoScroll >= 3) break;
        } else {
          consecutiveNoScroll = 0;
        }

        lastDeltaPx = Math.round((afterScrollTop - beforeScrollTop) * dpr);

      } catch (frameErr) {
        console.error('[Selection capture] Frame error:', frameErr);
        break;
      }
    }

    document.removeEventListener('keydown', escHandler);

    if (frames.length === 0) { progressEl.remove(); return; }

    progressEl.textContent = 'Stitching ' + frames.length + ' frames...';

    let stitched = frames[0];
    for (let i = 1; i < frames.length; i++) {
      stitched = stitchVertical(stitched, frames[i], lastDeltaPx);
    }

    const finalCanvas = imageDataToCanvas(stitched);
    const finalDataUrl = finalCanvas.toDataURL('image/png');
    api.runtime.sendMessage({
      action: 'preview',
      dataUrl: finalDataUrl,
      filename: 'selection-' + Date.now() + '.png'
    });

    progressEl.remove();

  } catch (err) {
    console.error('[Selection capture] failed:', err);
    alert('Selection capture failed: ' + err.message);
  }
}

// ===== DOM Discovery Functions =====

function findGridContainer() {
  const selectors = [
    '.grid-container',
    '#waffle-grid-container',
    '.waffle-scroller',
    '.native-scrollbar-y',
    '.native-scrollbar',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.scrollHeight > el.clientHeight + 5) return el;
  }
  let best = null;
  let bestArea = 0;
  for (const el of document.querySelectorAll('*')) {
    if (el.scrollHeight > el.clientHeight + 50) {
      const a = el.clientWidth * el.clientHeight;
      if (a > bestArea) { bestArea = a; best = el; }
    }
  }
  return best;
}

function findGridCanvasRect() {
  let bestRect = null;
  let bestArea = 0;
  for (const c of document.querySelectorAll('canvas')) {
    const r = c.getBoundingClientRect();
    if (r.width < 200 || r.height < 200) continue;
    if (r.bottom < 0 || r.top > window.innerHeight) continue;
    const a = r.width * r.height;
    if (a > bestArea) { bestArea = a; bestRect = r; }
  }
  if (bestRect) return bestRect;
  return { x: 0, y: 100, width: window.innerWidth, height: window.innerHeight - 140 };
}

// ===== Image Processing Functions =====

async function cropToImageData(dataUrl, rect, dpr) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const sx = Math.round(rect.x * dpr);
      const sy = Math.round(rect.y * dpr);
      const sw = Math.round(rect.width * dpr);
      const sh = Math.round(rect.height * dpr);
      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      resolve(ctx.getImageData(0, 0, sw, sh));
    };
    img.src = dataUrl;
  });
}

function stitchVertical(prev, next, expectedDeltaPx) {
  console.log('[Stitch] prev:', prev.width, 'x', prev.height, 'next:', next.width, 'x', next.height, 'expectedDelta:', expectedDeltaPx);
  const w = Math.min(prev.width, next.width);
  if (next.width !== prev.width) {
    console.log('[Stitch] Width mismatch, using min:', w);
  }

  const frozenH = detectFrozenHeader(prev, next);
  const scrollableH = prev.height - frozenH;
  const stripH = Math.min(200, Math.floor(scrollableH / 2));
  if (stripH < 10) return prev;

  const overlapY = findVerticalOverlap(prev, next, stripH, expectedDeltaPx, frozenH);
  console.log('[Stitch] overlapY:', overlapY, 'stripH:', stripH);

  let appendStart = overlapY + stripH;
  if (appendStart >= next.height) {
    // Overlap detection failed — use expectedDeltaPx as fallback
    if (expectedDeltaPx > 0 && expectedDeltaPx < next.height) {
      appendStart = next.height - expectedDeltaPx;
      console.log('[Stitch] Overlap detection failed, using expectedDelta fallback. appendStart:', appendStart);
    } else {
      appendStart = Math.floor(next.height / 2);
      console.log('[Stitch] Using last resort: append from middle. appendStart:', appendStart);
    }
  }

  const newRows = next.height - appendStart;
  const finalH = prev.height + newRows;
  console.log('[Stitch] Appending', newRows, 'new rows. Final height:', finalH);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = finalH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const prevCanvas = imageDataToCanvas(prev);
  ctx.drawImage(prevCanvas, 0, 0, w, prev.height, 0, 0, w, prev.height);

  const nextCanvas = imageDataToCanvas(next);
  ctx.drawImage(nextCanvas, 0, appendStart, w, newRows, 0, prev.height, w, newRows);

  return ctx.getImageData(0, 0, w, finalH);
}

function findVerticalOverlap(prev, next, stripH, expectedDeltaPx, frozenH) {
  const w = Math.min(prev.width, next.width);
  // Extract strip from bottom of prev
  const stripY = prev.height - stripH;
  const prevCanvas = imageDataToCanvas(prev);
  const prevCtx = prevCanvas.getContext('2d', { willReadFrequently: true });
  const stripData = prevCtx.getImageData(0, stripY, w, stripH);

  const nextCanvas = imageDataToCanvas(next);
  const nextCtx = nextCanvas.getContext('2d', { willReadFrequently: true });

  // Search the entire plausible range
  const searchStart = frozenH;
  const searchEnd = Math.max(searchStart + 1, next.height - stripH);

  let bestScore = Infinity;
  let bestY = searchStart;
  const sampleStep = Math.max(1, Math.floor(w / 100)); // sample ~100 columns

  for (let y = searchStart; y < searchEnd; y += 2) { // step by 2 for speed
    const candidate = nextCtx.getImageData(0, y, w, stripH);
    let diff = 0;
    let samples = 0;
    for (let i = 0; i < stripData.data.length; i += sampleStep * 4) {
      const dr = Math.abs(stripData.data[i] - candidate.data[i]);
      const dg = Math.abs(stripData.data[i + 1] - candidate.data[i + 1]);
      const db = Math.abs(stripData.data[i + 2] - candidate.data[i + 2]);
      diff += dr + dg + db;
      samples++;
    }
    const avgDiff = diff / samples;
    if (avgDiff < bestScore) {
      bestScore = avgDiff;
      bestY = y;
    }
  }

  // Refine: search ±5px around bestY with step 1
  const refineStart = Math.max(searchStart, bestY - 5);
  const refineEnd = Math.min(searchEnd, bestY + 5);
  for (let y = refineStart; y <= refineEnd; y++) {
    const candidate = nextCtx.getImageData(0, y, w, stripH);
    let diff = 0;
    let samples = 0;
    for (let i = 0; i < stripData.data.length; i += sampleStep * 4) {
      const dr = Math.abs(stripData.data[i] - candidate.data[i]);
      const dg = Math.abs(stripData.data[i + 1] - candidate.data[i + 1]);
      const db = Math.abs(stripData.data[i + 2] - candidate.data[i + 2]);
      diff += dr + dg + db;
      samples++;
    }
    const avgDiff = diff / samples;
    if (avgDiff < bestScore) {
      bestScore = avgDiff;
      bestY = y;
    }
  }

  const matchPercent = Math.round((1 - bestScore / 765) * 100); // 765 = max diff per sample
  console.log('[Overlap] Best match at y:', bestY, 'score:', matchPercent + '%');

  return bestY;
}

function detectFrozenHeader(prev, next) {
  const w = Math.min(prev.width, next.width);
  const maxCheck = Math.min(200, Math.floor(prev.height / 4));
  const prevCanvas = imageDataToCanvas(prev);
  const nextCanvas = imageDataToCanvas(next);
  const prevCtx = prevCanvas.getContext('2d', { willReadFrequently: true });
  const nextCtx = nextCanvas.getContext('2d', { willReadFrequently: true });

  let frozenH = 0;
  for (let row = 0; row < maxCheck; row += 2) {
    const prevRow = prevCtx.getImageData(0, row, w, 1);
    const nextRow = nextCtx.getImageData(0, row, w, 1);
    let match = 0;
    let total = 0;
    for (let i = 0; i < prevRow.data.length; i += 16) {
      total++;
      const d = Math.abs(prevRow.data[i] - nextRow.data[i]) +
                Math.abs(prevRow.data[i+1] - nextRow.data[i+1]) +
                Math.abs(prevRow.data[i+2] - nextRow.data[i+2]);
      if (d < 30) match++;
    }
    if (total > 0 && match / total > 0.95) {
      frozenH = row + 2;
    } else {
      break;
    }
  }
  return frozenH;
}

function framesAreIdentical(prev, next) {
  if (!prev || !next) return false;
  if (prev.width !== next.width || prev.height !== next.height) return false;

  const totalPixels = prev.width * prev.height;
  const sampleStep = Math.max(1, Math.floor(totalPixels / 1000));
  let matchCount = 0;
  let sampleCount = 0;

  for (let i = 0; i < prev.data.length; i += sampleStep * 4) {
    sampleCount++;
    const dr = Math.abs(prev.data[i] - next.data[i]);
    const dg = Math.abs(prev.data[i + 1] - next.data[i + 1]);
    const db = Math.abs(prev.data[i + 2] - next.data[i + 2]);
    if (dr + dg + db < 30) matchCount++;
  }

  return sampleCount > 0 && (matchCount / sampleCount) > 0.98;
}

// ===== Selection Helper Functions =====

function findNameBox() {
  // Strategy 1: Known selectors
  const selectors = [
    '#t-name-box',
    'input[aria-label="Name Box"]',
    '.waffle-name-box input',
    '.waffle-name-box',
    'input.jfk-textinput',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) {
      const val = el.value || el.innerText || el.textContent || '';
      if (val.trim() && /^[A-Z]/i.test(val.trim())) return val.trim();
    }
  }

  // Strategy 2: Scan for cell reference pattern in inputs
  const inputs = document.querySelectorAll('input');
  for (const inp of inputs) {
    const val = (inp.value || '').trim();
    if (/^[A-Z]{1,3}\d+/i.test(val)) return val;
  }

  // Strategy 3: Positional heuristic - look for small input near top-left
  const topInputs = document.querySelectorAll('input, [contenteditable]');
  for (const el of topInputs) {
    const r = el.getBoundingClientRect();
    if (r.top < 80 && r.left < 200 && r.width < 150 && r.width > 30) {
      const val = (el.value || el.innerText || el.textContent || '').trim();
      if (/^[A-Z]/i.test(val)) return val;
    }
  }

  return null;
}

function parseA1Notation(text) {
  // Match ranges like "A1:F35", "B2:Z100", or single cells "A1"
  const rangeMatch = text.match(/^([A-Z]{1,3})(\d+):([A-Z]{1,3})(\d+)$/i);
  if (rangeMatch) {
    return {
      startCol: colToNum(rangeMatch[1]),
      startRow: parseInt(rangeMatch[2]),
      endCol: colToNum(rangeMatch[3]),
      endRow: parseInt(rangeMatch[4])
    };
  }
  const cellMatch = text.match(/^([A-Z]{1,3})(\d+)$/i);
  if (cellMatch) {
    return {
      startCol: colToNum(cellMatch[1]),
      startRow: parseInt(cellMatch[2]),
      endCol: colToNum(cellMatch[1]),
      endRow: parseInt(cellMatch[2])
    };
  }
  return null;
}

function colToNum(col) {
  let num = 0;
  for (let i = 0; i < col.length; i++) {
    num = num * 26 + (col.charCodeAt(i) - 64);
  }
  return num;
}

function getSelectionBoundingRect() {
  // Try to find selection highlight elements
  const highlights = document.querySelectorAll('.selection, .active-cell-border, [class*="selection"]');
  if (highlights.length === 0) return null;

  let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
  for (const el of highlights) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    minX = Math.min(minX, r.left);
    minY = Math.min(minY, r.top);
    maxX = Math.max(maxX, r.right);
    maxY = Math.max(maxY, r.bottom);
  }

  if (minX === Infinity) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function hasScrolledPastSelection(range, scrollMeasure, initialScrollTop, gridRect) {
  // Strategy 1: Check DOM selection elements (works when Sheets uses DOM overlays)
  const highlights = document.querySelectorAll('.selection, .active-cell-border, [class*="selection"]');
  if (highlights.length > 0) {
    let allAbove = true;
    for (const el of highlights) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.bottom > 0) {
        allAbove = false;
        break;
      }
    }
    if (allAbove) return true;
  }

  // Strategy 2: Estimate based on scroll distance and row count
  // (Used when Sheets renders selection on canvas — no DOM elements)
  if (scrollMeasure && gridRect && range) {
    const totalRows = range.endRow - range.startRow + 1;
    const scrolled = scrollMeasure.scrollTop - (initialScrollTop || 0);
    
    // Estimate row height from the scrollbar's total range
    // scrollHeight represents the full document, clientHeight is the visible area
    // Use a generous row height estimate to avoid stopping too early
    const totalScrollableRows = Math.max(totalRows, Math.round(scrollMeasure.scrollHeight / 21));
    const estRowHeight = scrollMeasure.scrollHeight / Math.max(totalScrollableRows, 1);
    
    const visibleRows = Math.floor(gridRect.height / estRowHeight);
    // Total scroll needed: selection rows minus visible rows, times row height
    // Add 50% buffer to avoid stopping too early
    const estScrollNeeded = Math.max(0, (totalRows - visibleRows) * estRowHeight * 1.5);
    
    if (estScrollNeeded > 0 && scrolled >= estScrollNeeded) {
      console.log('[Selection capture] Scroll distance estimate reached:', scrolled, '>=', estScrollNeeded, '(rows:', totalRows, ')');
      return true;
    }
  }

  return false;
}
