const OVERLAY_ID = "__media_inspector_overlay";
const LAZY_IMAGE_ATTRIBUTES = [
  "src",
  "data-src",
  "data-original",
  "data-lazy-src",
  "data-full",
  "data-full-src",
  "data-zoom-image",
  "data-image",
  "data-url"
];

let overlayEnabled = false;
let overlayRecords = [];
let overlayObserver = null;
let overlayFrame = 0;

function toAbsolute(value) {
  if (!value) return null;
  try {
    const url = new URL(value, document.baseURI);
    return ["http:", "https:", "data:", "blob:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function parseSrcset(value) {
  return (value || "")
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/))
    .map(([url, descriptor]) => ({ url: toAbsolute(url), descriptor: descriptor || "" }))
    .filter((item) => item.url);
}

function extensionKind(url) {
  if (/\.gif(?:$|[?#])/i.test(url)) return "gif";
  if (/\.svg(?:$|[?#])/i.test(url)) return "svg";
  if (/\.(woff2?|ttf|otf|eot)(?:$|[?#])/i.test(url)) return "font";
  if (/\.(mp4|webm|mov|m4v|mkv|m3u8|mpd)(?:$|[?#])/i.test(url)) return "video";
  return "image";
}

function metaContent(selector) {
  return toAbsolute(document.querySelector(selector)?.content);
}

function isRendered(element) {
  const rectangle = element.getBoundingClientRect();
  if (rectangle.width < 1 || rectangle.height < 1) return false;
  const style = getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0;
}

function allElements(selector) {
  const found = [...document.querySelectorAll(selector)];
  const scanShadowRoots = (root) => {
    for (const element of root.querySelectorAll("*")) {
      if (!element.shadowRoot) continue;
      found.push(...element.shadowRoot.querySelectorAll(selector));
      scanShadowRoots(element.shadowRoot);
    }
  };
  scanShadowRoots(document);
  return [...new Set(found)];
}

function serializeSvg(svg) {
  const clone = svg.cloneNode(true);
  if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const markup = new XMLSerializer().serializeToString(clone);
  if (markup.length > 750000) return null;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}

function imageItems(deep = false) {
  const items = [];
  const push = (item) => {
    if (item?.url) items.push({ source: deep ? "deep-scan" : "dom", ...item });
  };

  for (const img of allElements("img")) {
    const rectangle = img.getBoundingClientRect();
    const common = {
      width: img.naturalWidth || Number(img.width) || Math.round(rectangle.width) || null,
      height: img.naturalHeight || Number(img.height) || Math.round(rectangle.height) || null,
      visible: isRendered(img),
      label: img.alt || img.title || "Imagen"
    };
    const candidates = [
      { url: toAbsolute(img.currentSrc), descriptor: "", originalHint: false },
      ...parseSrcset(img.srcset).map((item) => ({ ...item, originalHint: /\b\d{3,5}w\b/i.test(item.descriptor) })),
      ...parseSrcset(img.getAttribute("data-srcset")).map((item) => ({ ...item, originalHint: true }))
    ];
    for (const attribute of LAZY_IMAGE_ATTRIBUTES) {
      const value = img.getAttribute(attribute);
      if (value) candidates.push({ url: toAbsolute(value), descriptor: "", originalHint: attribute !== "src" });
    }
    for (const candidate of candidates) {
      if (!candidate.url) continue;
      push({
        ...common,
        url: candidate.url,
        kind: extensionKind(candidate.url),
        thumbnail: candidate.url,
        descriptor: candidate.descriptor,
        originalHint: candidate.originalHint
      });
    }

    const linked = toAbsolute(img.closest("a[href]")?.href);
    if (linked && /\.(avif|webp|png|jpe?g|bmp|gif|svg)(?:$|[?#])/i.test(linked)) {
      push({ ...common, url: linked, kind: extensionKind(linked), thumbnail: linked, originalHint: true, label: `${common.label} · original enlazado` });
    }
  }

  for (const source of allElements("picture source, source[srcset]")) {
    for (const candidate of [...parseSrcset(source.srcset), ...parseSrcset(source.getAttribute("data-srcset"))]) {
      push({
        url: candidate.url,
        kind: extensionKind(candidate.url),
        thumbnail: candidate.url,
        descriptor: candidate.descriptor,
        originalHint: true,
        visible: isRendered(source.parentElement || source),
        label: "Variante de imagen"
      });
    }
  }

  const backgrounds = allElements("body *");
  const limit = deep ? 15000 : 4000;
  for (const node of backgrounds.slice(0, limit)) {
    const background = getComputedStyle(node).backgroundImage;
    if (!background || background === "none") continue;
    for (const match of background.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
      const url = toAbsolute(match[1]);
      if (!url) continue;
      const rectangle = node.getBoundingClientRect();
      push({
        url,
        kind: extensionKind(url),
        thumbnail: url,
        width: Math.round(rectangle.width) || null,
        height: Math.round(rectangle.height) || null,
        visible: isRendered(node),
        label: "Imagen de fondo"
      });
    }
  }

  if (deep) {
    for (const element of allElements("[data-src], [data-original], [data-full], [data-full-src], [data-zoom-image], [data-image]")) {
      for (const attribute of LAZY_IMAGE_ATTRIBUTES.slice(1)) {
        const url = toAbsolute(element.getAttribute(attribute));
        if (!url || !/\.(avif|webp|png|jpe?g|bmp|gif|svg)(?:$|[?#])/i.test(url)) continue;
        push({ url, kind: extensionKind(url), thumbnail: url, visible: isRendered(element), originalHint: true, label: "Imagen diferida/original" });
      }
    }

    for (const link of allElements('a[href], link[href][rel="preload"], link[href][rel="image_src"]')) {
      const url = toAbsolute(link.href);
      if (!url || !/\.(avif|webp|png|jpe?g|bmp|gif|svg)(?:$|[?#])/i.test(url)) continue;
      push({ url, kind: extensionKind(url), thumbnail: url, visible: isRendered(link), originalHint: true, label: link.textContent?.trim().slice(0, 80) || "Imagen enlazada" });
    }

    for (const entry of performance.getEntriesByType("resource")) {
      const url = toAbsolute(entry.name);
      if (!url || !/\.(avif|webp|png|jpe?g|bmp|gif|svg)(?:$|[?#])/i.test(url)) continue;
      push({ url, kind: extensionKind(url), thumbnail: url, label: "Imagen cargada por la página" });
    }
  }

  return items;
}

function scanPage(deep = false) {
  const items = [...imageItems(deep)];
  const pageImage = metaContent('meta[property="og:image"]') || metaContent('meta[name="twitter:image"]');
  const push = (item) => {
    if (item?.url) items.push({ source: deep ? "deep-scan" : "dom", ...item });
  };

  for (const video of allElements("video")) {
    const poster = toAbsolute(video.poster) || pageImage;
    const candidates = [video.currentSrc, video.src, ...[...video.querySelectorAll("source")].map((node) => node.src)];
    candidates.map(toAbsolute).filter(Boolean).forEach((url) => push({
      url,
      kind: "video",
      poster,
      thumbnail: poster,
      width: video.videoWidth || Number(video.getAttribute("width")) || Math.round(video.getBoundingClientRect().width) || null,
      height: video.videoHeight || Number(video.getAttribute("height")) || Math.round(video.getBoundingClientRect().height) || null,
      duration: Number.isFinite(video.duration) ? video.duration : null,
      visible: isRendered(video),
      label: video.getAttribute("aria-label") || video.title || "Video"
    }));
  }

  for (const link of allElements("a[href]")) {
    const url = toAbsolute(link.href);
    if (!url || !/\.(mp4|webm|mov|m4v|mkv|m3u8|mpd|gif|svg|woff2?|ttf|otf|eot)(?:$|[?#])/i.test(url)) continue;
    push({ url, kind: extensionKind(url), label: link.textContent.trim().slice(0, 80) });
  }

  allElements("svg").forEach((svg, index) => {
    if (index >= (deep ? 300 : 120) || svg.closest(`#${OVERLAY_ID}`)) return;
    const url = serializeSvg(svg);
    if (!url) return;
    push({
      url,
      kind: "svg",
      thumbnail: url,
      width: Number(svg.getAttribute("width")) || Math.round(svg.getBoundingClientRect().width) || null,
      height: Number(svg.getAttribute("height")) || Math.round(svg.getBoundingClientRect().height) || null,
      visible: isRendered(svg),
      label: svg.getAttribute("aria-label") || svg.id || `SVG inline ${index + 1}`,
      inline: true
    });
  });

  const fontUrls = new Set();
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules || []) {
        const text = rule.cssText || "";
        if (!text.startsWith("@font-face")) continue;
        const family = (text.match(/font-family:\s*["']?([^;"']+)/i) || [])[1]?.trim() || "Fuente";
        for (const match of text.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
          const url = toAbsolute(match[1]);
          if (url && !fontUrls.has(url)) {
            fontUrls.add(url);
            push({ url, kind: "font", label: family });
          }
        }
      }
    } catch {
      // Las hojas de estilo de otro origen no permiten leer cssRules.
    }
  }

  for (const entry of performance.getEntriesByType("resource")) {
    const url = toAbsolute(entry.name);
    if (!url) continue;
    const kind = extensionKind(url);
    if (["video", "gif", "svg", "font"].includes(kind)) push({ url, kind, label: "Recurso detectado" });
  }

  if (pageImage) push({ url: pageImage, kind: extensionKind(pageImage), thumbnail: pageImage, originalHint: true, label: "Imagen principal" });

  return {
    page: {
      title: document.title,
      url: location.href,
      host: location.hostname,
      image: pageImage
    },
    items
  };
}

function overlayItemFor(element) {
  if (element instanceof HTMLImageElement) {
    const url = toAbsolute(element.currentSrc || element.src || element.getAttribute("data-src"));
    return url ? { url, kind: extensionKind(url), label: element.alt || element.title || "imagen" } : null;
  }
  if (element instanceof HTMLVideoElement) {
    const url = toAbsolute(element.currentSrc || element.src || element.querySelector("source")?.src);
    return url ? { url, kind: "video", label: element.getAttribute("aria-label") || element.title || "video" } : null;
  }
  if (element instanceof SVGElement) {
    const url = serializeSvg(element);
    return url ? { url, kind: "svg", label: element.getAttribute("aria-label") || element.id || "grafico-svg" } : null;
  }
  return null;
}

function updateOverlayPositions() {
  overlayFrame = 0;
  for (const record of overlayRecords) {
    const rectangle = record.element.getBoundingClientRect();
    const visible = rectangle.width >= 80 && rectangle.height >= 50 && rectangle.bottom > 0 && rectangle.right > 0 && rectangle.top < innerHeight && rectangle.left < innerWidth;
    record.button.hidden = !visible;
    if (!visible) continue;
    record.button.style.top = `${Math.max(6, rectangle.top + 7)}px`;
    record.button.style.left = `${Math.min(innerWidth - 38, rectangle.right - 37)}px`;
  }
}

function scheduleOverlayUpdate() {
  if (!overlayFrame) overlayFrame = requestAnimationFrame(updateOverlayPositions);
}

function buildOverlayButtons() {
  if (!overlayEnabled) return;
  const root = document.getElementById(OVERLAY_ID);
  if (!root) return;
  root.replaceChildren();
  overlayRecords = [];
  const targets = allElements("img, video, svg").filter((element) => !element.closest(`#${OVERLAY_ID}`)).slice(0, 800);
  for (const element of targets) {
    const item = overlayItemFor(element);
    if (!item || item.url.startsWith("blob:")) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "↓";
    button.title = `Descargar ${item.kind}`;
    button.setAttribute("aria-label", `Descargar ${item.kind}`);
    Object.assign(button.style, {
      position: "fixed",
      width: "30px",
      height: "30px",
      padding: "0",
      border: "1px solid rgba(255,255,255,.75)",
      borderRadius: "9px",
      color: "white",
      background: "rgba(31,85,220,.92)",
      boxShadow: "0 4px 14px rgba(20,35,70,.28)",
      cursor: "pointer",
      font: "700 18px/28px system-ui, sans-serif",
      pointerEvents: "auto",
      zIndex: "2147483647"
    });
    button.addEventListener("mouseenter", () => { button.style.background = "rgba(20,65,190,.98)"; });
    button.addEventListener("mouseleave", () => { button.style.background = "rgba(31,85,220,.92)"; });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      chrome.runtime.sendMessage({ type: "DOWNLOAD_RESOURCE", ...item }, (response) => {
        if (!response?.ok) {
          button.textContent = "!";
          setTimeout(() => { button.textContent = "↓"; }, 1200);
        }
      });
    }, true);
    root.appendChild(button);
    overlayRecords.push({ element, button });
  }
  updateOverlayPositions();
}

function setOverlayEnabled(enabled) {
  const host = location.hostname.replace(/^www\./, "");
  overlayEnabled = Boolean(enabled) && host !== "youtube.com" && !host.endsWith(".youtube.com") && host !== "youtu.be";
  document.getElementById(OVERLAY_ID)?.remove();
  overlayObserver?.disconnect();
  overlayObserver = null;
  overlayRecords = [];
  if (!overlayEnabled) return;

  const root = document.createElement("div");
  root.id = OVERLAY_ID;
  root.setAttribute("aria-hidden", "true");
  Object.assign(root.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: "2147483647" });
  document.documentElement.appendChild(root);
  buildOverlayButtons();
  overlayObserver = new MutationObserver((mutations) => {
    if (mutations.every((mutation) => root.contains(mutation.target))) return;
    clearTimeout(overlayObserver.refreshTimer);
    overlayObserver.refreshTimer = setTimeout(buildOverlayButtons, 350);
  });
  overlayObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "srcset", "data-src"] });
}

addEventListener("scroll", scheduleOverlayUpdate, { passive: true, capture: true });
addEventListener("resize", scheduleOverlayUpdate, { passive: true });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "SCAN_PAGE" || message?.type === "DEEP_SCAN_IMAGES") {
    try {
      sendResponse(scanPage(message.type === "DEEP_SCAN_IMAGES"));
    } catch (error) {
      sendResponse({ page: { title: document.title, url: location.href, host: location.hostname }, items: [], error: error.message });
    }
    return false;
  }

  if (message?.type === "TOGGLE_PAGE_BUTTONS") {
    setOverlayEnabled(message.enabled);
    sendResponse({ enabled: overlayEnabled });
    return false;
  }

  if (message?.type === "GET_PAGE_BUTTONS") {
    sendResponse({ enabled: overlayEnabled });
    return false;
  }

  return false;
});

chrome.storage.sync.get({ pageButtons: true }, ({ pageButtons }) => setOverlayEnabled(pageButtons));
