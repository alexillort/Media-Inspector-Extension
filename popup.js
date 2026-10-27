const state = {
  tabId: null,
  page: null,
  items: [],
  category: "video",
  restricted: false
};

const elements = {
  site: document.querySelector("#site"),
  status: document.querySelector("#status"),
  results: document.querySelector("#results"),
  notice: document.querySelector("#notice"),
  tabs: document.querySelector("#tabs"),
  search: document.querySelector("#search"),
  bestOnly: document.querySelector("#bestOnly"),
  imageFilter: document.querySelector("#imageFilter"),
  captureAll: document.querySelector("#captureAll"),
  pageButtons: document.querySelector("#pageButtons"),
  refresh: document.querySelector("#refresh"),
  downloadAll: document.querySelector("#downloadAll")
};

const labels = { video: "Video", image: "Imagen", gif: "GIF", svg: "SVG", font: "Fuente" };

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => resolve(response || {}));
  });
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(response || null);
    });
  });
}

function urlName(url) {
  if (url.startsWith("data:")) return "recurso-inline";
  try {
    const parsed = new URL(url);
    return decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || parsed.hostname);
  } catch {
    return "recurso";
  }
}

function safeName(name, fallback = "recurso") {
  return (name || fallback).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 180) || fallback;
}

function inferExtension(item) {
  if (item.kind === "svg") return ".svg";
  if (item.kind === "gif") return ".gif";
  const match = item.url.match(/\.(mp4|webm|mov|m4v|mkv|m3u8|mpd|avif|webp|png|jpe?g|bmp|ico|woff2?|ttf|otf|eot)(?:$|[?#])/i);
  return match ? `.${match[1].toLowerCase()}` : "";
}

function filenameFor(item) {
  const raw = item.inline ? item.label : urlName(item.url);
  let name = safeName(raw, `${item.kind}-${Date.now()}`);
  const extension = inferExtension(item);
  if (extension && !name.toLowerCase().endsWith(extension)) name += extension;
  return name;
}

function normalizedFamily(item) {
  if (item.inline) return item.url.slice(0, 90);
  try {
    const parsed = new URL(item.url);
    const path = parsed.pathname
      .toLowerCase()
      .replace(/([_-])(\d{2,4})p(?=[_.-]|$)/g, "")
      .replace(/([_-])\d{2,4}x\d{2,4}(?=[_.-]|$)/g, "")
      .replace(/([_-])(small|medium|large|thumb|thumbnail|original|master)(?=[_.-]|$)/g, "");
    return `${item.kind}:${parsed.hostname}:${path}`;
  } catch {
    return `${item.kind}:${item.url.slice(0, 120)}`;
  }
}

function score(item) {
  const dimensions = (Number(item.width) || 0) * (Number(item.height) || 0);
  const descriptor = Number((item.descriptor || "").replace(/\D/g, "")) || 0;
  const bitrate = Number(item.bitrate) || 0;
  return dimensions * 100 + descriptor * 10000 + bitrate + (item.source === "dom" ? 10 : 0);
}

function dedupe(items) {
  const byUrl = new Map();
  for (const item of items) {
    if (!item?.url || !item.kind) continue;
    const existing = byUrl.get(item.url);
    if (!existing || score(item) > score(existing)) byUrl.set(item.url, { ...existing, ...item });
  }
  return [...byUrl.values()];
}

function bestOnly(items) {
  const groups = new Map();
  for (const item of items) {
    const key = normalizedFamily(item);
    const current = groups.get(key);
    if (!current || score(item) > score(current)) groups.set(key, item);
  }
  return [...groups.values()];
}

function visibleItems() {
  const query = elements.search.value.trim().toLowerCase();
  let items = state.items.filter((item) => item.kind === state.category);
  if (state.category === "image") {
    const filter = elements.imageFilter.value;
    if (filter === "visible") items = items.filter((item) => item.visible === true);
    if (filter === "large") items = items.filter((item) => Math.max(Number(item.width) || 0, Number(item.height) || 0, Number((item.descriptor || "").replace(/\D/g, "")) || 0) >= 500);
    if (filter === "original") {
      items = bestOnly(items).filter((item) => item.originalHint || Math.max(Number(item.width) || 0, Number(item.height) || 0) >= 1000);
    }
  }
  if (elements.bestOnly.checked) items = bestOnly(items);
  if (query) {
    items = items.filter((item) => `${item.label || ""} ${item.url} ${item.codec || ""}`.toLowerCase().includes(query));
  }
  return items.sort((a, b) => score(b) - score(a));
}

function dimensions(item) {
  if (item.width && item.height) return `${item.width} × ${item.height}`;
  if (item.descriptor) return item.descriptor;
  return "Dimensiones no disponibles";
}

function quality(item) {
  if (item.height) return item.height >= 2160 ? "4K" : `${item.height}p`;
  if (item.stream) return item.source?.toUpperCase() || "STREAM";
  return labels[item.kind] || "Archivo";
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character]));
}

