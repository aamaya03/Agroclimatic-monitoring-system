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
// name:     nombre completo que aparece en la tarjeta de información
// domain:   rango fijo de colores del mapa [mín, máx]; lo que quede por fuera toma el color del extremo.
//           También limita el eje Y de la serie de tiempo, que abarca como mínimo 1/4 de este rango
const INDICES = {
  VCI: {
    name: "Vegetation Condition Index",
    display: "VCI_class", analysis: "VCI_class", aggregate: "modal", smooth: false,
    palette: ["#000000", "#a52a2a", "#ff0000", "#ffa500", "#ffff00", "#90ee90", "#006400"],
    classes: ["Extreme Drought", "Severe Drought", "Moderate Drought", "Mild Drought", "Normal", "Good", "Very Good"],
    bins: [1, 2, 3, 4, 5, 6, 7, 8],
    info: "Compares current vegetation status with historical trends to identify drought conditions.",
  },
  NDVI: {
    name: "Normalized Difference Vegetation Index",
    display: "NDVI_class", analysis: "NDVI_raw", aggregate: "modal", smooth: true,
    palette: ["#d9230f", "#d45313", "#f2db29", "#9acd32", "#07a607", "#076907"],
    classes: ["Soil/Water", "Very Low", "Low", "Moderately Low", "Moderately High", "High"],
    domain: [-1, 1], // rango del NDVI continuo (eje Y de la serie de tiempo)
    bins: range(-1, 1, 0.1),
    info: "An indicator of photosynthetically active biomass, used to analyze plant health and detect abnormal growth changes.",
  },
  EVI: {
    name: "Enhanced Vegetation Index",
    display: "EVI", analysis: "EVI", aggregate: "mean", smooth: false,
    palette: ["#d9230f", "#d45313", "#f2db29", "#9acd32", "#07a607", "#076907"],
    domain: [0, 1], // rango fijo de la paleta y la leyenda
    bins: range(-1, 1, 0.1),
    info: "Measures canopy structure and vegetation vigor. It is optimized to better quantify greenness in areas of high biomass where NDVI may saturate.",
  },
  MSAVI: {
    name: "Modified Soil-Adjusted Vegetation Index",
    display: "MSAVI", analysis: "MSAVI", aggregate: "mean", smooth: false,
    palette: ["#d9230f", "#d45313", "#f2db29", "#9acd32", "#07a607", "#076907"],
    domain: [0, 1], // rango fijo de la paleta y la leyenda
    bins: range(0, 1, 0.1),
    info: "Measures vegetation greenness while minimizing the influence of bare soil. It provides a more accurate estimate of canopy cover in areas with sparse vegetation.",
  },
  GNDVI: {
    name: "Green Normalized Difference Vegetation Index",
    display: "GNDVI", analysis: "GNDVI", aggregate: "mean", smooth: false,
    palette: ["#d9230f", "#d45313", "#f2db29", "#9acd32", "#07a607", "#076907"],
    domain: [0, 1], // rango fijo de la paleta y la leyenda
    bins: range(-1, 1, 0.1),
    info: "Uses the green band to estimate chlorophyll content, making it effective for monitoring plant stress and nutrient status.",
  },
  LAI: {
    name: "Leaf Area Index",
    display: "LAI", analysis: "LAI", aggregate: "mean", smooth: true,
    palette: ["#A0522D", "#F4A460", "#9ACD32", "#32CD32", "#228B22", "#004d00"],
    domain: [0, 4], // rango fijo de la paleta y la leyenda
    bins: range(0, 4, 0.25), // La fórmula LAI = 3.618*EVI - 0.118 llega como máximo a ~3.5
    openTop: true,           // La última barra recoge todo lo mayor a 3.75 (nubes, artefactos)
    info: "Quantifies the amount of foliage in a canopy. It is used to estimate biomass and crop health.",
  },
  GCI: {
    name: "Green Chlorophyll Index",
    display: "GCI", analysis: "GCI", aggregate: "mean", smooth: true,
    palette: ["#A0522D", "#F4A460", "#9ACD32", "#32CD32", "#228B22", "#004d00"],
    domain: [0, 10], // rango fijo de la paleta y la leyenda
    bins: range(0, 10, 1),
    info: "Estimates chlorophyll content in vegetation, helping to assess nutritional status.",
  },
  NDWI: {
    name: "Normalized Difference Water Index",
    display: "NDWI", analysis: "NDWI", aggregate: "mean", smooth: true,
    // reverse = TRUE en app.R
    palette: ["#74b0d6", "#388a47", "#9fcf70", "#f5d856", "#d13415"],
    domain: [-1, 1], // rango fijo de la paleta y la leyenda
    bins: range(-1, 1, 0.1),
    info: "Used to detect water bodies and moisture in vegetation.",
  },
};

