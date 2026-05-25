#!/usr/bin/env node

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const outRoot = path.join(rootDir, "data/cesium-assets/imagery");

const USER_AGENT = "GIMU-Satellite-Tracker/1.0 (offline basemap prefetch; contact: GIMU)";

const sources = {
  arcgis: {
    url: (z, x, y) => `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    path: (z, x, y) => path.join(outRoot, "arcgis", `${z}`, `${y}`, `${x}.jpg`),
    ext: "jpg",
  },
  osm: {
    // CARTO basemaps — OSM data, suitable for app tile use (not OSM.org volunteer servers).
    url: (z, x, y) => `https://basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}.png`,
    path: (z, x, y) => path.join(outRoot, "osm", `${z}`, `${x}`, `${y}.png`),
    ext: "png",
    delayMs: 50,
  },
};

function isValidImage(buffer) {
  if (buffer.length < 80) {
    return false;
  }
  const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8;
  if (!isPng && !isJpeg) {
    return false;
  }
  const text = buffer.toString("utf8");
  return !text.includes("Access blocked") && !text.includes("tile usage policy");
}

function parseArgs() {
  const args = process.argv.slice(2);
  let maxZoom = 6;
  let layers = ["arcgis", "osm"];
  let concurrency = 6;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--max-zoom" && args[i + 1]) {
      maxZoom = Number.parseInt(args[++i], 10);
    } else if (args[i] === "--layers" && args[i + 1]) {
      layers = args[++i].split(",").map((l) => l.trim().toLowerCase());
    } else if (args[i] === "--concurrency" && args[i + 1]) {
      concurrency = Number.parseInt(args[++i], 10);
    } else if (args[i] === "--force") {
      force = true;
    }
  }

  return { maxZoom, layers, concurrency, force };
}

function enumerateTiles(maxZoom) {
  const tiles = [];
  for (let z = 0; z <= maxZoom; z++) {
    const dim = 2 ** z;
    for (let x = 0; x < dim; x++) {
      for (let y = 0; y < dim; y++) {
        tiles.push({ z, x, y });
      }
    }
  }
  return tiles;
}

function tileCount(maxZoom) {
  let total = 0;
  for (let z = 0; z <= maxZoom; z++) {
    total += 4 ** z;
  }
  return total;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadTile(source, tile, stats, force) {
  const target = source.path(tile.z, tile.x, tile.y);
  if (!force && fs.existsSync(target)) {
    const existing = fs.readFileSync(target);
    if (isValidImage(existing)) {
      stats.skipped++;
      return;
    }
    stats.invalid++;
  }

  await fs.promises.mkdir(path.dirname(target), { recursive: true });

  if (source.delayMs) {
    await sleep(source.delayMs);
  }

  const response = await fetch(source.url(tile.z, tile.x, tile.y), {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!response.ok) {
    stats.failed++;
    process.stdout.write(`\nFailed ${source.ext} z${tile.z}/${tile.x}/${tile.y}: HTTP ${response.status}\n`);
    return;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!isValidImage(buffer)) {
    stats.failed++;
    process.stdout.write(`\nRejected ${source.ext} z${tile.z}/${tile.x}/${tile.y}: not a valid map tile\n`);
    return;
  }
  await fs.promises.writeFile(target, buffer);
  stats.downloaded++;
}

async function runPool(items, worker, concurrency) {
  let index = 0;
  async function workerLoop() {
    while (index < items.length) {
      const current = index++;
      await worker(items[current]);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => workerLoop()));
}

async function downloadLayer(layerName, maxZoom, concurrency, force) {
  const source = sources[layerName];
  if (!source) {
    throw new Error(`Unknown layer: ${layerName}`);
  }

  const tiles = enumerateTiles(maxZoom);
  const stats = { downloaded: 0, skipped: 0, failed: 0, invalid: 0 };
  let processed = 0;
  const total = tiles.length;

  process.stdout.write(`\n${layerName}: ${total} tiles (zoom 0–${maxZoom})\n`);

  await runPool(
    tiles,
    async (tile) => {
      await downloadTile(source, tile, stats, force);
      processed++;
      if (processed % 100 === 0 || processed === total) {
        process.stdout.write(
          `\r${layerName}: ${processed}/${total} (${stats.downloaded} new, ${stats.skipped} cached, ${stats.invalid} replaced, ${stats.failed} failed)`,
        );
      }
    },
    concurrency,
  );

  process.stdout.write("\n");
  return stats;
}

const { maxZoom, layers, concurrency, force } = parseArgs();

process.stdout.write(
  `Downloading basemap tiles to ${outRoot}\nLayers: ${layers.join(", ")}\nMax zoom: ${maxZoom} (${tileCount(maxZoom)} tiles per layer)\nOSM source: CARTO Voyager (basemaps.cartocdn.com)\n`,
);

for (const layer of layers) {
  await downloadLayer(layer, maxZoom, concurrency, force);
}

process.stdout.write("Done.\n");
