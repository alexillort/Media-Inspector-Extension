const mediaByTab = new Map();

function normalizeCandidate(item) {
  return {
    url: item.url,
    type: item.type || 'media',
    mime: item.mime || '',
    filename: item.filename || '',
    source: item.source || 'network'
  };
}

function addCandidate(tabId, candidate) {
  if (tabId == null || tabId < 0 || !candidate?.url) return;
  const list = mediaByTab.get(tabId) || [];
  if (!list.some(x => x.url === candidate.url)) {
    list.push(normalizeCandidate(candidate));
    mediaByTab.set(tabId, list.slice(-200));
    chrome.action.setBadgeText({ tabId, text: String(Math.min(list.length, 99)) }).catch(() => {});
  }
}

function classify(url, contentType='') {
  const u = url.toLowerCase().split('?')[0];
  const ct = contentType.toLowerCase();
  if (u.endsWith('.m3u8') || ct.includes('mpegurl')) return 'hls';
  if (u.endsWith('.mp4') || ct.includes('video/mp4')) return 'mp4';
  if (u.endsWith('.webm') || ct.includes('video/webm')) return 'webm';
  if (u.endsWith('.mov') || ct.includes('video/quicktime')) return 'mov';
  if (u.endsWith('.mp3') || ct.includes('audio/mpeg')) return 'mp3';
  if (u.endsWith('.m4a') || ct.includes('audio/mp4')) return 'm4a';
  if (ct.startsWith('video/')) return 'video';
  if (ct.startsWith('audio/')) return 'audio';
  return null;
}

chrome.webRequest.onHeadersReceived.addListener(
  details => {
    const headers = details.responseHeaders || [];
    const ct = headers.find(h => h.name?.toLowerCase() === 'content-type')?.value || '';
    const type = classify(details.url, ct);
    if (type) addCandidate(details.tabId, { url: details.url, type, mime: ct, source: 'network' });
  },
  { urls: ['<all_urls>'], types: ['media', 'xmlhttprequest', 'other'] },
  ['responseHeaders']
);

chrome.tabs.onRemoved.addListener(tabId => mediaByTab.delete(tabId));
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') {
    mediaByTab.set(tabId, []);
    chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
  }
});

async function ensureOffscreen() {
  const url = chrome.runtime.getURL('offscreen.html');
  const contexts = await chrome.runtime.getContexts?.({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
  if (contexts?.length) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['BLOBS'],
    justification: 'Combinar segmentos HLS no cifrados y crear un archivo descargable.'
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === 'FOUND_MEDIA') {
      const tabId = sender.tab?.id;
      for (const item of msg.items || []) addCandidate(tabId, item);
      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === 'GET_MEDIA') {
      sendResponse({ items: mediaByTab.get(msg.tabId) || [] });
      return;
    }

    if (msg?.type === 'CLEAR_MEDIA') {
      mediaByTab.set(msg.tabId, []);
      chrome.action.setBadgeText({ tabId: msg.tabId, text: '' }).catch(() => {});
      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === 'DOWNLOAD_DIRECT') {
      const id = await chrome.downloads.download({ url: msg.url, filename: msg.filename || undefined, saveAs: true });
      sendResponse({ ok: true, id });
      return;
    }

    if (msg?.type === 'DOWNLOAD_HLS') {
      await ensureOffscreen();
      const result = await chrome.runtime.sendMessage({ type: 'OFFSCREEN_DOWNLOAD_HLS', url: msg.url, filename: msg.filename });
      sendResponse(result);
      return;
    }
  })().catch(err => sendResponse({ ok: false, error: String(err?.message || err) }));
  return true;
});
