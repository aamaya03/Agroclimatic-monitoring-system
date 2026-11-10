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
    lastTable: null,        // { columns, rows } para CSV
  };

  const rasterCache = new Map(); // url 
  const maskCache = new Map();   // clave geometría+grilla 

  // ------------------------------------------------------------------
  // Utilidades
  // ------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const fmt = (v, d = 4) => (v == null || Number.isNaN(v) ? "" : (+v).toFixed(d));

  function showLoading(text = "") {
    $("loading-text").textContent = text;
    $("loading-screen").classList.remove("hidden");
  }
  function hideLoading() { $("loading-screen").classList.add("hidden"); }

  function showModal(title, body, button = "Got it") {
    $("modal-title").textContent = title;
    $("modal-body").textContent = body;
    $("modal-close").textContent = button;
    $("modal").classList.remove("hidden");
  }
  $("modal-close").onclick = () => $("modal").classList.add("hidden");
  $("modal").onclick = (e) => { if (e.target.id === "modal") $("modal").classList.add("hidden"); };

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
  const map = L.map("map", { zoomControl: true });
  L.tileLayer(CONFIG.BASEMAP_URL, { attribution: CONFIG.BASEMAP_ATTRIBUTION, maxZoom: 19 }).addTo(map);

  let lotesLayer = null;
  let selectedLayer = L.layerGroup().addTo(map);
  let polygonLayer = L.featureGroup().addTo(map);
  let rasterOverlay = null;
  let legendControl = null;
  let drawHandler = null;

  const CenterControl = L.Control.extend({
    options: { position: "topleft" },
    onAdd() {
      const div = L.DomUtil.create("div", "leaflet-bar center-btn");
      div.innerHTML = '<a href="#" title="Center on the plots">&#9673;</a>';
      L.DomEvent.on(div, "click", (e) => {
        L.DomEvent.preventDefault(e);
        if (lotesLayer) map.fitBounds(lotesLayer.getBounds());
      });
      return div;
    },
  });
  map.addControl(new CenterControl());

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
        let min = Infinity, max = -Infinity;
        for (const v of data) if (!Number.isNaN(v)) { if (v < min) min = v; if (v > max) max = v; }
        colorOf = makeNumericPalette(cfg.palette, min, max);
        const grad = `linear-gradient(to top, ${cfg.palette.join(",")})`;
        const mid = (min + max) / 2;
        legendHtml = `<h4>${state.index}</h4><div class="gradient" style="background:${grad}"></div>` +
          `<div class="gradient-labels"><span>${fmt(max, 2)}</span><span>${fmt(mid, 2)}</span><span>${fmt(min, 2)}</span></div>`;
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
      showModal("Error", `The map could not be loaded: ${err.message}`, "Close");
    } finally {
      hideLoading();
    }
  }

  // ------------------------------------------------------------------
  // Selección por lote / polígono 
  // ------------------------------------------------------------------
  let shownLoteHelp = false, shownPolyHelp = false;

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

    if (mode === "lote" && !shownLoteHelp) {
      showModal("Instructions to select plots", "Click on a plot to select it. You can select up to two plots for simultaneous analysis.");
      shownLoteHelp = true;
    }
    if (mode === "poligono") {
      if (!shownPolyHelp) {
        showModal("Instruction to draw the polygon", "Click on the map to add vertices. Click the first point (or 'Finish') to close the polygon.");
        shownPolyHelp = true;
      }
      startDrawing();
    }
    refreshAnalysis();
  }

  function startDrawing() {
    drawHandler = new L.Draw.Polygon(map, {
      allowIntersection: false,
      showArea: true,
      shapeOptions: { color: "#9D25E5", weight: 2, fillOpacity: 0.1 },
    });
    drawHandler.enable();
  }

  map.on(L.Draw.Event.CREATED, (e) => {
    polygonLayer.clearLayers();
    polygonLayer.addLayer(e.layer);
    const ring = e.layer.getLatLngs()[0].map((p) => [p.lng, p.lat]);
    ring.push(ring[0]);
    state.polygon = ring;
    drawHandler = null;
    refreshAnalysis();
  });

  function onLoteClick(id) {
    if (state.mode === null) {
      showModal("Select an analysis mode", "You must choose either 'Select by Plot' or 'Draw Polygon' before interacting with the map.", "OK");
      return;
    }
    if (state.mode !== "lote") return;
    if (!state.selectedLotes.includes(id)) {
      state.selectedLotes.push(id);
      if (state.selectedLotes.length > 2) state.selectedLotes = state.selectedLotes.slice(-2);
    }
    drawSelected();
    updateLoteInfo();
    refreshAnalysis();
  }

  function updateLoteInfo() {
    const box = $("info-lote");
    if (state.mode !== "lote" || !state.selectedLotes.length) { box.classList.add("hidden"); return; }
    box.textContent = state.selectedLotes.map((id) => {
      const p = state.lotesById.get(id).properties;
      return `📍 Selected Plot: ${id}\n🌱 Crop: ${p[CONFIG.CROP_FIELD] ?? "—"}`;
    }).join("\n\n");
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

    table.innerHTML =
      `<tr>${columns.map((c) => `<th>${c}</th>`).join("")}</tr>` +
      `<tr class="global"><td>${globalRow[0]}</td>${globalRow.slice(1).map((v) => `<td>${fmt(v, 2)}</td>`).join("")}</tr>` +
      rows.map((r) => `<tr><td>${r[0]}</td>${r.slice(1).map((v) => `<td>${fmt(v)}</td>`).join("")}</tr>`).join("");

    state.lastTable = { columns, rows: [globalRow, ...rows] };
    $("btn-descargar").classList.remove("hidden");
  }

  $("btn-descargar").onclick = () => {
    const t = state.lastTable;
    if (!t) { showModal("Error", "No data to download. Select a plot or draw a polygon.", "Close"); return; }
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
  function chartEmpty(msg) {
    Plotly.purge("chart");
    $("chart-empty").textContent = msg;
    $("chart-empty").classList.remove("hidden");
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
      if (cfg.smooth && y.length >= 5) {
        traces.push({ x, y: savitzkyGolay(y), name: `Smoothed ${s.name}`, type: "scatter", mode: "lines", line: { color: s.color, dash: "dash" } });
      }
    }
    Plotly.react("chart", traces, {
      title: { text: `Average ${state.index} by ${state.mode === "lote" ? "Plot" : "Area"}` },
      xaxis: { title: { text: "Date" }, type: "date" },
      yaxis: { title: { text: `Average ${state.index}` }, zeroline: false },
      legend: { title: { text: state.mode === "lote" ? "Plots" : "" } },
      margin: { t: 80 },
    }, { responsive: true, displaylogo: false });
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
    const labels = isVCI ? cfg.classes : edges.slice(0, -1).map((e, i) => `${e.toFixed(2)}–${edges[i + 1].toFixed(2)}`);

    const traces = geoms.map((g) => {
      const area = new Array(nb).fill(0);
      const mask = maskFor(g.key, g.rings, comp);
      for (const k of mask) {
        const v = comp.data[k];
        if (Number.isNaN(v)) continue;
        let b = -1;
        for (let i = 0; i < nb; i++) {
          const last = i === nb - 1;
          if (v >= edges[i] && (v < edges[i + 1] || (last && v <= edges[i + 1]))) { b = i; break; }
        }
        if (b >= 0) area[b] += areaRow[Math.floor(k / comp.width)] / 10000; // m² -> ha
      }
      return {
        type: "bar", x: labels, y: area, name: g.name, marker: { color: g.color },
        hovertemplate: `${g.name}<br>Range: %{x}<br>Area: %{y:.2f} ha<extra></extra>`,
      };
    });

    $("chart-empty").classList.add("hidden");
    Plotly.react("chart", traces, {
      barmode: traces.length > 1 ? "group" : "relative",
      title: { text: `Area Distribution — ${state.index}` },
      xaxis: { title: { text: isVCI ? "VCI category" : `${state.index} range` }, tickangle: -45, automargin: true, categoryorder: "array", categoryarray: labels },
      yaxis: { title: { text: "Area (ha)" }, rangemode: "tozero" },
      legend: { title: { text: "Plots / AOI" } },
      margin: { t: 70, b: 90 },
    }, { responsive: true, displaylogo: false });
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
      if (state.chartType === "ts") renderTimeSeries(series);
      else await renderHistogram();
    } catch (err) {
      console.error(err);
      showModal("Error", `The analysis could not be completed: ${err.message}`, "Close");
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
    $("window-note").textContent =
      hStart < wStart
        ? `Maps and polygons: ${wStart} to ${wEnd}. Plot time series: from ${hStart}.`
        : `Data available: ${wStart} to ${wEnd}.`;
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
    $("btn-info").onclick = () => showModal(`Information about ${state.index}`, INDICES[state.index].info, "Close");
    $("sensor").onchange = onSensorChange;
    $("indice").onchange = (e) => { state.index = e.target.value; updateRaster(); refreshAnalysis(); };
    $("toggle-raster").onchange = (e) => { state.showRaster = e.target.checked; updateRaster(); };
    const onDate = () => {
      let a = $("fecha-inicio").value, b = $("fecha-fin").value;
      if (!a || !b) return;
      if (a > b) [a, b] = [b, a];
      state.start = a; state.end = b;
      updateRaster();
      refreshAnalysis();
    };
    $("fecha-inicio").onchange = onDate;
    $("fecha-fin").onchange = onDate;
    document.querySelectorAll('input[name="chart-type"]').forEach((r) => {
      r.onchange = (e) => { state.chartType = e.target.value; refreshAnalysis(); };
    });
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
      await updateRaster();
      await refreshAnalysis();
    } catch (err) {
      console.error(err);
      hideLoading();
      showModal("Error", `Data could not be loaded (${err.message}). Check that the data/ folder was published.`, "Close");
    }
  }

  // Expuesto para pruebas desde la consola
  window.__monitoreo = { state, map, setMode, onLoteClick, refreshAnalysis, updateRaster };
  window.__map = map;

  init();
})();
