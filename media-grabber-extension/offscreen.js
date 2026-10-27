function abs(base, rel) { return new URL(rel, base).href; }

function parseAttrs(s) {
  const out = {};
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
  let m; while ((m = re.exec(s))) out[m[1].toUpperCase()] = m[2].replace(/^"|"$/g, '');
  return out;
}

async function fetchText(url) {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error(`HTTP ${r.status} al cargar playlist`);
  return { text: await r.text(), finalUrl: r.url };
}

async function resolveMediaPlaylist(url) {
  const { text, finalUrl } = await fetchText(url);
  const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  if (!lines[0]?.startsWith('#EXTM3U')) throw new Error('El recurso no parece ser HLS.');
  if (lines.some(x => x.startsWith('#EXT-X-KEY') && !/METHOD=NONE/i.test(x))) {
    throw new Error('El stream HLS está cifrado. Esta extensión no intenta eludir cifrado o DRM.');
  }
  if (lines.some(x => x.startsWith('#EXT-X-STREAM-INF'))) {
    const variants = [];
    for (let i=0;i<lines.length;i++) {
      if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
        const a = parseAttrs(lines[i].slice(lines[i].indexOf(':')+1));
        const next = lines[i+1];
        if (next && !next.startsWith('#')) variants.push({ url: abs(finalUrl, next), bandwidth: Number(a.BANDWIDTH || 0) });
      }
    }
    if (!variants.length) throw new Error('No se encontraron variantes HLS reproducibles.');
    variants.sort((a,b) => b.bandwidth-a.bandwidth);
    return resolveMediaPlaylist(variants[0].url);
  }
  return { lines, baseUrl: finalUrl };
}

async function downloadHls(url, filename) {
  const { lines, baseUrl } = await resolveMediaPlaylist(url);
  let initUrl = null;
  const segments = [];
  for (const line of lines) {
    if (line.startsWith('#EXT-X-MAP:')) {
      const a = parseAttrs(line.slice(line.indexOf(':')+1));
      if (a.URI) initUrl = abs(baseUrl, a.URI);
    } else if (!line.startsWith('#')) {
      segments.push(abs(baseUrl, line));
    }
  }
  if (!segments.length) throw new Error('No se encontraron segmentos en el playlist.');
  if (segments.length > 6000) throw new Error('Playlist demasiado grande para esta versión inicial.');

  const blobs = [];
  if (initUrl) {
    const r = await fetch(initUrl, { credentials: 'include' });
    if (!r.ok) throw new Error(`No se pudo descargar el segmento de inicialización (${r.status}).`);
    blobs.push(await r.arrayBuffer());
  }
  for (let i=0;i<segments.length;i++) {
    const r = await fetch(segments[i], { credentials: 'include' });
    if (!r.ok) throw new Error(`Falló el segmento ${i+1}/${segments.length} (${r.status}).`);
    blobs.push(await r.arrayBuffer());
  }

  const ext = initUrl ? 'mp4' : 'ts';
  const mime = initUrl ? 'video/mp4' : 'video/mp2t';
  const blob = new Blob(blobs, { type: mime });
  const blobUrl = URL.createObjectURL(blob);
  try {
    const id = await chrome.downloads.download({ url: blobUrl, filename: filename || `video-${Date.now()}.${ext}`, saveAs: true });
    return { ok: true, id };
  } finally {
    setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'OFFSCREEN_DOWNLOAD_HLS') return;
  downloadHls(msg.url, msg.filename).then(sendResponse).catch(err => sendResponse({ ok:false, error:String(err?.message || err) }));
  return true;
});
