import * as satellitejs from "satellite.js";
import dayjs from "dayjs";
import { SWATH_MAX_PASSES, SWATH_MIN_ELEVATION_DEG, SWATH_PREDICTION_DAYS } from "../config/satellite-swath";

const deg2rad = Math.PI / 180;
const rad2deg = 180 / Math.PI;
const EARTH_RADIUS_KM = 6371;

function greatCircleDistanceRad(lat1Rad, lon1Rad, lat2Rad, lon2Rad) {
  const deltaLat = lat2Rad - lat1Rad;
  const deltaLon = lon2Rad - lon1Rad;
  const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) + Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
  return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function initialBearingRad(lat1Rad, lon1Rad, lat2Rad, lon2Rad) {
  const deltaLon = lon2Rad - lon1Rad;
  const y = Math.sin(deltaLon) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(deltaLon);
  return Math.atan2(y, x);
}

/** Perpendicular distance from ground station to satellite ground track (km). NASA Backtrack / CEOS EO method. */
function crossTrackDistanceKm(subLatDeg, subLonDeg, trackBearingRad, gsLatRad, gsLonRad) {
  const subLatRad = subLatDeg * deg2rad;
  const subLonRad = subLonDeg * deg2rad;
  const angularDistance = greatCircleDistanceRad(subLatRad, subLonRad, gsLatRad, gsLonRad);
  if (angularDistance < 1e-12) {
    return 0;
  }
  const bearingToGs = initialBearingRad(subLatRad, subLonRad, gsLatRad, gsLonRad);
  const crossTrackRad = Math.asin(Math.sin(angularDistance) * Math.sin(bearingToGs - trackBearingRad));
  return Math.abs(crossTrackRad * EARTH_RADIUS_KM);
}

/** Ground-track bearing (rad, from north) from ECEF velocity at the sub-satellite point. */
function groundTrackBearingFromVelocity(positionGd, velocityEcf) {
  const latRad = positionGd.latitude;
  const lonRad = positionGd.longitude;
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const sinLon = Math.sin(lonRad);
  const cosLon = Math.cos(lonRad);
  const eastX = -sinLon;
  const eastY = cosLon;
  const northX = -sinLat * cosLon;
  const northY = -sinLat * sinLon;
  const northZ = cosLat;
  const ve = velocityEcf.x * eastX + velocityEcf.y * eastY;
  const vn = velocityEcf.x * northX + velocityEcf.y * northY + velocityEcf.z * northZ;
  if (Math.hypot(ve, vn) < 1e-6) {
    return null;
  }
  return Math.atan2(ve, vn);
}

export default class Orbit {
  constructor(name, tle) {
    this.name = name;
    this.tle = tle.split("\n");
    this.satrec = satellitejs.twoline2satrec(this.tle[1], this.tle[2]);
  }

  get satnum() {
    return this.satrec.satnum;
  }

  get error() {
    return this.satrec.error;
  }

  get julianDate() {
    return this.satrec.jdsatepoch;
  }

  get orbitalPeriod() {
    const meanMotionRad = this.satrec.no;
    const period = (2 * Math.PI) / meanMotionRad;
    return period;
  }

  positionECI(time) {
    const result = satellitejs.propagate(this.satrec, time);
    return result ? result.position : null;
  }

  positionECF(time) {
    const positionEci = this.positionECI(time);
    if (!positionEci) return null;
    const gmst = satellitejs.gstime(time);
    const positionEcf = satellitejs.eciToEcf(positionEci, gmst);
    return positionEcf;
  }

  positionGeodetic(timestamp, calculateVelocity = false) {
    const result = satellitejs.propagate(this.satrec, timestamp);
    if (!result) return null;
    const { position: positionEci, velocity: velocityVector } = result;
    const gmst = satellitejs.gstime(timestamp);
    const positionGd = satellitejs.eciToGeodetic(positionEci, gmst);

    return {
      longitude: positionGd.longitude * rad2deg,
      latitude: positionGd.latitude * rad2deg,
      height: positionGd.height * 1000,
      ...(calculateVelocity && {
        velocity: Math.sqrt(velocityVector.x * velocityVector.x + velocityVector.y * velocityVector.y + velocityVector.z * velocityVector.z),
      }),
    };
  }

