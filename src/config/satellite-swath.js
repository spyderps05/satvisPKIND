import swathDataImport from "./satellite-swath.json";

/** Days ahead for swath overpass prediction (weather / cloud-cover planning). */
export const SWATH_PREDICTION_DAYS = 15;

/** Max swath passes stored per satellite × ground station. */
export const SWATH_MAX_PASSES = 400;

/** Minimum satellite elevation (deg) at the target point during a swath pass. */
export const SWATH_MIN_ELEVATION_DEG = 0;

let swathData = swathDataImport;

if (import.meta.hot) {
  import.meta.hot.accept("./satellite-swath.json", (mod) => {
    swathData = mod?.default ?? mod;
    window.dispatchEvent(new CustomEvent("satvis-swath-config-changed"));
  });
}

/**
 * Resolve swath width (km) for swath overpass mode and ground-track corridor width.
 * Edit src/config/satellite-swath.json — byName overrides byNorad when both are set.
 */
export function getSwathWidthKm(satelliteName, noradId) {
  const info = getSwathInfo(satelliteName, noradId);
  return info.widthKm;
}

export function getSwathInfo(satelliteName, noradId) {
  const name = satelliteName.trim();
  const noradKey = noradId != null ? String(noradId) : "";

  if (swathData.byName?.[name] != null) {
    return { widthKm: swathData.byName[name], source: "byName" };
  }

  if (noradKey && swathData.byNorad?.[noradKey] != null) {
    return { widthKm: swathData.byNorad[noradKey], source: "byNorad" };
  }

  for (const entry of swathData.byPattern ?? []) {
    if (name.includes(entry.match)) {
      return { widthKm: entry.swathKm, source: "byPattern", pattern: entry.match };
    }
  }

  return { widthKm: swathData.defaultKm ?? 200, source: "default" };
}
