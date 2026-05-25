<template>
  <div class="satellite-select">
    <div class="toolbarTitle">Satellite groups</div>
    <div class="toolbarContent">
      <vue-multiselect
        v-model="enabledTags"
        class="sat-multiselect sat-multiselect--groups"
        :options="availableTags"
        :multiple="true"
        :searchable="false"
        :close-on-select="false"
        placeholder="Select groups…"
        :limit="2"
        :limit-text="(count) => `+${count} more`"
      />
    </div>

    <div class="sat-active-header">
      <span class="sat-active-header__title">Active</span>
      <span class="sat-active-count">{{ activeCount }}</span>
      <button v-if="activeCount" type="button" class="sat-clear-btn" @click="clearAllSatellites">Clear</button>
    </div>

    <div v-if="activeCount" class="sat-active-chips">
      <button
        v-for="sat in sortedActiveSatellites"
        :key="sat"
        type="button"
        class="sat-chip"
        :class="chipClass(sat)"
        :title="`Remove ${sat}`"
        @click="removeSatellite(sat)"
      >
        <span class="sat-chip__name">{{ sat }}</span>
        <span class="sat-chip__remove" aria-hidden="true">×</span>
      </button>
    </div>
    <p v-else class="sat-active-empty">Enable a group above, or tick satellites below.</p>

    <div class="sat-browse">
      <div class="sat-browse__head">
        <span class="sat-browse__title">Browse</span>
        <input v-model="searchQuery" class="sat-browse__search" type="search" placeholder="Filter…" autocomplete="off" />
      </div>
      <div class="sat-browse__list">
        <section v-for="group in filteredBrowseGroups" :key="group.tag" class="sat-browse-group" :class="groupClass(group.tag)">
          <button type="button" class="sat-browse-group__head" @click="toggleGroup(group.tag)">
            <span class="sat-browse-group__chev" :class="{ 'sat-browse-group__chev--open': isGroupOpen(group.tag) }">›</span>
            <span class="sat-browse-group__label">{{ group.tag }}</span>
            <span class="sat-browse-group__count">{{ group.enabledCount }}/{{ group.sats.length }}</span>
            <span class="sat-browse-group__toggle" @click.stop="toggleGroupSelection(group)">{{ group.enabledCount === group.sats.length ? "None" : "All" }}</span>
          </button>
          <div v-show="isGroupOpen(group.tag)" class="sat-browse-group__items">
            <label v-for="sat in group.sats" :key="sat" class="sat-browse-item" :class="{ 'sat-browse-item--on': enabledSatSet.has(sat) }">
              <input type="checkbox" :checked="enabledSatSet.has(sat)" @change="toggleSatellite(sat)" />
              <span class="sat-browse-item__name">{{ sat }}</span>
            </label>
          </div>
        </section>
        <p v-if="filteredBrowseGroups.length === 0" class="sat-browse-empty">No match</p>
      </div>
    </div>
  </div>
</template>

<script>
import VueMultiselect from "vue-multiselect";
import { mapWritableState } from "pinia";

import { useSatStore } from "../stores/sat";

const PRIORITY_TAGS = ["Pakistan Satellites", "SUPARCO", "Indian Satellites"];