  computePassesElevation(groundStationPosition, startDate = dayjs().toDate(), endDate = dayjs(startDate).add(7, "day").toDate(), minElevation = 5, maxPasses = 50) {
    const groundStation = { ...groundStationPosition };
    groundStation.latitude *= deg2rad;
    groundStation.longitude *= deg2rad;
    groundStation.height /= 1000;

    const date = new Date(startDate);
    const passes = [];
    let pass = false;
    let ongoingPass = false;
    let lastElevation = 0;
    // eslint-disable-next-line no-unmodified-loop-condition -- date is mutated via setMinutes/setSeconds
    while (date < endDate) {
      const positionEcf = this.positionECF(date);
      if (!positionEcf) {
        date.setMinutes(date.getMinutes() + 1);
        continue;
      }
      const lookAngles = satellitejs.ecfToLookAngles(groundStation, positionEcf);
      const elevation = lookAngles.elevation / deg2rad;

      if (elevation > minElevation) {
        if (!ongoingPass) {
          // Start of new pass
          pass = {
            name: this.name,
            start: date.getTime(),
            azimuthStart: lookAngles.azimuth,
            maxElevation: elevation,
            azimuthApex: lookAngles.azimuth,
          };
          ongoingPass = true;
        } else if (elevation > pass.maxElevation) {
          // Ongoing pass
          pass.maxElevation = elevation;
          pass.apex = date.getTime();
          pass.azimuthApex = lookAngles.azimuth;
        }
        date.setSeconds(date.getSeconds() + 5);
      } else if (ongoingPass) {
        // End of pass
        pass.end = date.getTime();
        pass.duration = pass.end - pass.start;
        pass.azimuthEnd = lookAngles.azimuth;
        pass.azimuthStart /= deg2rad;
        pass.azimuthApex /= deg2rad;
        pass.azimuthEnd /= deg2rad;
        passes.push(pass);
        if (passes.length >= maxPasses) {
          break;
        }
        ongoingPass = false;
        lastElevation = -180;
        date.setMinutes(date.getMinutes() + this.orbitalPeriod * 0.5);
      } else {
        const deltaElevation = elevation - lastElevation;
        lastElevation = elevation;
        if (deltaElevation < 0) {
          date.setMinutes(date.getMinutes() + this.orbitalPeriod * 0.5);
          lastElevation = -180;
        } else if (elevation < -20) {
          date.setMinutes(date.getMinutes() + 5);
        } else if (elevation < -5) {
          date.setMinutes(date.getMinutes() + 1);
        } else if (elevation < -1) {
          date.setSeconds(date.getSeconds() + 5);
        } else {
          date.setSeconds(date.getSeconds() + 2);
        }
      }
    }
    return passes;
  }

