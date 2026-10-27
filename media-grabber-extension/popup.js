let activeTabId;

function niceName(item, i) {
  try {
    const u = new URL(item.url);
    const raw = decodeURIComponent(u.pathname.split('/').pop() || 'media');
    return raw.length > 55 ? raw.slice(0, 52) + '…' : raw;
  } catch { return `media-${i+1}`; }
}

async function load() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab.id;
  const { items = [] } = await chrome.runtime.sendMessage({ type: 'GET_MEDIA', tabId: tab.id });
  render(items);
}

function render(items) {
  const list = document.getElementById('list');
  list.textContent = '';
  if (!items.length) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = 'No se detectaron videos todavía. Reproduce el video unos segundos y vuelve a abrir la extensión.';
    list.appendChild(e);
    return;
  }

  items.slice().reverse().forEach((item, i) => {
    const box = document.createElement('div'); box.className = 'item';
    const row = document.createElement('div'); row.className = 'row';
    const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = (item.type || 'media').toUpperCase();
    const meta = document.createElement('span'); meta.className = 'meta'; meta.textContent = niceName(item, i);
    const btn = document.createElement('button'); btn.className = 'download'; btn.textContent = 'Descargar';
    const url = document.createElement('div'); url.className = 'url'; url.textContent = item.url; url.title = item.url;
    const status = document.createElement('div'); status.className = 'status';

    btn.addEventListener('click', async () => {
      btn.disabled = true; status.textContent = 'Preparando descarga…';
      const isHls = item.type === 'hls' || /\.m3u8(?:$|\?)/i.test(item.url);
      const res = await chrome.runtime.sendMessage({
        type: isHls ? 'DOWNLOAD_HLS' : 'DOWNLOAD_DIRECT',
        url: item.url,
        filename: undefined
      });
      status.textContent = res?.ok ? 'Descarga iniciada.' : `Error: ${res?.error || 'desconocido'}`;
      btn.disabled = false;
    });

    row.append(badge, meta, btn); box.append(row, url, status); list.appendChild(box);
  });
}

document.getElementById('refresh').addEventListener('click', load);
document.getElementById('clear').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'CLEAR_MEDIA', tabId: activeTabId });
  load();
});
load();