export default {
  components: {
    VueMultiselect,
  },
  data() {
    return {
      searchQuery: "",
      openGroups: [...PRIORITY_TAGS],
    };
  },
  computed: {
    ...mapWritableState(useSatStore, ["availableSatellitesByTag", "availableTags", "enabledSatellites", "enabledTags", "trackedSatellite"]),
    activeCount() {
      return this.allEnabledSatellites.length;
    },
    enabledSatSet() {
      return new Set(this.allEnabledSatellites);
    },
    satelliteTagMap() {
      const map = {};
      for (const tag of this.availableTags) {
        for (const sat of this.availableSatellitesByTag[tag] || []) {
          if (!map[sat]) {
            map[sat] = tag;
          }
        }
      }
      return map;
    },
    satellitesEnabledByTag() {
      return this.getSatellitesFromTags(this.enabledTags);
    },
    allEnabledSatellites: {
      get() {
        return this.satellitesEnabledByTag.concat(this.enabledSatellites ?? []);
      },
      set(sats) {
        const enabledTags = this.availableTags.filter((tag) => !this.availableSatellitesByTag[tag].some((sat) => !sats.includes(sat)));
        const satellitesInEnabledTags = this.getSatellitesFromTags(enabledTags);
        const enabledSatellites = sats.filter((sat) => !satellitesInEnabledTags.includes(sat));
        cc.sats.enabledSatellites = enabledSatellites;
        cc.sats.enabledTags = enabledTags;
      },
    },
    sortedActiveSatellites() {
      return [...this.allEnabledSatellites].sort((a, b) => a.localeCompare(b));
    },
    browseGroups() {
      const enabledSet = this.enabledSatSet;
      const tags = [...this.availableTags].sort((a, b) => {
        const aPri = PRIORITY_TAGS.indexOf(a);
        const bPri = PRIORITY_TAGS.indexOf(b);
        if (aPri !== -1 || bPri !== -1) {
          return (aPri === -1 ? 99 : aPri) - (bPri === -1 ? 99 : bPri);
        }
        return a.localeCompare(b);
      });

      return tags.map((tag) => {
        const sats = [...(this.availableSatellitesByTag[tag] || [])].sort((a, b) => {
          const aOn = enabledSet.has(a);
          const bOn = enabledSet.has(b);
          if (aOn !== bOn) {
            return aOn ? -1 : 1;
          }
          return a.localeCompare(b);
        });
        return {
          tag,
          sats,
          enabledCount: sats.filter((sat) => enabledSet.has(sat)).length,
        };
      });
    },
    filteredBrowseGroups() {
      const q = this.searchQuery.trim().toLowerCase();
      if (!q) {
        return this.browseGroups;
      }
      return this.browseGroups
        .map((group) => {
          const tagMatch = group.tag.toLowerCase().includes(q);
          const sats = tagMatch ? group.sats : group.sats.filter((sat) => sat.toLowerCase().includes(q));
          if (sats.length === 0) {
            return null;
          }
          return {
            ...group,
            sats,
            enabledCount: sats.filter((sat) => this.enabledSatSet.has(sat)).length,
          };
        })
        .filter(Boolean);
    },
  },
  watch: {
    enabledSatellites(sats) {
      cc.sats.enabledSatellites = sats;
    },
    enabledTags(tags) {
      cc.sats.enabledTags = tags;
    },
    trackedSatellite(satellite) {
      cc.sats.trackedSatellite = satellite;
    },
    searchQuery(q) {
      if (!q.trim()) {
        return;
      }
      for (const group of this.filteredBrowseGroups) {
        if (!this.openGroups.includes(group.tag)) {
          this.openGroups.push(group.tag);
        }
      }
    },
  },
  methods: {
    getSatellitesFromTags(taglist) {
      return taglist.flatMap((tag) => this.availableSatellitesByTag[tag] || []);
    },
    tagForSat(sat) {
      return this.satelliteTagMap[sat] || "Other";
    },
    chipClass(sat) {
      const tag = this.tagForSat(sat);
      if (tag === "SUPARCO") {
        return "sat-chip--suparco";
      }
      if (tag.includes("Pakistan")) {
        return "sat-chip--pakistan";
      }
      if (tag.includes("Indian")) {
        return "sat-chip--india";
      }
      return "sat-chip--other";
    },
    groupClass(tag) {
      if (tag === "SUPARCO") {
        return "sat-browse-group--suparco";
      }
      if (tag.includes("Pakistan")) {
        return "sat-browse-group--pakistan";
      }
      if (tag.includes("Indian")) {
        return "sat-browse-group--india";
      }
      return "";
    },
    isGroupOpen(tag) {
      return this.openGroups.includes(tag);
    },
    toggleGroup(tag) {
      const index = this.openGroups.indexOf(tag);
      if (index >= 0) {
        this.openGroups.splice(index, 1);
      } else {
        this.openGroups.push(tag);
      }
    },
    toggleSatellite(sat) {
      if (this.enabledSatSet.has(sat)) {
        this.removeSatellite(sat);
      } else {
        this.allEnabledSatellites = [...this.allEnabledSatellites, sat];
      }
    },
    toggleGroupSelection(group) {
      const allOn = group.enabledCount === group.sats.length;
      if (allOn) {
        const remove = new Set(group.sats);
        this.allEnabledSatellites = this.allEnabledSatellites.filter((sat) => !remove.has(sat));
      } else {
        const merged = new Set(this.allEnabledSatellites);
        group.sats.forEach((sat) => merged.add(sat));
        this.allEnabledSatellites = [...merged];
      }
    },
    removeSatellite(sat) {
      this.allEnabledSatellites = this.allEnabledSatellites.filter((name) => name !== sat);
    },
    clearAllSatellites() {
      this.allEnabledSatellites = [];
    },
  },
};
</script>