  computePassesSwath(
    groundStationPosition,
    swathKm,
    startDate = dayjs().toDate(),
    endDate = dayjs(startDate).add(SWATH_PREDICTION_DAYS, "day").toDate(),
    maxPasses = SWATH_MAX_PASSES,
    minElevation = SWATH_MIN_ELEVATION_DEG,
  ) {
    const groundStation = { ...groundStationPosition };
    groundStation.latitude *= deg2rad;
    groundStation.longitude *= deg2rad;
    groundStation.height /= 1000;

    const halfSwath = swathKm / 2;
    const minElevationRad = minElevation * deg2rad;

    const swathStateAt = (date, bearingDeltaMs = 45_000) => {
      const result = satellitejs.propagate(this.satrec, date);
      if (!result?.position) {
        return null;
      }

      const gmst = satellitejs.gstime(date);
      const positionEcf = satellitejs.eciToEcf(result.position, gmst);
      const lookAngles = satellitejs.ecfToLookAngles(groundStation, positionEcf);
      if (lookAngles.elevation < minElevationRad) {
        return null;
      }

      const positionGd = satellitejs.eciToGeodetic(result.position, gmst);
      const subLatDeg = positionGd.latitude * rad2deg;
      const subLonDeg = positionGd.longitude * rad2deg;

      let trackBearing = null;
      if (result.velocity) {
        const velocityEcf = satellitejs.eciToEcf(result.velocity, gmst);
        trackBearing = groundTrackBearingFromVelocity(positionGd, velocityEcf);
      }
      if (trackBearing == null) {
        const before = this.positionGeodetic(new Date(date.getTime() - bearingDeltaMs));
        const after = this.positionGeodetic(new Date(date.getTime() + bearingDeltaMs));
        if (!before || !after) {
          return null;
        }
        trackBearing = initialBearingRad(before.latitude * deg2rad, before.longitude * deg2rad, after.latitude * deg2rad, after.longitude * deg2rad);
      }

      const crossTrack = crossTrackDistanceKm(subLatDeg, subLonDeg, trackBearing, groundStation.latitude, groundStation.longitude);

      return {
        inSwath: crossTrack <= halfSwath,
        crossTrack,
        elevation: lookAngles.elevation / deg2rad,
      };
    };

    const refineBoundary = (fromDate, toDate, entering) => {
      let lo = fromDate.getTime();
      let hi = toDate.getTime();
      while (hi - lo > 1000) {
        const mid = new Date((lo + hi) / 2);
        const state = swathStateAt(mid);
        const inside = state?.inSwath ?? false;
        if (entering ? inside : !inside) {
          hi = mid.getTime();
        } else {
          lo = mid.getTime();
        }
      }
      return new Date(hi);
    };

    const date = new Date(startDate);
    const passes = [];
    let pass = false;
    let ongoingPass = false;
    let lastCrossTrack = Number.MAX_VALUE;
    let coarsePassStart = null;

    // eslint-disable-next-line no-unmodified-loop-condition -- date is mutated via setMinutes/setSeconds
    while (date < endDate) {
      const state = swathStateAt(date);

      if (!state) {
        if (ongoingPass) {
          pass.end = refineBoundary(coarsePassStart ?? new Date(pass.start), date, false).getTime();
          pass.duration = pass.end - pass.start;
          passes.push(pass);
          if (passes.length >= maxPasses) {
            break;
          }
          ongoingPass = false;
          pass = false;
        }
        date.setMinutes(date.getMinutes() + 2);
        lastCrossTrack = Number.MAX_VALUE;
        continue;
      }

      const { inSwath, crossTrack } = state;

      if (inSwath) {
        if (!ongoingPass) {
          const refinedStart = refineBoundary(new Date(date.getTime() - 120_000), date, true);
          coarsePassStart = refinedStart;
          pass = {
            name: this.name,
            start: refinedStart.getTime(),
            minCrossTrack: crossTrack,
            minCrossTrackTime: date.getTime(),
            swathWidth: swathKm,
            maxElevation: state.elevation,
          };
          ongoingPass = true;
        } else {
          if (crossTrack < pass.minCrossTrack) {
            pass.minCrossTrack = crossTrack;
            pass.minCrossTrackTime = date.getTime();
          }
          if (state.elevation > pass.maxElevation) {
            pass.maxElevation = state.elevation;
          }
        }
        date.setSeconds(date.getSeconds() + 10);
      } else if (ongoingPass) {
        pass.end = refineBoundary(coarsePassStart ?? new Date(pass.start), date, false).getTime();
        pass.duration = pass.end - pass.start;
        passes.push(pass);
        if (passes.length >= maxPasses) {
          break;
        }
        ongoingPass = false;
        pass = false;
        coarsePassStart = null;
        lastCrossTrack = Number.MAX_VALUE;
        date.setMinutes(date.getMinutes() + Math.max(5, this.orbitalPeriod * 0.15));
      } else {
        const deltaCrossTrack = crossTrack - lastCrossTrack;
        lastCrossTrack = crossTrack;

        if (crossTrack <= halfSwath * 4 && deltaCrossTrack <= 0) {
          date.setSeconds(date.getSeconds() + 15);
        } else if (crossTrack <= halfSwath * 8) {
          date.setMinutes(date.getMinutes() + 1);
        } else if (crossTrack > halfSwath * 8 && deltaCrossTrack > 0) {
          date.setMinutes(date.getMinutes() + Math.max(12, this.orbitalPeriod * 0.35));
        } else if (crossTrack > halfSwath * 16) {
          date.setMinutes(date.getMinutes() + Math.max(20, this.orbitalPeriod * 0.45));
        } else {
          date.setMinutes(date.getMinutes() + Math.max(4, this.orbitalPeriod * 0.1));
        }
      }
    }

    if (ongoingPass && pass) {
      pass.end = endDate.getTime();
      pass.duration = pass.end - pass.start;
      passes.push(pass);
    }

    return passes;
  }
}
