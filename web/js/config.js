// ================================
// Configuración del visor 
// ================================

const CONFIG = {
  // Carpeta donde están catalog.json, lotes.geojson, stats/ y los TIF.
  DATA_URL: "data",

  // Campo del shapefile que identifica cada lote y campo del cultivo
  LOT_ID_FIELD: "Lot_Number",
  CROP_FIELD: "Cultivo",

  // Colores fijos por orden de selección (1 = azul, 2 = morado)
  LOT_COLORS: ["#007bff", "#9D25E5"],

  // Capa base
  BASEMAP_URL:
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  BASEMAP_ATTRIBUTION: "Tiles &copy; Esri",

  RASTER_OPACITY: 0.7,
  MAX_PARALLEL_DOWNLOADS: 6,
};

// display:  capa que se pinta en el mapa (si no existe para el sensor, se usa analysis)
// analysis: capa con la que se calculan tabla, series e histograma
// aggregate: cómo se combinan varias fechas en el mapa ("mean" o "modal")
// smooth:   aplica Savitzky–Golay a la serie de tiempo 
const INDICES = {
  VCI: {
    display: "VCI_class", analysis: "VCI_class", aggregate: "modal", smooth: false,
    palette: ["#000000", "#a52a2a", "#ff0000", "#ffa500", "#ffff00", "#90ee90", "#006400"],
    classes: ["Extreme Drought", "Severe Drought", "Moderate Drought", "Mild Drought", "Normal", "Good", "Very Good"],
    bins: [1, 2, 3, 4, 5, 6, 7, 8],
    info: "The Vegetation Condition Index (VCI) compares current vegetation status with historical trends to identify drought conditions.",
  },
  NDVI: {
    display: "NDVI_class", analysis: "NDVI_raw", aggregate: "modal", smooth: true,
    palette: ["#d9230f", "#d45313", "#f2db29", "#9acd32", "#07a607", "#076907"],
    classes: ["Soil/Water", "Very Low", "Low", "Moderately Low", "Moderately High", "High"],
    bins: range(-1, 1, 0.1),
    info: "The Normalized Difference Vegetation Index (NDVI) is an indicator of photosynthetically active biomass, used to analyze plant health and detect abnormal growth changes.",
  },
  EVI: {
    display: "EVI", analysis: "EVI", aggregate: "mean", smooth: false,
    palette: ["#d9230f", "#d45313", "#f2db29", "#9acd32", "#07a607", "#076907"],
    bins: range(-1, 1, 0.1),
    info: "The Enhanced Vegetation Index (EVI) measures canopy structure and vegetation vigor. It is optimized to better quantify greenness in areas of high biomass where NDVI may saturate.",
  },
  MSAVI: {
    display: "MSAVI", analysis: "MSAVI", aggregate: "mean", smooth: false,
    palette: ["#d9230f", "#d45313", "#f2db29", "#9acd32", "#07a607", "#076907"],
    bins: range(0, 1, 0.1),
    info: "The Modified Soil-Adjusted Vegetation Index (MSAVI) measures vegetation greenness while minimizing the influence of bare soil. It provides a more accurate estimate of canopy cover in areas with sparse vegetation.",
  },
  GNDVI: {
    display: "GNDVI", analysis: "GNDVI", aggregate: "mean", smooth: false,
    palette: ["#d9230f", "#d45313", "#f2db29", "#9acd32", "#07a607", "#076907"],
    bins: range(-1, 1, 0.1),
    info: "The Green Normalized Difference Vegetation Index (GNDVI) uses the green band to estimate chlorophyll content, making it effective for monitoring plant stress and nutrient status.",
  },
  LAI: {
    display: "LAI", analysis: "LAI", aggregate: "mean", smooth: true,
    palette: ["#A0522D", "#F4A460", "#9ACD32", "#32CD32", "#228B22", "#004d00"],
    bins: range(0, 10, 1),
    info: "The Leaf Area Index (LAI) quantifies the amount of foliage in a canopy. It is used to estimate biomass and crop health.",
  },
  GCI: {
    display: "GCI", analysis: "GCI", aggregate: "mean", smooth: true,
    palette: ["#A0522D", "#F4A460", "#9ACD32", "#32CD32", "#228B22", "#004d00"],
    bins: range(0, 10, 1),
    info: "The Green Chlorophyll Index (GCI) estimates chlorophyll content in vegetation, helping to assess nutritional status.",
  },
  NDWI: {
    display: "NDWI", analysis: "NDWI", aggregate: "mean", smooth: true,
    // reverse = TRUE en app.R
    palette: ["#74b0d6", "#388a47", "#9fcf70", "#f5d856", "#d13415"],
    bins: range(-1, 1, 0.1),
    info: "The Normalized Difference Water Index (NDWI) is used to detect water bodies and moisture in vegetation.",
  },
};

function range(from, to, step) {
  const out = [];
  const n = Math.round((to - from) / step);
  for (let i = 0; i <= n; i++) out.push(+(from + i * step).toFixed(6));
  return out;
}