<style scoped>
.satellite-select {
  width: 300px;
  max-width: min(300px, calc(100vw - 16px));
}

.sat-active-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px 2px;
}

.sat-active-header__title {
  font-weight: 600;
  font-size: 0.78rem;
  color: var(--gimu-yellow, #ffd700);
}

.sat-active-count {
  min-width: 1.25rem;
  padding: 0 5px;
  height: 1.1rem;
  border-radius: 999px;
  font-size: 0.65rem;
  font-weight: 700;
  line-height: 1.1rem;
  text-align: center;
  background: var(--gimu-blue, #002868);
  color: var(--gimu-yellow, #ffd700);
  border: 1px solid rgba(255, 215, 0, 0.35);
}

.sat-clear-btn {
  margin-left: auto;
  padding: 1px 7px;
  font-size: 0.62rem;
  text-transform: uppercase;
  border: 1px solid rgba(255, 215, 0, 0.3);
  border-radius: 3px;
  background: rgba(139, 0, 0, 0.5);
  color: #edffff;
  cursor: pointer;
}

.sat-clear-btn:hover {
  background: var(--gimu-red, #8b0000);
}

.sat-active-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  max-height: 72px;
  overflow-y: auto;
  padding: 2px 8px 6px;
  border-bottom: 1px solid rgba(255, 215, 0, 0.12);
}

.sat-active-empty {
  margin: 0 8px 6px;
  font-size: 0.68rem;
  color: rgba(237, 255, 255, 0.55);
}

.sat-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 1px 5px;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(48, 51, 54, 0.9);
  color: #edffff;
  cursor: pointer;
  font-size: 0.68rem;
  line-height: 1.25;
}

.sat-chip--pakistan {
  border-color: rgba(255, 215, 0, 0.55);
  background: rgba(0, 40, 104, 0.55);
}

.sat-chip--suparco {
  border-color: rgba(0, 200, 160, 0.55);
  background: rgba(0, 60, 50, 0.55);
}

.sat-chip--india {
  border-color: rgba(255, 153, 51, 0.55);
  background: rgba(19, 80, 10, 0.35);
}

.sat-chip__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sat-chip__remove {
  opacity: 0.7;
  font-size: 0.85rem;
}

.sat-browse {
  margin: 4px 6px 6px;
  border: 1px solid rgba(255, 215, 0, 0.18);
  border-radius: 6px;
  background: rgba(20, 24, 30, 0.92);
  overflow: hidden;
}

.sat-browse__head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.sat-browse__title {
  font-size: 0.68rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(237, 255, 255, 0.7);
  flex-shrink: 0;
}

.sat-browse__search {
  flex: 1;
  min-width: 0;
  height: 22px;
  padding: 0 6px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 3px;
  background: rgba(48, 51, 54, 0.85);
  color: #edffff;
  font-size: 0.72rem;
}

.sat-browse__search:focus {
  outline: none;
  border-color: rgba(255, 215, 0, 0.45);
}

.sat-browse__list {
  max-height: 200px;
  overflow-y: auto;
  overflow-x: hidden;
}

.sat-browse-group__head {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 3px 6px;
  border: 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  background: rgba(0, 40, 104, 0.35);
  color: #edffff;
  cursor: pointer;
  font-size: 0.68rem;
  text-align: left;
}

.sat-browse-group--pakistan .sat-browse-group__head {
  background: rgba(0, 40, 104, 0.5);
}

.sat-browse-group--suparco .sat-browse-group__head {
  background: rgba(0, 60, 50, 0.5);
}

.sat-browse-group--india .sat-browse-group__head {
  background: rgba(19, 80, 10, 0.35);
}

.sat-browse-group__chev {
  display: inline-block;
  width: 10px;
  transform: rotate(0deg);
  transition: transform 0.12s ease;
  opacity: 0.7;
}

.sat-browse-group__chev--open {
  transform: rotate(90deg);
}

.sat-browse-group__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
  color: var(--gimu-yellow, #ffd700);
}

.sat-browse-group__count {
  font-size: 0.62rem;
  opacity: 0.65;
  flex-shrink: 0;
}

.sat-browse-group__toggle {
  flex-shrink: 0;
  font-size: 0.6rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0 4px;
  color: rgba(255, 215, 0, 0.85);
  cursor: pointer;
}

.sat-browse-group__toggle:hover {
  text-decoration: underline;
}

.sat-browse-group__items {
  padding: 0;
}

.sat-browse-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 1px 6px 1px 18px;
  font-size: 0.68rem;
  line-height: 1.35;
  cursor: pointer;
  color: rgba(237, 255, 255, 0.82);
}

.sat-browse-item:hover {
  background: rgba(255, 255, 255, 0.04);
}

.sat-browse-item--on {
  background: rgba(0, 40, 104, 0.25);
  color: var(--gimu-yellow, #ffd700);
}

.sat-browse-item input {
  margin: 0;
  flex-shrink: 0;
  width: 12px;
  height: 12px;
  accent-color: var(--gimu-yellow, #ffd700);
}

.sat-browse-item__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sat-browse-empty {
  margin: 0;
  padding: 8px;
  font-size: 0.68rem;
  color: rgba(237, 255, 255, 0.5);
  text-align: center;
}
</style>

<style>
@import "vue-multiselect/dist/vue-multiselect.css";

.satellite-select .multiselect__single {
  display: none;
}

.satellite-select .sat-multiselect .multiselect__tags {
  border: 1px solid rgba(255, 215, 0, 0.2);
  background: rgba(24, 28, 34, 0.92);
  min-height: 32px;
  padding: 4px 40px 0 6px;
}

.satellite-select .sat-multiselect .multiselect__tag {
  background: var(--gimu-blue, #002868);
  border: 1px solid rgba(255, 215, 0, 0.3);
  color: var(--gimu-yellow, #ffd700);
  margin-bottom: 2px;
  padding: 2px 22px 2px 6px;
  font-size: 0.68rem;
}

.satellite-select .sat-multiselect .multiselect__tag-icon:after {
  color: var(--gimu-yellow, #ffd700);
}

.satellite-select .sat-multiselect .multiselect__tag-icon:hover {
  background: var(--gimu-red, #8b0000);
}

.satellite-select .sat-multiselect .multiselect__input,
.satellite-select .sat-multiselect .multiselect__placeholder {
  color: rgba(237, 255, 255, 0.5);
  font-size: 0.72rem;
  margin-bottom: 2px;
}
</style>
