const RESOURCE_LIMIT = 1200;
const observedByTab = new Map();

const EXTENSIONS = {
  video: /\.(mp4|webm|mov|m4v|mkv)(?:$|[?#])/i,
  stream: /\.(m3u8|mpd)(?:$|[?#])/i,
  image: /\.(avif|webp|png|jpe?g|bmp|ico)(?:$|[?#])/i,
  gif: /\.gif(?:$|[?#])/i,
  svg: /\.svg(?:$|[?#])/i,
  font: /\.(woff2?|ttf|otf|eot)(?:$|[?#])/i
};

function classify(url, requestType) {
  if (EXTENSIONS.stream.test(url)) return "video";
  if (EXTENSIONS.video.test(url) || requestType === "media") return "video";
  if (EXTENSIONS.gif.test(url)) return "gif";
  if (EXTENSIONS.svg.test(url)) return "svg";
  if (EXTENSIONS.font.test(url) || requestType === "font") return "font";
  if (EXTENSIONS.image.test(url) || requestType === "image") return "image";
  return null;
}

function remember(details) {
  if (details.tabId < 0 || !/^https?:/i.test(details.url)) return;
  const kind = classify(details.url, details.type);
  if (!kind) return;
  const tabItems = observedByTab.get(details.tabId) || new Map();
  tabItems.set(details.url, {
    url: details.url,
    kind,
    source: "network",
    detectedAt: Date.now()
  });
  while (tabItems.size > RESOURCE_LIMIT) {
    tabItems.delete(tabItems.keys().next().value);
  }
  observedByTab.set(details.tabId, tabItems);
}

chrome.webRequest.onBeforeRequest.addListener(
  remember,
  { urls: ["<all_urls>"] }
);

chrome.tabs.onRemoved.addListener((tabId) => observedByTab.delete(tabId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") observedByTab.delete(tabId);
});

function absoluteUrl(value, base) {
  try {
    return new URL(value, base).href;
  } catch {
    return null;
  }
}

function parseAttributeList(line) {
  const result = {};
  const source = line.slice(line.indexOf(":") + 1);
  const expression = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
  let match;
  while ((match = expression.exec(source))) {
    result[match[1].toUpperCase()] = match[2].replace(/^"|"$/g, "");
  }
  return result;
}

function parseHls(text, manifestUrl) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const variants = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].startsWith("#EXT-X-STREAM-INF:")) continue;
    const attributes = parseAttributeList(lines[index]);
    const next = lines.slice(index + 1).find((line) => !line.startsWith("#"));
    const url = next ? absoluteUrl(next, manifestUrl) : null;
    if (!url) continue;
    const resolution = attributes.RESOLUTION || "";
    const [width, height] = resolution.split("x").map(Number);
    variants.push({
      url,
      kind: "video",
      source: "hls",
      stream: true,
      width: width || null,
      height: height || null,
      bitrate: Number(attributes["AVERAGE-BANDWIDTH"] || attributes.BANDWIDTH) || null,
      codec: attributes.CODECS || "",
      label: height ? `${height}p · HLS` : "HLS"
    });
  }
  return variants;
}

function parseDash(text, manifestUrl) {
  const variants = [];
  const representation = /<Representation\b([^>]*)>([\s\S]*?)<\/Representation>/gi;
  let match;
  while ((match = representation.exec(text))) {
    const attrs = match[1];
    const body = match[2];
    const width = Number((attrs.match(/\bwidth="(\d+)"/i) || [])[1]) || null;
    const height = Number((attrs.match(/\bheight="(\d+)"/i) || [])[1]) || null;
    const bitrate = Number((attrs.match(/\bbandwidth="(\d+)"/i) || [])[1]) || null;
    const codec = (attrs.match(/\bcodecs="([^"]+)"/i) || [])[1] || "";
    const base = (body.match(/<BaseURL[^>]*>([^<]+)<\/BaseURL>/i) || [])[1];
    const url = base ? absoluteUrl(base.trim(), manifestUrl) : null;
    if (!url) continue;
    variants.push({
      url,
      kind: "video",
      source: "dash",
      stream: true,
      width,
      height,
      bitrate,
      codec,
      label: height ? `${height}p · DASH` : "DASH"
    });
  }
  return variants;
}

async function inspectManifest(url) {
  if (!EXTENSIONS.stream.test(url)) return [];
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  return /\.m3u8(?:$|[?#])/i.test(url)
    ? parseHls(text, url)
    : parseDash(text, url);
}

function safeName(name, fallback = "recurso") {
  return (name || fallback).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 180) || fallback;
}

function extensionFor(url, kind) {
  if (kind === "svg") return ".svg";
  if (kind === "gif") return ".gif";
  const match = String(url).match(/\.(mp4|webm|mov|m4v|mkv|m3u8|mpd|avif|webp|png|jpe?g|bmp|ico|woff2?|ttf|otf|eot)(?:$|[?#])/i);
  return match ? `.${match[1].toLowerCase()}` : "";
}

async function downloadResource(message) {
  const { url, label, kind } = message;
  if (!url || String(url).startsWith("blob:")) throw new Error("URL no descargable");
  let name = safeName(label || `recurso-${Date.now()}`);
  const extension = extensionFor(url, kind);
  if (extension && !name.toLowerCase().endsWith(extension)) name += extension;
  return chrome.downloads.download({
    url,
    filename: `Media Inspector/${name}`,
    saveAs: false,
    conflictAction: "uniquify"
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GET_OBSERVED") {
    const items = [...(observedByTab.get(message.tabId)?.values() || [])];
    sendResponse({ items });
    return false;
  }

  if (message?.type === "INSPECT_MANIFEST") {
    inspectManifest(message.url)
      .then((items) => sendResponse({ items }))
      .catch((error) => sendResponse({ items: [], error: error.message }));
    return true;
  }

  if (message?.type === "DOWNLOAD_RESOURCE") {
    downloadResource(message)
      .then((downloadId) => sendResponse({ ok: true, downloadId }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});