// Ícono de cada cultivo en la etiqueta del lote seleccionado.
// Se compara sin tildes ni mayúsculas: basta con que el nombre del cultivo
// contenga alguna de las palabras de "match". Se usa el primero que coincida.
const CROP_ICONS = [
  { match: ["regen"], label: "Agricultura regenerativa",
    icon: '<path d="M12 21v-7"/><path d="M12 14c0-3.3 2.2-5.5 5.5-5.5 0 3.3-2.2 5.5-5.5 5.5zM12 16c0-2.5-1.8-4.3-4.3-4.3 0 2.5 1.8 4.3 4.3 4.3z"/><path d="M4.5 9A8 8 0 0 1 17 4.8"/><path d="M17.5 2.5 17 5l-2.5.3"/>' },
  { match: ["musac", "banan", "platan"], label: "Musáceas",
    icon: '<path d="M4.5 13.5c1.5 4.5 5.5 6.8 10 6.2 4.5-.7 6.5-4.6 6.3-9.5L20.5 6"/><path d="M4.5 13.5c3.5 1.3 7.5.6 10.5-1.8 2.6-2.1 4.2-4.6 5.5-5.7"/><path d="M19.5 6.5 19 3.5l2-.5"/><path d="M4.5 13.5 3 13"/>' },
  { match: ["cana", "sugar"], label: "Caña",
    icon: '<path d="M8 21V4M14 21V7"/><path d="M6.5 9h3M6.5 15h3M12.5 12h3M12.5 18h3"/><path d="M14 7c1.5-2.8 4-3.8 6.5-3.8-.8 2.5-3.3 4-6.5 3.8zM8 4C6.8 2.8 5 2.4 3.5 2.5"/>' },
  { match: ["arroz", "rice"], label: "Arroz",
    icon: '<path d="M12 21V8"/><ellipse cx="12" cy="5" rx="1.6" ry="2.6"/><ellipse cx="8.6" cy="9" rx="1.4" ry="2.4" transform="rotate(-38 8.6 9)"/><ellipse cx="15.4" cy="9" rx="1.4" ry="2.4" transform="rotate(38 15.4 9)"/><ellipse cx="8.6" cy="14" rx="1.4" ry="2.4" transform="rotate(-38 8.6 14)"/><ellipse cx="15.4" cy="14" rx="1.4" ry="2.4" transform="rotate(38 15.4 14)"/>' },
  { match: ["yuca", "cassava", "mandioc"], label: "Yuca",
    icon: '<path d="M12 11V3"/><path d="M12 6 8.5 3.5M12 6l3.5-2.5M12 8.5 9 7M12 8.5l3-1.5"/><path d="M3 12.5h18" stroke-dasharray="1.5 2"/><path d="M12 12.5c-.8.6-1.6 2.6-2.3 5.6M12 12.5v8M12 12.5c.8.6 1.6 2.6 2.3 5.6"/>' },
  { match: ["frij", "frjiol", "bean", "poroto"], label: "Fríjol",
    icon: '<path d="M12 21v-9"/><path d="M12 12c-1-3.5-3.6-5.5-7-5.5.3 3.4 3 5.5 7 5.5zM12 12c1-3.5 3.6-5.5 7-5.5-.3 3.4-3 5.5-7 5.5z"/><path d="M12 15.5c-1.6 0-3 1-3.4 2.5M12 15.5c1.6 0 3 1 3.4 2.5"/>' },
  { match: ["pasto", "grass", "pradera"], label: "Pasto",
    icon: '<path d="M3 20h18"/><path d="M6.5 20c0-5-1.8-8-3.5-10M10 20c0-6.5 1.2-10.5 3.5-13.5M14 20c0-4.5 2-7.5 5-9.5M17.5 20c0-3 .2-5-1-7"/>' },
  { match: ["forraj", "forage", "heno"], label: "Forrajes",
    icon: '<path d="M3 21h18"/><path d="M7 21V9M12 21V4M17 21V8"/><path d="M7 9c-1.5-1-2-2.7-1.5-4.5C7 5.5 7.6 7.2 7 9zM12 4c-1.2-.8-1.5-2-1-3M12 4c1.2-.8 1.5-2 1-3M17 8c1.5-1 2-2.7 1.5-4.5C17 4.5 16.4 6.2 17 8z"/><path d="M7 15c-2-.5-3-2-3-3.5M12 13c2-.5 3-2 3-3.5M17 15c2-.5 3-2 3-3.5"/>' },
  { match: ["genet", "germopl"], label: "Recursos genéticos",
    icon: '<path d="M8 3c0 5 8 4.5 8 9s-8 4-8 9"/><path d="M16 3c0 5-8 4.5-8 9s8 4 8 9"/><path d="M9.3 6.5h5.4M9.3 17.5h5.4"/>' },
  { match: ["field", "operac"], label: "Operación de campo",
    icon: '<circle cx="7" cy="16" r="4"/><circle cx="18" cy="17.5" r="2.5"/><path d="M5 12V6h6.5l2 6"/><path d="M11 16h4.5M13.5 12H19l1 3.5"/><circle cx="7" cy="16" r="1"/>' },
  { match: ["cimmyt", "maiz", "corn"], label: "Maíz",
    icon: '<path d="M12 3c2.8 0 4 4 4 9s-1.2 8-4 9c-2.8-1-4-4-4-9s1.2-9 4-9z"/><path d="M8.3 8.5h7.4M8 12.5h8M8.4 16.5h7.2M12 3.5v17"/><path d="M8 12c-2 2-3 5-2 9M16 12c2 2 3 5 2 9"/>' },
  { match: ["variad", "mixt"], label: "Variados",
    icon: '<path d="M6.5 21v-6M6.5 15c-.4-2.4-1.9-3.8-4-4 .3 2.3 1.8 3.7 4 4zM6.5 15c.4-2.4 1.9-3.8 4-4-.3 2.3-1.8 3.7-4 4z"/><path d="M17.5 21v-9"/><ellipse cx="17.5" cy="6.5" rx="1.4" ry="2.4"/><ellipse cx="15" cy="10" rx="1.2" ry="2" transform="rotate(-38 15 10)"/><ellipse cx="20" cy="10" rx="1.2" ry="2" transform="rotate(38 20 10)"/>' },
  { match: ["basur", "residu"], label: "Basurero",
    icon: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/>' },
];
// Ícono cuando el cultivo no coincide con ninguno de la lista
const CROP_ICON_DEFAULT = '<path d="M12 21v-9"/><path d="M12 12C12 7.5 9 4.5 4.5 4.5c0 4.5 3 7.5 7.5 7.5zM12 14c0-3.5 2.5-6.5 7-6.5 0 4.5-3 6.5-7 6.5z"/>';

function range(from, to, step) {
  const out = [];
  const n = Math.round((to - from) / step);
  for (let i = 0; i <= n; i++) out.push(+(from + i * step).toFixed(6));
  return out;
}

