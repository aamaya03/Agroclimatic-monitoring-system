// ====================================
// Sistema de Monitoreo Agroclimático 
// ====================================

(() => {
  "use strict";

  // -------------------
  // Estado 
  // -------------------
  const state = {
    catalog: null,
    lotes: null,            // GeoJSON FeatureCollection
    lotesById: new Map(),   // id 
    stats: {},              // sensor 
    sensor: null,
    index: null,
    start: null,
    end: null,
    showRaster: true,
    mode: null,             // null | "lote" | "poligono"
    selectedLotes: [],      // máx. 2 ids
    polygon: null,          // [[lng, lat], ...] anillo cerrado
    chartType: "ts",
    showSmooth: true,       // líneas suavizadas en la serie de tiempo
    lastTable: null,        // { columns, rows } para CSV
  };

  const rasterCache = new Map(); // url 
  const maskCache = new Map();   // clave geometría+grilla 

  // ------------------------------------------------------------------
  // Utilidades
  // ------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const fmt = (v, d = 4) => (v == null || Number.isNaN(v) ? "" : (+v).toFixed(d));

  // Fecha ISO (2026-04-23) -> texto legible (Apr 23, 2026)
  function fmtDate(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  // Ícono del cultivo (CROP_ICONS en config.js)
  function cropIcon(crop) {
    const norm = String(crop ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const hit = CROP_ICONS.find((c) => c.match.some((w) => norm.includes(w)));
    const paths = hit ? hit.icon : CROP_ICON_DEFAULT;
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  }

  function showLoading(text = "") {
    $("loading-text").textContent = text;
    $("loading-screen").classList.remove("hidden");
  }
  function hideLoading() { $("loading-screen").classList.add("hidden"); }

  // ------------------------------------------------------------------
  // Avisos: guía (coach), toast, tarjeta del índice y modal de error
  // ------------------------------------------------------------------
  const ICON = {
    x: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    polygon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3 21 9.5 17.5 20h-11L3 9.5z"/><circle cx="12" cy="3" r="1.2" fill="currentColor"/><circle cx="21" cy="9.5" r="1.2" fill="currentColor"/><circle cx="17.5" cy="20" r="1.2" fill="currentColor"/><circle cx="6.5" cy="20" r="1.2" fill="currentColor"/><circle cx="3" cy="9.5" r="1.2" fill="currentColor"/></svg>',
    plot: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg>',
    click: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h3M12 3v3M7.8 7.8 5.6 5.6M16.2 7.8l2.2-2.2M7.8 16.2l-2.2 2.2M12 12l9 3-4 2-2 4z"/></svg>',
    alert: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg>',
  };
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // Preferencias del usuario ("Don't show again"); si el navegador no deja guardar, se ignora
  const prefs = {
    get(k) { try { return localStorage.getItem(`monitoreo:${k}`) === "1"; } catch { return false; } },
    set(k) { try { localStorage.setItem(`monitoreo:${k}`, "1"); } catch { /* sin almacenamiento */ } },
  };

  // --- Guía sobre el mapa (no bloquea) ---
  function showCoach(key, icon, title, steps) {
    const box = $("coach");
    if (prefs.get(`hide-${key}`)) { box.classList.add("hidden"); return; }
    box.innerHTML = `
      <div class="badge-icon accent">${ICON[icon]}</div>
      <div class="coach-body">
        <p class="coach-title">${esc(title)}</p>
        <ol class="coach-steps">${steps.map((t) => `<li>${t}</li>`).join("")}</ol>
        <div class="coach-foot">
          <label class="coach-check"><input type="checkbox" id="coach-hide"> Don't show again</label>
          <button class="btn btn-sm" id="coach-ok">Got it</button>
        </div>
      </div>
      <button class="icon-btn" id="coach-x" aria-label="Close">${ICON.x}</button>`;
    const close = () => {
      if ($("coach-hide").checked) prefs.set(`hide-${key}`);
      hideCoach();
    };
    $("coach-ok").onclick = close;
    $("coach-x").onclick = close;
    L.DomEvent.disableClickPropagation(box);
    box.classList.remove("hidden", "leaving");
  }
  function hideCoach() {
    const box = $("coach");
    if (box.classList.contains("hidden")) return;
    box.classList.add("leaving");
    setTimeout(() => box.classList.add("hidden"), 160);
  }

  // --- Aviso rápido (se va solo) ---
  function toast(html, { type = "warning", icon = "click", ms = 3500 } = {}) {
    const zone = $("toast-zone");
    zone.querySelectorAll(".toast").forEach((t) => t.remove()); // uno a la vez
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="toast-icon">${ICON[icon]}</span><span>${html}</span>`;
    zone.appendChild(el);
    setTimeout(() => { el.classList.add("leaving"); setTimeout(() => el.remove(), 200); }, ms);
  }

  function pulseModeButtons() {
    for (const id of ["btn-lote", "btn-poligono"]) {
      const b = $(id);
      b.classList.remove("pulse");
      void b.offsetWidth; // reinicia la animación
      b.classList.add("pulse");
    }
  }

  // --- Modal: solo para errores ---
  $("modal-icon").innerHTML = ICON.alert;
  $("modal-x").innerHTML = ICON.x;
  let modalAction = null;
  function showError(title, body, { action = null, onAction = null } = {}) {
    $("modal-title").textContent = title;
    $("modal-body").textContent = body;
    const btn = $("modal-action");
    modalAction = onAction;
    btn.textContent = action || "";
    btn.classList.toggle("hidden", !action);
    $("modal").classList.remove("hidden");
    (action ? btn : $("modal-close")).focus();
  }
  function closeModal() { $("modal").classList.add("hidden"); }
  $("modal-close").onclick = closeModal;
  $("modal-x").onclick = closeModal;
  $("modal-action").onclick = () => { closeModal(); if (modalAction) modalAction(); };
  $("modal").onclick = (e) => { if (e.target.id === "modal") closeModal(); };

  // --- Tarjeta de información del índice (botón ⓘ) ---
  function renderInfoPop() {
    const cfg = INDICES[state.index];
    $("info-pop").innerHTML = `
      <div class="pop-head">
        <div><span class="pop-abbr">${esc(state.index)}</span><span class="pop-name">${esc(cfg.name || "")}</span></div>
        <button class="icon-btn" id="pop-x" aria-label="Close">${ICON.x}</button>
      </div>
      <p class="pop-desc">${esc(cfg.info)}</p>`;
    $("pop-x").onclick = hideInfoPop;
  }
  function toggleInfoPop() {
    const pop = $("info-pop");
    if (!pop.classList.contains("hidden")) return hideInfoPop();
    renderInfoPop();
    pop.classList.remove("hidden");
    $("btn-info").setAttribute("aria-expanded", "true");
  }
  function hideInfoPop() {
    $("info-pop").classList.add("hidden");
    $("btn-info").setAttribute("aria-expanded", "false");
  }
  document.addEventListener("click", (e) => {
    const pop = $("info-pop");
    if (!pop.classList.contains("hidden") && !pop.contains(e.target) && e.target.id !== "btn-info") hideInfoPop();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    closeModal(); hideInfoPop(); hideCoach();
  });

  async function fetchJSON(path) {
    const r = await fetch(`${CONFIG.DATA_URL}/${path}`, { cache: "no-cache" });
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return r.json();
  }

  // Ejecuta tareas con un máximo de descargas simultáneas
  async function pool(items, worker, limit = CONFIG.MAX_PARALLEL_DOWNLOADS) {
    const out = new Array(items.length);
    let i = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await worker(items[k], k);
      }
    });
    await Promise.all(runners);
    return out;
  }

  function hexToRgb(hex) {
    let h = hex.replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // Interpolación lineal entre colores 
  function makeNumericPalette(colors, min, max) {
    const rgb = colors.map(hexToRgb);
    return (v) => {
      if (Number.isNaN(v)) return null;
      let t = max > min ? (v - min) / (max - min) : 0.5;
      t = Math.min(1, Math.max(0, t)) * (rgb.length - 1);
      const i = Math.min(Math.floor(t), rgb.length - 2);
      const f = t - i;
      return [0, 1, 2].map((c) => Math.round(rgb[i][c] + (rgb[i + 1][c] - rgb[i][c]) * f));
    };
  }

  // ------------------------------------------------------------------
  // Catálogo: qué capas y fechas existen para cada sensor
  // ------------------------------------------------------------------
  const sensorInfo = () => state.catalog.sensors[state.sensor];
  const layerInfo = (layer) => sensorInfo().layers[layer];

  function layersFor(indexKey) {
    const cfg = INDICES[indexKey];
    const layers = sensorInfo().layers;
    const analysis = layers[cfg.analysis] ? cfg.analysis : null;
    const display = layers[cfg.display] ? cfg.display : analysis;
    // Si no hay capa clasificada, el mapa se pinta con la continua
    const displayIsClass = display && layers[display].kind === "class";
    return { analysis, display, displayIsClass };
  }

  function datesInRange(layer) {
    const info = layerInfo(layer);
    if (!info) return [];
    return info.dates.filter((d) => d >= state.start && d <= state.end);
  }

  // ------------------------------------------------------------------
  // Lectura de GeoTIFF (equivale a terra::rast)
  // ------------------------------------------------------------------
  function loadRaster(layer, date) {
    const url = `${CONFIG.DATA_URL}/${state.sensor}/${layer}/${date}.tif`;
    if (!rasterCache.has(url)) {
      const info = layerInfo(layer);
      const p = (async () => {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`${url}: HTTP ${resp.status}`);
        const tiff = await GeoTIFF.fromArrayBuffer(await resp.arrayBuffer());
        const image = await tiff.getImage();
        const [band] = await image.readRasters();
        const width = image.getWidth();
        const height = image.getHeight();
        const [minX, minY, maxX, maxY] = image.getBoundingBox();
        const data = new Float32Array(band.length);
        const scale = info.scale || 1;
        const nodata = info.nodata;
        for (let k = 0; k < band.length; k++) {
          const v = band[k];
          data[k] = v === nodata || Number.isNaN(v) ? NaN : v / scale;
        }
        return { width, height, bbox: [minX, minY, maxX, maxY], data, date };
      })();
      p.catch(() => rasterCache.delete(url));
      rasterCache.set(url, p);
    }
    return rasterCache.get(url);
  }

  async function loadRasters(layer, dates, label) {
    let done = 0;
    return pool(dates, async (d) => {
      const r = await loadRaster(layer, d);
      done++;
      showLoading(`${label} ${done}/${dates.length}`);
      return r;
    });
  }

  // Promedio o moda por píxel 
  function composite(rasters, how) {
    const { width, height, bbox } = rasters[0];
    const n = width * height;
    const out = new Float32Array(n);
    if (how === "modal") {
      const counts = new Map();
      for (let k = 0; k < n; k++) {
        counts.clear();
        for (const r of rasters) {
          const v = r.data[k];
          if (!Number.isNaN(v)) counts.set(v, (counts.get(v) || 0) + 1);
        }
        if (!counts.size) { out[k] = NaN; continue; }
        let best = NaN, bestN = -1;
        for (const [v, c] of counts) {
          if (c > bestN || (c === bestN && v < best)) { best = v; bestN = c; }
        }
        out[k] = best;
      }
    } else {
      for (let k = 0; k < n; k++) {
        let s = 0, c = 0;
        for (const r of rasters) {
          const v = r.data[k];
          if (!Number.isNaN(v)) { s += v; c++; }
        }
        out[k] = c ? s / c : NaN;
      }
    }
    return { width, height, bbox, data: out };
  }

  // ------------------------------------------------------------------
  // Geometría: píxeles cuyo centro cae dentro del polígono
  // ------------------------------------------------------------------
  function geometryRings(geom) {
    if (geom.type === "Polygon") return geom.coordinates;
    if (geom.type === "MultiPolygon") return geom.coordinates.flat();
    return [];
  }

  function pointInRings(x, y, rings) {
    let inside = false; // regla par-impar: soporta huecos y multipolígonos
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
    return inside;
  }

  function maskFor(key, rings, raster) {
    const { width, height, bbox } = raster;
    const cacheKey = `${key}|${width}x${height}|${bbox.join(",")}`;
    if (maskCache.has(cacheKey)) return maskCache.get(cacheKey);
    const [minX, minY, maxX, maxY] = bbox;
    const dx = (maxX - minX) / width;
    const dy = (maxY - minY) / height;
    let gx0 = Infinity, gx1 = -Infinity, gy0 = Infinity, gy1 = -Infinity;
    for (const ring of rings) for (const [x, y] of ring) {
      gx0 = Math.min(gx0, x); gx1 = Math.max(gx1, x);
      gy0 = Math.min(gy0, y); gy1 = Math.max(gy1, y);
    }
    const c0 = Math.max(0, Math.floor((gx0 - minX) / dx));
    const c1 = Math.min(width - 1, Math.ceil((gx1 - minX) / dx));
    const r0 = Math.max(0, Math.floor((maxY - gy1) / dy));
    const r1 = Math.min(height - 1, Math.ceil((maxY - gy0) / dy));
    const idx = [];
    for (let r = r0; r <= r1; r++) {
      const y = maxY - (r + 0.5) * dy;
      for (let c = c0; c <= c1; c++) {
        const x = minX + (c + 0.5) * dx;
        if (pointInRings(x, y, rings)) idx.push(r * width + c);
      }
    }
    const mask = Uint32Array.from(idx);
    maskCache.set(cacheKey, mask);
    return mask;
  }

  // Área de cada píxel en m² (grilla en EPSG:4326), por fila
  function pixelAreaByRow(raster) {
    const { width, height, bbox } = raster;
    const [minX, minY, maxX, maxY] = bbox;
    const dx = (maxX - minX) / width;
    const dy = (maxY - minY) / height;
    const rows = new Float64Array(height);
    for (let r = 0; r < height; r++) {
      const lat = ((maxY - (r + 0.5) * dy) * Math.PI) / 180;
      rows[r] = dx * 111320 * Math.cos(lat) * dy * 110574;
    }
    return rows;
  }

  // Geometrías activas: lotes seleccionados o polígono dibujado
  function activeGeometries() {
    if (state.mode === "lote" && state.selectedLotes.length) {
      return state.selectedLotes.map((id, i) => ({
        name: String(id), key: `lote-${id}`, color: CONFIG.LOT_COLORS[i],
        rings: geometryRings(state.lotesById.get(id).geometry),
      }));
    }
    if (state.mode === "poligono" && state.polygon) {
      return [{ name: "Drawn Area", key: `pol-${JSON.stringify(state.polygon)}`, color: CONFIG.LOT_COLORS[0], rings: [state.polygon] }];
    }
    return [];
  }

  // ------------
  // Mapa
  // ------------
  const map = L.map("map", { zoomControl: false });
  L.tileLayer(CONFIG.BASEMAP_URL, { attribution: CONFIG.BASEMAP_ATTRIBUTION, maxZoom: 19 }).addTo(map);

  let lotesLayer = null;
  let selectedLayer = L.layerGroup().addTo(map);
  let polygonLayer = L.featureGroup().addTo(map);
  let rasterOverlay = null;
  let legendControl = null;
  let drawHandler = null;

  // Barra única del mapa: alejar, acercar, centrar y mostrar el raster
  const MapToolbar = L.Control.extend({
    options: { position: "topleft" },
    onAdd() {
      const div = L.DomUtil.create("div", "map-toolbar");
      div.innerHTML = `
        <button type="button" class="mt-btn" id="map-zoom-out" title="Zoom out" aria-label="Zoom out">−</button>
        <button type="button" class="mt-btn" id="map-zoom-in" title="Zoom in" aria-label="Zoom in">+</button>
        <button type="button" class="mt-btn mt-center" id="map-center" title="Center on the plots">
          <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3"/></svg>Center</button>
        <label class="mt-raster switch"><input type="checkbox" id="toggle-raster" checked /><span class="switch-track"></span> Show Raster</label>`;
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.disableScrollPropagation(div);
      div.querySelector("#map-zoom-out").onclick = () => map.zoomOut();
      div.querySelector("#map-zoom-in").onclick = () => map.zoomIn();
      div.querySelector("#map-center").onclick = () => { if (lotesLayer) map.fitBounds(lotesLayer.getBounds()); };
      return div;
    },
  });
  map.addControl(new MapToolbar());

  function drawLotes() {
    lotesLayer = L.geoJSON(state.lotes, {
      style: { color: "gray", weight: 1, fill: true, fillOpacity: 0 },
      onEachFeature: (f, layer) => {
        const id = f.properties[CONFIG.LOT_ID_FIELD];
        layer.bindTooltip(`Plot ${id}`, { sticky: true });
        layer.on("click", () => onLoteClick(id));
      },
    }).addTo(map);
    map.fitBounds(lotesLayer.getBounds());
  }

  function drawSelected() {
    selectedLayer.clearLayers();
    state.selectedLotes.forEach((id, i) => {
      L.geoJSON(state.lotesById.get(id), {
        style: { color: CONFIG.LOT_COLORS[i], weight: 3, fillOpacity: 0 },
        interactive: false,
      }).addTo(selectedLayer);
    });
  }

  function setLegend(html) {
    if (legendControl) map.removeControl(legendControl);
    legendControl = null;
    if (!html) return;
    legendControl = L.control({ position: "bottomright" });
    legendControl.onAdd = () => {
      const div = L.DomUtil.create("div", "legend");
      div.innerHTML = html;
      return div;
    };
    legendControl.addTo(map);
  }

  async function updateRaster() {
    if (rasterOverlay) { map.removeLayer(rasterOverlay); rasterOverlay = null; }
    setLegend(null);
    if (!state.showRaster) return;

    const cfg = INDICES[state.index];
    const { display, displayIsClass } = layersFor(state.index);
    if (!display) return;
    const dates = datesInRange(display);
    if (!dates.length) return;

    showLoading("Loading map");
    try {
      const rasters = await loadRasters(display, dates, "Loading map");
      const how = displayIsClass ? "modal" : cfg.aggregate === "modal" ? "modal" : "mean";
      const comp = composite(rasters, how);
      const { width, height, bbox, data } = comp;

      let colorOf, legendHtml;
      if (displayIsClass) {
        const rgb = cfg.palette.map(hexToRgb);
        colorOf = (v) => (Number.isNaN(v) ? null : rgb[Math.round(v) - 1] || null);
        legendHtml = `<h4>Categories ${state.index}</h4>` +
          cfg.classes.map((c, i) => `<div><i style="background:${cfg.palette[i]}"></i>${c}</div>`).join("");
      } else {
        // Rango fijo del índice (config.js): el mismo color significa siempre el mismo valor
        let [min, max] = cfg.domain || [Infinity, -Infinity];
        if (!cfg.domain) for (const v of data) if (!Number.isNaN(v)) { if (v < min) min = v; if (v > max) max = v; }
        colorOf = makeNumericPalette(cfg.palette, min, max);
        const grad = `linear-gradient(to top, ${cfg.palette.join(",")})`;
        const ticks = [1, 0.75, 0.5, 0.25, 0].map((f) => +(min + (max - min) * f).toFixed(2));
        legendHtml = `<h4>${state.index}</h4><div class="gradient" style="background:${grad}"></div>` +
          `<div class="gradient-labels">${ticks.map((t) => `<span>${t}</span>`).join("")}</div>`;
      }

      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d");
      const img = ctx.createImageData(width, height);
      for (let k = 0; k < data.length; k++) {
        const c = colorOf(data[k]);
        if (!c) continue;
        img.data[4 * k] = c[0]; img.data[4 * k + 1] = c[1]; img.data[4 * k + 2] = c[2]; img.data[4 * k + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      const [minX, minY, maxX, maxY] = bbox;
      rasterOverlay = L.imageOverlay(canvas.toDataURL(), [[minY, minX], [maxY, maxX]], {
        opacity: CONFIG.RASTER_OPACITY, className: "raster-overlay", interactive: false,
      }).addTo(map);
      rasterOverlay.bringToBack();
      setLegend(legendHtml);
    } catch (err) {
      console.error(err);
      showError("The map couldn't load", `Try again in a moment. Details: ${err.message}`);
    } finally {
      hideLoading();
    }
  }

  // ------------------------------------------------------------------
  // Selección por lote / polígono 
  // ------------------------------------------------------------------
  function setMode(mode) {
    state.mode = mode;
    state.selectedLotes = [];
    state.polygon = null;
    selectedLayer.clearLayers();
    polygonLayer.clearLayers();
    if (drawHandler) { drawHandler.disable(); drawHandler = null; }
    $("btn-lote").classList.toggle("active", mode === "lote");
    $("btn-poligono").classList.toggle("active", mode === "poligono");
    updateLoteInfo();

    if (mode === "lote") {
      showCoach("lote", "plot", "Select plots", [
        "Click a plot on the map",
        "Click a second plot to compare them",
        "A third click replaces the oldest selection",
      ]);
    }
    if (mode === "poligono") {
      showCoach("poligono", "polygon", "Draw an area", [
        "Click on the map to add points",
        "Click the <b>first point</b> to close the shape",
      ]);
      startDrawing();
    }
    if (mode === null) hideCoach();
    refreshAnalysis();
  }

  // Textos del cursor mientras se dibuja
  L.drawLocal.draw.handlers.polygon.tooltip = {
    start: "Click to place the first point",
    cont: "Click to add another point",
    end: "Click the first point to close",
  };
  L.drawLocal.draw.handlers.polyline.error = "<strong>Lines can't cross each other</strong>";

  const vertexIcon = new L.DivIcon({ className: "vertex", iconSize: new L.Point(10, 10) });

  function startDrawing() {
    drawHandler = new L.Draw.Polygon(map, {
      allowIntersection: false,
      showArea: false,
      icon: vertexIcon,
      touchIcon: vertexIcon, // en pantallas táctiles Leaflet.draw usaría cuadros de 20 px
      guidelineDistance: 10,
      shapeOptions: { color: "#9D25E5", weight: 2, fillColor: "#9D25E5", fillOpacity: 0.12 },
    });
    drawHandler.enable();
  }

  // Resaltar el primer punto (ahí se cierra el polígono)
  map.on(L.Draw.Event.DRAWVERTEX, (e) => {
    const markers = e.layers.getLayers();
    markers.forEach((m, i) => m._icon && m._icon.classList.toggle("vertex-first", i === 0 && markers.length > 1));
  });

  map.on(L.Draw.Event.CREATED, (e) => {
    polygonLayer.clearLayers();
    polygonLayer.addLayer(e.layer);
    const ring = e.layer.getLatLngs()[0].map((p) => [p.lng, p.lat]);
    ring.push(ring[0]);
    state.polygon = ring;
    drawHandler = null;
    hideCoach();
    refreshAnalysis();
  });

  function onLoteClick(id) {
    if (state.mode === null) {
      toast("Choose <b>Select by Plot</b> or <b>Draw Polygon</b> first");
      pulseModeButtons();
      return;
    }
    if (state.mode !== "lote") return;
    if (!state.selectedLotes.includes(id)) {
      state.selectedLotes.push(id);
      if (state.selectedLotes.length > 2) state.selectedLotes = state.selectedLotes.slice(-2);
    }
    drawSelected();
    updateLoteInfo();
    if (state.selectedLotes.length === 2) hideCoach();
    refreshAnalysis();
  }

  function updateLoteInfo() {
    const box = $("info-lote");
    if (state.mode !== "lote" || !state.selectedLotes.length) { box.classList.add("hidden"); return; }
    box.innerHTML = state.selectedLotes.map((id, i) => {
      const p = state.lotesById.get(id).properties;
      const crop = p[CONFIG.CROP_FIELD] ?? "—";
      const color = CONFIG.LOT_COLORS[i];
      return `<div class="lot-chip" style="--chip-color:${color}">
        <span class="crop-icon" title="${esc(crop)}">${cropIcon(crop)}</span>
        <div><p class="lot-id">Selected Plot: <b>${esc(id)}</b></p><p class="lot-crop">Crop: ${esc(crop)}</p></div>
      </div>`;
    }).join("");
    box.classList.remove("hidden");
  }

  // ------------------------------------------------------------------
  // Resultados por fecha
  // Devuelve [{ name, color, points: [{date, mean, n}] }]
  // ------------------------------------------------------------------
  async function ensureStats() {
    if (!state.stats[state.sensor]) {
      const path = sensorInfo().stats;
      state.stats[state.sensor] = path ? await fetchJSON(path) : {};
    }
    return state.stats[state.sensor];
  }

  async function seriesForSelection() {
    const geoms = activeGeometries();
    if (!geoms.length) return [];
    const { analysis } = layersFor(state.index);
    if (!analysis) return [];

    if (state.mode === "lote") {
      // Lotes: tabla precalculada en Python (mismas fechas que los rasters publicados)
      const stats = await ensureStats();
      const byLot = (stats[analysis] || {});
      return geoms.map((g) => ({
        name: g.name, color: g.color,
        points: (byLot[g.name] || [])
          .filter(([d]) => d >= state.start && d <= state.end)
          .map(([date, mean, n]) => ({ date, mean, n })),
      }));
    }

    // Polígono: se calcula sobre los rasters disponibles (ventana)
    const dates = datesInRange(analysis);
    const rasters = await loadRasters(analysis, dates, "Reading rasters");
    return geoms.map((g) => {
      const points = [];
      for (const r of rasters) {
        const mask = maskFor(g.key, g.rings, r);
        let s = 0, c = 0;
        for (const k of mask) { const v = r.data[k]; if (!Number.isNaN(v)) { s += v; c++; } }
        if (c) points.push({ date: r.date, mean: s / c, n: c });
      }
      return { name: g.name, color: g.color, points };
    });
  }

  // ------------------------------------------------------------------
  // Tabla de resultados + CSV
  // ------------------------------------------------------------------
  function renderTable(series) {
    const table = $("tabla-resultados");
    if (!series.length || series.every((s) => !s.points.length)) {
      const msg = state.mode === "poligono"
        ? "Draw and close a polygon to view the results"
        : state.mode === "lote" && state.selectedLotes.length
          ? "No data in the selected date range"
          : "Select a plot to view results";
      table.innerHTML = `<tr><th>Date</th><th>Average</th></tr><tr><td>No data</td><td>${msg}</td></tr>`;
      state.lastTable = null;
      $("btn-descargar").classList.add("hidden");
      return;
    }
    const columns = ["Date", ...series.map((s) => (state.mode === "lote" ? `Lote_${s.name}` : "Average"))];
    const dates = [...new Set(series.flatMap((s) => s.points.map((p) => p.date)))].sort();
    const globalRow = ["Global Average", ...series.map((s) => {
      const tot = s.points.reduce((a, p) => a + p.n, 0);
      return tot ? s.points.reduce((a, p) => a + p.mean * p.n, 0) / tot : NaN;
    })];
    const rows = dates.map((d) => [d, ...series.map((s) => s.points.find((p) => p.date === d)?.mean ?? NaN)]);

    const colStyle = (i) => `style="--col-color:${series[i].color}"`;
    table.innerHTML =
      `<tr><th>${columns[0]}</th>${columns.slice(1).map((c, i) =>
        `<th class="col-lot" ${colStyle(i)}><span class="col-dot"></span>${esc(c)}</th>`).join("")}</tr>` +
      `<tr class="global"><td>${globalRow[0]}</td>${globalRow.slice(1).map((v, i) =>
        `<td class="col-lot" ${colStyle(i)}>${fmt(v, 2)}</td>`).join("")}</tr>` +
      rows.map((r) => `<tr><td>${r[0]}</td>${r.slice(1).map((v) => `<td>${fmt(v)}</td>`).join("")}</tr>`).join("");

    state.lastTable = { columns, rows: [globalRow, ...rows] };
    $("btn-descargar").classList.remove("hidden");
  }

  $("btn-descargar").onclick = () => {
    const t = state.lastTable;
    if (!t) { toast("Select a plot or draw a polygon to download data", { type: "info" }); return; }
    const csv = [t.columns, ...t.rows.map((r) => [r[0], ...r.slice(1).map((v) => (Number.isNaN(v) ? "" : v))])]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `Results_${state.sensor}_${state.index}_${state.start}_${state.end}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ------------------------------------------------------------------
  // Suavizado Savitzky–Golay (ventana 5, orden 2)
  // ------------------------------------------------------------------
  function savitzkyGolay(y, win = 5, order = 2) {
    const n = y.length;
    if (n < win) return y.slice();
    const half = Math.floor(win / 2);
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      const s = Math.min(Math.max(0, i - half), n - win); // ventana desplazada en los bordes
      // Ajuste polinómico por mínimos cuadrados sobre y[s..s+win-1]
      const m = order + 1;
      const A = Array.from({ length: m }, () => new Array(m).fill(0));
      const b = new Array(m).fill(0);
      for (let k = 0; k < win; k++) {
        const x = s + k - i;
        for (let r = 0; r < m; r++) {
          b[r] += y[s + k] * x ** r;
          for (let c = 0; c < m; c++) A[r][c] += x ** (r + c);
        }
      }
      out[i] = solve(A, b)[0]; // valor del polinomio en x = 0 (punto i)
    }
    return out;
  }
  function solve(A, b) {
    const n = b.length;
    const M = A.map((row, i) => [...row, b[i]]);
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map((row, i) => row[n] / row[i]);
  }

  // ------------------------------------------------------------------
  // Gráficos (serie de tiempo e histograma de área)
  // ------------------------------------------------------------------
  const EMPTY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="m7 15 4-5 4 3 5-7"/></svg>';
  function chartEmpty(msg) {
    Plotly.purge("chart");
    $("chart-empty").innerHTML = `${EMPTY_ICON}<span>${esc(msg)}</span>`;
    $("chart-empty").classList.remove("hidden");
  }

  // Sin barra de Plotly: la descarga se hace con el botón "Download chart"
  function plotConfig() {
    return { responsive: true, displaylogo: false, displayModeBar: false };
  }

  // Nombre del archivo: índice, tipo de gráfico, sensor y rango de fechas
  function chartFilename() {
    const kind = state.chartType === "ts" ? "time_series" : "area_distribution";
    return `${state.index}_${kind}_${state.sensor}_${state.start}_${state.end}`;
  }

  // El interruptor de suavizado solo aparece en la serie de tiempo de los índices que lo usan
  function updateSmoothField() {
    const show = state.chartType === "ts" && INDICES[state.index].smooth;
    $("smooth-field").classList.toggle("hidden", !show);
  }

  // Estilo común de los gráficos
  const AXIS = { gridcolor: "#eef0f3", linecolor: "#dfe3e8", zerolinecolor: "#dfe3e8", tickfont: { color: "#5b6370" } };
  function plotLayout(layout) {
    return {
      font: { family: "Inter, 'Helvetica Neue', Arial, sans-serif", size: 12, color: "#1f2328" },
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
      hoverlabel: { bgcolor: "#fff", bordercolor: "#dfe3e8", font: { family: "Inter, Arial, sans-serif", color: "#1f2328" } },
      dragmode: false, // sin zoom ni desplazamiento al arrastrar
      ...layout,
      title: { ...layout.title, text: `<b>${layout.title.text}</b>`, font: { size: 18, color: "#1f2328" }, x: 0.02, xanchor: "left" },
      xaxis: { ...AXIS, fixedrange: true, ...layout.xaxis },
      yaxis: { ...AXIS, fixedrange: true, ...layout.yaxis },
      legend: { orientation: "h", y: -0.2, ...layout.legend },
    };
  }

  // Con una sola fecha, dejar 3 días a cada lado para que el eje muestre fechas y no horas
  function singleDateRange(series) {
    const dates = new Set(series.flatMap((s) => s.points.map((p) => p.date)));
    if (dates.size !== 1) return {};
    const d = new Date(`${[...dates][0]}T12:00:00`);
    const shift = (n) => new Date(d.getTime() + n * 86400000).toISOString().slice(0, 10);
    return { range: [shift(-3), shift(3)], dtick: 86400000 };
  }

  // Eje Y de la serie de tiempo: centrado en los datos, pero nunca más estrecho que
  // 1/4 del rango del índice, para que diferencias pequeñas no parezcan caídas fuertes.
  // No pasa de los límites del índice, salvo que algún valor esté por fuera (no se esconde ningún punto).
  const Y_MIN_SPAN = 0.25;
  function yAxisRange(values) {
    const cfg = INDICES[state.index];
    if (state.index === "VCI") return { range: [0.7, 7.3], dtick: 1 }; // clases 1 a 7
    const vals = values.filter((v) => Number.isFinite(v));
    if (!cfg.domain || !vals.length) return {};
    const [dLo, dHi] = cfg.domain;
    const min = Math.min(...vals), max = Math.max(...vals);
    const span = Math.max((dHi - dLo) * Y_MIN_SPAN, (max - min) * 1.15);
    let lo = (min + max) / 2 - span / 2, hi = lo + span;
    if (lo < dLo) { hi += dLo - lo; lo = dLo; }
    if (hi > dHi) { lo -= hi - dHi; hi = dHi; }
    lo = Math.min(Math.max(lo, dLo), min);
    hi = Math.max(Math.min(hi, dHi), max);
    const pad = (hi - lo) * 0.04; // aire para que los puntos del borde no queden cortados
    return { range: [lo - pad, hi + pad] };
  }

  function renderTimeSeries(series) {
    const valid = series.filter((s) => s.points.length);
    if (!valid.length) return chartEmpty(activeGeometries().length ? "No data in the selected date range." : "Select a plot or draw a polygon to see the chart.");
    $("chart-empty").classList.add("hidden");
    const cfg = INDICES[state.index];
    const traces = [];
    for (const s of valid) {
      const x = s.points.map((p) => p.date);
      const y = s.points.map((p) => p.mean);
      traces.push({ x, y, name: s.name, type: "scatter", mode: "lines+markers", line: { color: s.color }, marker: { color: s.color } });
      if (cfg.smooth && state.showSmooth && y.length >= 5) {
        traces.push({ x, y: savitzkyGolay(y), name: `Smoothed ${s.name}`, type: "scatter", mode: "lines", line: { color: s.color, dash: "dash" } });
      }
    }
    Plotly.react("chart", traces, plotLayout({
      hovermode: "x unified",
      title: { text: `Average ${state.index} by ${state.mode === "lote" ? "Plot" : "Area"}` },
      xaxis: { title: { text: "Date" }, type: "date", tickformat: "%b %d\n%Y", ...singleDateRange(valid) },
      yaxis: { title: { text: `Average ${state.index}` }, zeroline: false, ...yAxisRange(traces.flatMap((t) => t.y)) },
      legend: { title: { text: state.mode === "lote" ? "Plots" : "" } },
      margin: { t: 60, r: 20 },
    }), plotConfig());
  }

  async function renderHistogram() {
    const geoms = activeGeometries();
    if (!geoms.length) return chartEmpty("Select a plot or draw a polygon to see the chart.");
    const cfg = INDICES[state.index];
    const { analysis } = layersFor(state.index);
    const dates = datesInRange(analysis);
    if (!dates.length) return chartEmpty("No rasters available in the selected date range (maps cover the most recent months only).");

    const rasters = await loadRasters(analysis, dates, "Reading rasters");
    const comp = composite(rasters, layerInfo(analysis).kind === "class" ? "modal" : "mean");
    const edges = cfg.bins;
    const nb = edges.length - 1;
    const areaRow = pixelAreaByRow(comp);
    const isVCI = state.index === "VCI" && cfg.classes;
    const labels = isVCI ? cfg.classes : edges.slice(0, -1).map((e, i) =>
      cfg.openTop && i === nb - 1 ? `${e.toFixed(2)}+` : `${e.toFixed(2)}–${edges[i + 1].toFixed(2)}`);

    const traces = geoms.map((g) => {
      const area = new Array(nb).fill(0);
      const mask = maskFor(g.key, g.rings, comp);
      for (const k of mask) {
        const v = comp.data[k];
        if (Number.isNaN(v)) continue;
        let b = -1;
        for (let i = 0; i < nb; i++) {
          const last = i === nb - 1;
          if (v >= edges[i] && (v < edges[i + 1] || (last && (cfg.openTop || v <= edges[i + 1])))) { b = i; break; }
        }
        if (b >= 0) area[b] += areaRow[Math.floor(k / comp.width)] / 10000; // m² -> ha
      }
      return {
        type: "bar", x: labels, y: area, name: g.name, marker: { color: g.color, opacity: 0.85 },
        hovertemplate: `${g.name}<br>Range: %{x}<br>Area: %{y:.2f} ha<extra></extra>`,
      };
    });

    $("chart-empty").classList.add("hidden");
    Plotly.react("chart", traces, plotLayout({
      barmode: traces.length > 1 ? "group" : "relative",
      title: { text: `Area Distribution — ${state.index}` },
      xaxis: { title: { text: isVCI ? "VCI category" : `${state.index} range` }, tickangle: -45, automargin: true, categoryorder: "array", categoryarray: labels },
      yaxis: { title: { text: "Area (ha)" }, rangemode: "tozero" },
      legend: { title: { text: "Plots / AOI" }, y: -0.35 },
      margin: { t: 60, b: 90, r: 20 },
    }), plotConfig());
  }

  // ------------------------------------------------------------------
  // Recalcular tabla y gráfico (una sola lectura por interacción)
  // ------------------------------------------------------------------
  let analysisToken = 0;
  async function refreshAnalysis() {
    const token = ++analysisToken;
    try {
      if (!activeGeometries().length) {
        renderTable([]);
        chartEmpty(state.mode === "poligono" ? "Draw and close a polygon to see the chart." : "Select a plot or draw a polygon to see the chart.");
        return;
      }
      showLoading("Calculating");
      const series = await seriesForSelection();
      if (token !== analysisToken) return;
      renderTable(series);
      if (state.mode === "poligono" && series.every((s) => !s.points.length)
          && datesInRange(layersFor(state.index).analysis).length) {
        hideLoading();
        showError("No data in this area",
          "The polygon doesn't cover any plot with valid pixels in the selected dates. Draw it again over the plots.",
          { action: "Draw again", onAction: () => setMode("poligono") });
      }
      if (state.chartType === "ts") renderTimeSeries(series);
      else await renderHistogram();
    } catch (err) {
      console.error(err);
      showError("The analysis couldn't finish", `Try again in a moment. Details: ${err.message}`);
    } finally {
      if (token === analysisToken) hideLoading();
    }
  }

  // ------------------------------------------------------------------
  // Controles del panel
  // ------------------------------------------------------------------
  function fillIndexSelect() {
    const sel = $("indice");
    const available = Object.keys(INDICES).filter((k) => {
      const { analysis } = layersFor(k);
      return !!analysis;
    });
    sel.innerHTML = available.map((k) => `<option value="${k}">${k}</option>`).join("");
    if (!available.includes(state.index)) state.index = available[0];
    sel.value = state.index;
    updateSwatch();
  }

  function updateSwatch() {
    $("index-swatch").style.background = `linear-gradient(to right, ${INDICES[state.index].palette.join(",")})`;
  }

  function setupDates() {
    const s = sensorInfo();
    const [wStart, wEnd] = s.window;
    const [hStart, hEnd] = [wStart, wEnd];
    for (const id of ["fecha-inicio", "fecha-fin"]) {
      $(id).min = hStart;
      $(id).max = hEnd;
    }
    state.start = wStart;
    state.end = wEnd;
    $("fecha-inicio").value = wStart;
    $("fecha-fin").value = wEnd;
    updateDateTexts();
  }

  function updateDateTexts() {
    $("fecha-inicio-text").textContent = fmtDate($("fecha-inicio").value);
    $("fecha-fin-text").textContent = fmtDate($("fecha-fin").value);
  }

  function onSensorChange() {
    state.sensor = $("sensor").value;
    fillIndexSelect();
    setupDates();
    updateRaster();
    refreshAnalysis();
  }

  function bindControls() {
    $("btn-lote").onclick = () => setMode("lote");
    $("btn-poligono").onclick = () => setMode("poligono");
    $("btn-borrar").onclick = () => {
      const b = $("btn-borrar");
      b.classList.add("flash");
      setTimeout(() => b.classList.remove("flash"), 500);
      setMode(state.mode); // limpia la selección y mantiene el modo
    };
    $("btn-info").onclick = (e) => { e.stopPropagation(); toggleInfoPop(); };
    $("sensor").onchange = onSensorChange;
    $("indice").onchange = (e) => {
      state.index = e.target.value;
      updateSwatch();
      updateSmoothField();
      if (!$("info-pop").classList.contains("hidden")) renderInfoPop();
      updateRaster(); refreshAnalysis();
    };
    $("toggle-raster").onchange = (e) => { state.showRaster = e.target.checked; updateRaster(); };
    const onDate = () => {
      let a = $("fecha-inicio").value, b = $("fecha-fin").value;
      if (!a || !b) return;
      if (a > b) [a, b] = [b, a];
      state.start = a; state.end = b;
      $("fecha-inicio").value = a; $("fecha-fin").value = b;
      updateDateTexts();
      updateRaster();
      refreshAnalysis();
    };
    $("fecha-inicio").onchange = onDate;
    $("fecha-fin").onchange = onDate;
    // Abrir el calendario al hacer clic en cualquier parte del campo
    for (const id of ["fecha-inicio", "fecha-fin"]) {
      $(id).addEventListener("click", (e) => { try { e.currentTarget.showPicker(); } catch { /* navegador sin showPicker */ } });
    }
    document.querySelectorAll('input[name="chart-type"]').forEach((r) => {
      r.onchange = (e) => { state.chartType = e.target.value; updateSmoothField(); refreshAnalysis(); };
    });
    $("toggle-smooth").onchange = (e) => { state.showSmooth = e.target.checked; refreshAnalysis(); };
    $("btn-chart-png").onclick = () => {
      const chart = $("chart");
      if (!chart.data || !chart.data.length) {
        toast("Select a plot or draw a polygon to download the chart", { type: "info" });
        return;
      }
      Plotly.downloadImage(chart, { format: "png", scale: 2, width: chart.offsetWidth, height: chart.offsetHeight, filename: chartFilename() });
    };
  }

  // ------------------------------------------------------------------
  // Inicio
  // ------------------------------------------------------------------
  async function init() {
    showLoading("Loading catalog");
    try {
      const [catalog, lotes] = await Promise.all([fetchJSON("catalog.json"), fetchJSON("lotes.geojson")]);
      state.catalog = catalog;
      state.lotes = lotes;
      for (const f of lotes.features) state.lotesById.set(f.properties[CONFIG.LOT_ID_FIELD], f);

      const sensors = Object.keys(catalog.sensors);
      $("sensor").innerHTML = sensors.map((s) => `<option value="${s}">${catalog.sensors[s].label || s}</option>`).join("");
      $("sensor-field").classList.toggle("hidden", sensors.length < 2);
      state.sensor = sensors[0];
      state.index = Object.keys(INDICES)[0];

      drawLotes();
      bindControls();
      fillIndexSelect();
      setupDates();
      updateSmoothField();
      await updateRaster();
      await refreshAnalysis();
    } catch (err) {
      console.error(err);
      hideLoading();
      showError("The data couldn't load", `Check that the latest data Release was published. Details: ${err.message}`);
    }
  }

  // Expuesto para pruebas desde la consola
  window.__monitoreo = { state, map, setMode, onLoteClick, refreshAnalysis, updateRaster };
  window.__map = map;

  init();
})();