function previewMarkup(item) {
  const src = item.poster || item.thumbnail || (["image", "gif", "svg"].includes(item.kind) ? item.url : "");
  const directVideo = item.kind === "video" && !item.stream && !item.url.startsWith("blob:") && !/\.(m3u8|mpd)(?:$|[?#])/i.test(item.url);
  if (directVideo) {
    const poster = item.poster ? ` poster="${escapeHtml(item.poster)}"` : "";
    const previewUrl = `${item.url}${item.url.includes("#") ? "" : "#t=0.1"}`;
    return `<div class="preview"><span class="video-fallback">▶</span><video src="${escapeHtml(previewUrl)}"${poster} muted playsinline preload="metadata"></video><span class="quality">${escapeHtml(quality(item))}</span></div>`;
  }
  if (src && !src.startsWith("blob:")) {
    const contain = item.kind === "svg" ? " contain" : "";
    return `<div class="preview${contain}"><img src="${escapeHtml(src)}" alt="" referrerpolicy="no-referrer"><span class="quality">${escapeHtml(quality(item))}</span></div>`;
  }
  const fallback = item.kind === "font" ? "Aa" : item.kind === "video" ? "▶" : labels[item.kind];
  return `<div class="preview"><span>${escapeHtml(fallback)}</span><span class="quality">${escapeHtml(quality(item))}</span></div>`;
}

function prepareVideoPreviews() {
  for (const video of elements.results.querySelectorAll("video")) {
    const reveal = () => { video.style.opacity = "1"; };
    video.style.opacity = "0";
    video.addEventListener("loadeddata", reveal, { once: true });
    video.addEventListener("loadedmetadata", () => {
      try { video.currentTime = Math.min(0.12, Number.isFinite(video.duration) ? video.duration / 2 : 0.12); } catch { reveal(); }
    }, { once: true });
    video.addEventListener("error", () => { video.style.display = "none"; }, { once: true });
  }
}

function renderCounts() {
  for (const button of elements.tabs.querySelectorAll(".tab")) {
    const kind = button.dataset.kind;
    const count = bestOnly(state.items.filter((item) => item.kind === kind)).length;
    button.querySelector("span").textContent = count;
  }
}

function render() {
  renderCounts();
  const items = visibleItems();
  const imageMode = state.category === "image";
  elements.imageFilter.disabled = !imageMode;
  elements.captureAll.disabled = !imageMode;
  elements.status.classList.toggle("hidden", items.length > 0);
  elements.status.textContent = state.items.length ? "No hay recursos en esta categoría." : "No se detectaron recursos descargables.";
  elements.results.innerHTML = items.map((item, index) => {
    const title = item.label || urlName(item.url);
    const streamNote = item.stream ? `<span class="badge">manifiesto/flujo</span>` : "";
    const meta = `${dimensions(item)}${item.codec ? ` · ${escapeHtml(item.codec)}` : ""}${item.bitrate ? ` · ${Math.round(item.bitrate / 1000)} kbps` : ""}`;
    const disabled = state.restricted || item.url.startsWith("blob:");
    return `<article class="card" data-index="${index}">
      ${previewMarkup(item)}
      <div class="card-content">
        <p class="title" title="${escapeHtml(title)}">${escapeHtml(title)}</p>
        <p class="meta">${streamNote}${escapeHtml(meta)}</p>
        <div class="actions">
          <button class="download" data-action="download" ${disabled ? "disabled" : ""}>Descargar</button>
          <button class="open" data-action="open" title="Abrir en otra pestaña" aria-label="Abrir en otra pestaña" ${item.url.startsWith("blob:") ? "disabled" : ""}>↗</button>
          <button class="copy" data-action="copy" title="Copiar URL" aria-label="Copiar URL">⧉</button>
          ${item.stream ? '<button class="inspect" data-action="inspect">Calidades</button>' : ""}
        </div>
      </div>
    </article>`;
  }).join("");
  elements.downloadAll.disabled = state.restricted || items.length === 0 || items.every((item) => item.url.startsWith("blob:"));
  prepareVideoPreviews();
}

async function downloadItem(item) {
  if (state.restricted || item.url.startsWith("blob:")) return;
  await chrome.downloads.download({
    url: item.url,
    filename: `Media Inspector/${filenameFor(item)}`,
    saveAs: false,
    conflictAction: "uniquify"
  });
}

async function inspectStream(item) {
  const button = elements.results.querySelector(`[data-index="${visibleItems().indexOf(item)}"] [data-action="inspect"]`);
  if (button) { button.disabled = true; button.textContent = "Leyendo…"; }
  const response = await sendMessage({ type: "INSPECT_MANIFEST", url: item.url });
  if (response.items?.length) {
    state.items = dedupe([...state.items, ...response.items.map((variant) => ({ ...variant, poster: item.poster || state.page?.image }))]);
    render();
  } else {
    elements.notice.textContent = response.error
      ? `No fue posible leer las variantes del flujo: ${response.error}`
      : "Este manifiesto no expone variantes descargables de forma directa.";
    elements.notice.classList.remove("hidden");
    render();
  }
}

function isRestrictedPage(pageUrl) {
  try {
    const host = new URL(pageUrl).hostname.replace(/^www\./, "");
    return host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be";
  } catch {
    return false;
  }
}

async function load() {
  elements.status.classList.remove("hidden");
  elements.status.textContent = "Buscando recursos…";
  elements.results.innerHTML = "";
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/i.test(tab.url || "")) {
    elements.site.textContent = "Abre una página web para analizarla";
    elements.status.textContent = "Esta página interna del navegador no se puede analizar.";
    return;
  }
  state.tabId = tab.id;
  const [dom, observed] = await Promise.all([
    sendTabMessage(tab.id, { type: "SCAN_PAGE" }),
    sendMessage({ type: "GET_OBSERVED", tabId: tab.id })
  ]);
  state.page = dom?.page || { title: tab.title, url: tab.url, host: new URL(tab.url).hostname };
  state.restricted = isRestrictedPage(state.page.url);
  const networkItems = (observed.items || []).map((item) => ({ ...item, poster: state.page.image }));
  state.items = dedupe([...(dom?.items || []), ...networkItems]);
  const settings = await chrome.storage.sync.get({ pageButtons: true });
  elements.pageButtons.checked = Boolean(settings.pageButtons) && !state.restricted;
  elements.site.textContent = `${state.page.title || state.page.host} · ${state.page.host || ""}`;
  elements.notice.classList.toggle("hidden", !state.restricted);
  if (state.restricted) {
    elements.notice.textContent = "YouTube detectado: se muestra información de los recursos, pero la descarga está deshabilitada. Usa las opciones oficiales para tus propios videos.";
  }
  render();
}

async function captureAllImages() {
  if (!state.tabId) return;
  const previous = elements.captureAll.textContent;
  elements.captureAll.disabled = true;
  elements.captureAll.textContent = "Capturando…";
  const result = await sendTabMessage(state.tabId, { type: "DEEP_SCAN_IMAGES" });
  if (result?.items) {
    state.items = dedupe([...state.items, ...result.items]);
    state.category = "image";
    elements.tabs.querySelector(".active")?.classList.remove("active");
    elements.tabs.querySelector('[data-kind="image"]')?.classList.add("active");
    elements.imageFilter.value = "all";
  }
  elements.captureAll.textContent = previous;
  elements.captureAll.disabled = false;
  render();
}

elements.tabs.addEventListener("click", (event) => {
  const button = event.target.closest(".tab");
  if (!button) return;
  elements.tabs.querySelector(".active")?.classList.remove("active");
  button.classList.add("active");
  state.category = button.dataset.kind;
  render();
});

elements.results.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  const card = event.target.closest(".card");
  if (!button || !card) return;
  const item = visibleItems()[Number(card.dataset.index)];
  if (!item) return;
  if (button.dataset.action === "download") await downloadItem(item);
  if (button.dataset.action === "open" && !item.url.startsWith("blob:")) await chrome.tabs.create({ url: item.url, active: false });
  if (button.dataset.action === "copy") {
    await navigator.clipboard.writeText(item.url);
    const previous = button.textContent;
    button.textContent = "Copiado";
    setTimeout(() => { button.textContent = previous; }, 900);
  }
  if (button.dataset.action === "inspect") await inspectStream(item);
});

elements.search.addEventListener("input", render);
elements.bestOnly.addEventListener("change", render);
elements.imageFilter.addEventListener("change", render);
elements.captureAll.addEventListener("click", captureAllImages);
elements.pageButtons.addEventListener("change", async () => {
  const enabled = elements.pageButtons.checked;
  await chrome.storage.sync.set({ pageButtons: enabled });
  if (state.tabId) await sendTabMessage(state.tabId, { type: "TOGGLE_PAGE_BUTTONS", enabled });
});
elements.refresh.addEventListener("click", load);
elements.downloadAll.addEventListener("click", async () => {
  const downloadable = visibleItems().filter((item) => !item.url.startsWith("blob:"));
  for (const item of downloadable) await downloadItem(item);
});

load();
