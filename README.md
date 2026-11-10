# Agroclimatic Monitoring System

A web-based system for exploring vegetation indices derived from PlanetScope satellite imagery. Users can analyze individual plots or any area they draw on the map, follow how each index evolves over time, and see how the area is distributed across index values.

## Features

- **Interactive map** with satellite basemap, plot boundaries and the selected index rendered for the chosen date range.
- **Plot analysis:** click up to two plots to compare them side by side (plot ID and crop are shown).
- **Polygon analysis:** draw any area on the map to analyze it.
- **Date range selection** within the published window (last 6 months).
- **Results table** with the average value per date and a global average for the selected range, downloadable as CSV.
- **Time series chart**, with Savitzky–Golay smoothing for NDVI, NDWI, LAI and GCI.
- **Area distribution chart** showing how many hectares fall in each index range (or VCI drought category).
- **Multi-sensor ready:** additional sensors (e.g. Sentinel-2, Landsat) can be added and selected from the interface.

## Vegetation indices

| Index | Name | What it indicates |
|---|---|---|
| **NDVI** | Normalized Difference Vegetation Index | Photosynthetically active biomass and plant health |
| **VCI** | Vegetation Condition Index | Current vegetation status compared with historical trends; drought conditions |
| **EVI** | Enhanced Vegetation Index | Canopy structure and vigor; less saturation in high biomass areas |
| **MSAVI** | Modified Soil-Adjusted Vegetation Index | Vegetation cover minimizing bare-soil influence |
| **GNDVI** | Green Normalized Difference Vegetation Index | Chlorophyll content, plant stress and nutrient status |
| **LAI** | Leaf Area Index | Amount of foliage; biomass and crop health |
| **GCI** | Green Chlorophyll Index | Chlorophyll content and nutritional status |
| **NDWI** | Normalized Difference Water Index | Water bodies and vegetation moisture |

NDVI and VCI are displayed on the map as categories (NDVI: Soil/Water to High; VCI: Extreme Drought to Very Good). Index values are cloud-masked using the PlanetScope usable data mask.

## How it works

The system is a static website served by GitHub Pages. There is no server: the browser downloads the index rasters (Cloud Optimized GeoTIFFs) and computes composites, zonal statistics and area distributions on the fly.

```
Index ETL ──► prepare_data.py ──► datos_sitio.zip ──► GitHub Release ──► GitHub Actions ──► GitHub Pages
```

- **Rasters** are stored as compressed COGs. Continuous indices are stored as scaled integers (4 decimals for NDVI, EVI, MSAVI, GNDVI and NDWI; 3 decimals for LAI and GCI). Classified rasters are stored exactly.
- **Map composites** over the selected date range use the mode for classified indices (NDVI, VCI) and the mean for continuous indices.
- **Plot statistics** (mean and valid pixel count per plot and date) are precomputed, so plot time series load instantly. The global average is weighted by valid pixel count.
- **Polygon statistics and area distributions** are computed in the browser from the rasters, using pixel centers inside the geometry and latitude-corrected pixel area.

## Repository structure

```
.github/workflows/deploy.yml   Builds and publishes the site when a data Release is published
web/
  index.html                   Page layout
  css/style.css                Styles
  js/config.js                 Index palettes, descriptions, histogram bins and settings
  js/app.js                    Map, selection, statistics and charts
```

Data are not stored in the repository. Each update is uploaded as a Release asset (`datos_sitio.zip`) and the workflow combines it with the `web/` folder at publish time.

## Updating the data

1. Compute the indices with the processing pipeline.
2. Run `prepare_data.py` (kept outside this repository). It selects the last 6 months, converts the rasters to COG, precomputes plot statistics, converts the plot shapefile to GeoJSON and packages everything into `datos_sitio.zip`.
3. In this repository, go to **Releases → Create a new release**, create a new tag (e.g. `data-2026-11-10`), attach `datos_sitio.zip` and click **Publish release**.
4. The **Publicar visor** workflow runs automatically and updates the site within a few minutes.

The site always uses the most recent Release. Older Releases can be deleted at any time.

To republish after changing files in `web/`, go to **Actions → Publicar visor → Run workflow**.

### Data package contents

```
catalog.json            Sensors, layers and available dates
lotes.geojson           Plot boundaries (Lot_Number, Cultivo)
stats/<sensor>.json     Mean and pixel count per plot, layer and date
<sensor>/<layer>/<date>.tif
```

## Configuration

`web/js/config.js` controls:

- `DATA_URL`: location of the data folder (can point to external storage such as Cloudflare R2 or S3 if the data outgrow GitHub Pages).
- `LOT_ID_FIELD` / `CROP_FIELD`: attribute names in the plot layer.
- `INDICES`: for each index, the display and analysis layers, palette, categories, histogram bins and description.

## Setup (first time only)

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. Publish a first Release with `datos_sitio.zip` attached.

## Built with

[Leaflet](https://leafletjs.com/) and [Leaflet.draw](https://github.com/Leaflet/Leaflet.draw) for the map, [geotiff.js](https://geotiffjs.github.io/) for reading rasters in the browser, [Plotly.js](https://plotly.com/javascript/) for charts, and Esri World Imagery as basemap.

## Notes

- GitHub Pages sites have a 1 GB size limit. The workflow stops with an error if the site exceeds it.
- Imagery-derived products are published publicly; their distribution must comply with the PlanetScope data license.
