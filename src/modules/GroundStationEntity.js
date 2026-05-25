import { BillboardGraphics, HorizontalOrigin, NearFarScalar, VerticalOrigin } from "@cesium/engine";
import { SWATH_PREDICTION_DAYS } from "../config/satellite-swath";
import dayjs from "dayjs";
import icon from "../images/icons/dish.svg";
import { CesiumComponentCollection } from "./util/CesiumComponentCollection";
import { DescriptionHelper } from "./util/DescriptionHelper";

export class GroundStationEntity extends CesiumComponentCollection {
  constructor(viewer, sats, position, givenName = "") {
    super(viewer);
    this.sats = sats;
    this.position = position;
    this.givenName = givenName;

    this.createEntities();
  }

  createEntities() {
    this.createDescription();
    this.createGroundStation();
  }

  createGroundStation() {
    const billboard = new BillboardGraphics({
      image: icon,
      horizontalOrigin: HorizontalOrigin.CENTER,
      verticalOrigin: VerticalOrigin.BOTTOM,
      scaleByDistance: new NearFarScalar(1e2, 0.2, 4e7, 0.1),
    });
    this.createCesiumEntity("Groundstation", "billboard", billboard, this.name, this.description, this.position.cartesian, false);
  }

  createDescription() {
    this.description = DescriptionHelper.cachedCallbackProperty((time) => {
      const passes = this.passes(time);
      const content = DescriptionHelper.renderGroundstationDescription(time, this.name, this.position, passes, this.sats.overpassMode);
      return content;
    });
  }

  get hasName() {
    return this.givenName !== "";
  }

  get name() {
    if (this.givenName) {
      return this.givenName;
    }
    return `${this.position.latitude.toFixed(2)}°, ${this.position.longitude.toFixed(2)}°`;
  }

  passes(time, deltaHours = null) {
    const horizonHours = deltaHours ?? (this.sats.overpassMode === "swath" ? SWATH_PREDICTION_DAYS * 24 : 48);
    this.sats.ensureVisiblePassesUpdated(this.viewer.clock.currentTime);
    let passes = [];
    this.sats.visibleSatellites.forEach((sat) => {
      passes.push(...sat.props.passes);
    });

    // Filter passes based on time
    passes = passes.filter((pass) => dayjs(pass.start).diff(time, "hours") < horizonHours);

    // Filter passes based on groundstation
    passes = passes.filter((pass) => pass.groundStationName === this.name);

    // Sort passes by time
    passes.sort((a, b) => a.start - b.start);
    return passes;
  }
}
