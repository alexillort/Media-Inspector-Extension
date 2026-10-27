function scanMedia() {
  const items = [];
  const push = (url, type='media', source='dom') => {
    if (!url || !/^https?:/i.test(url)) return;
    items.push({ url, type, source });
  };

  document.querySelectorAll('video,audio').forEach(el => {
    push(el.currentSrc || el.src, el.tagName.toLowerCase(), 'dom');
    el.querySelectorAll('source').forEach(s => push(s.src, el.tagName.toLowerCase(), 'dom'));
  });

  try {
    performance.getEntriesByType('resource').forEach(r => {
      const u = r.name || '';
      if (/\.m3u8(?:$|\?)/i.test(u)) push(u, 'hls', 'performance');
      else if (/\.(mp4|webm|mov|m4a|mp3)(?:$|\?)/i.test(u)) push(u, 'media', 'performance');
    });
  } catch {}

  if (items.length) chrome.runtime.sendMessage({ type: 'FOUND_MEDIA', items }).catch(() => {});
}

scanMedia();
const observer = new MutationObserver(() => scanMedia());
observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
setInterval(scanMedia, 4000);
