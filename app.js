const CATEGORY_DEFINITIONS = [
  { name: "강력범죄", color: "#d96b5f", shape: 1 },
  { name: "절도범죄", color: "#218b72", shape: 0 },
  { name: "폭력범죄", color: "#e58b39", shape: 2 },
  { name: "지능범죄", color: "#5d83c6", shape: 3 },
  { name: "풍속범죄", color: "#9874bb", shape: 4 },
  { name: "특별경제범죄", color: "#c18d39", shape: 5 },
  { name: "마약범죄", color: "#cf6282", shape: 6 },
  { name: "보건범죄", color: "#398ca0", shape: 7 },
  { name: "환경범죄", color: "#6d974e", shape: 8 },
  { name: "교통범죄", color: "#477c9f", shape: 9 },
  { name: "노동범죄", color: "#a27951", shape: 10 },
  { name: "안보범죄", color: "#695d9c", shape: 11 },
  { name: "선거범죄", color: "#bf5a54", shape: 12 },
  { name: "병역범죄", color: "#647d83", shape: 13 },
  { name: "기타범죄", color: "#738078", shape: 14 },
];

const MAP_TILE_URLS = [
  {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  {
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution: '&copy; OpenStreetMap &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
];

let activeData = window.CRIME_CSV_DATA;
let selectedTypes = new Set();
let searchQuery = "";
let selectedRegion = "";
let toastTimer;
const LOCATION_COORDINATES = window.CRIME_LOCATION_COORDS || {};

const map = L.map("map", { zoomControl: false, scrollWheelZoom: true }).setView([36.15, 127.8], 7);
let activeTileLayer;
let activeTileProvider = 0;
let tileFailures = 0;
let hasLoadedMapTiles = false;
const mapStatus = document.getElementById("map-status");

function setMapStatus(isVisible) {
  mapStatus.hidden = !isVisible;
  document.getElementById("map").classList.toggle("tiles-unavailable", isVisible);
}

function useTileProvider(providerIndex) {
  if (activeTileLayer) map.removeLayer(activeTileLayer);
  activeTileProvider = providerIndex;
  tileFailures = 0;
  const provider = MAP_TILE_URLS[providerIndex];
  activeTileLayer = L.tileLayer(provider.url, {
    maxZoom: 19,
    attribution: provider.attribution,
    errorTileUrl: "",
  }).addTo(map);
  activeTileLayer.on("tileload", () => {
    hasLoadedMapTiles = true;
    setMapStatus(false);
  });
  activeTileLayer.on("tileerror", () => {
    tileFailures += 1;
    if (tileFailures < 3) return;
    if (activeTileProvider + 1 < MAP_TILE_URLS.length) {
      useTileProvider(activeTileProvider + 1);
    } else {
      setMapStatus(true);
    }
  });
}

useTileProvider(0);
window.setTimeout(() => {
  if (!hasLoadedMapTiles) {
    if (activeTileProvider === 0) useTileProvider(1);
    else setMapStatus(true);
  }
}, 8000);
const markerLayer = L.markerClusterGroup({
  showCoverageOnHover: false,
  maxClusterRadius: 42,
  disableClusteringAtZoom: 14,
  iconCreateFunction(cluster) {
    return L.divIcon({
      className: "crime-cluster",
      html: `<span>${cluster.getChildCount()}</span>`,
      iconSize: [38, 38],
    });
  },
}).addTo(map);
const markerByPlace = new Map();
const typeFilters = document.getElementById("type-filters");
const mapLegend = document.getElementById("map-legend");
const regionSelect = document.getElementById("region-select");
let hasFittedNation = false;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function formatCount(value) {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function categoryDetails(name) {
  const index = CATEGORY_DEFINITIONS.findIndex((category) => category.name === name);
  if (index >= 0) return CATEGORY_DEFINITIONS[index];
  const colors = ["#597cad", "#bc7655", "#548977", "#9872a3", "#9b843f"];
  return { name, color: colors[(name.length + CATEGORY_DEFINITIONS.length) % colors.length], shape: (name.length + CATEGORY_DEFINITIONS.length) % 15 };
}

function categoryTotals(data) {
  const totals = new Map();
  const domesticIndexes = data.districts
    .map((district, index) => district.region === "해외" ? -1 : index)
    .filter((index) => index >= 0);
  for (const row of data.rows) {
    totals.set(row.major, (totals.get(row.major) || 0)
      + domesticIndexes.reduce((sum, index) => sum + row.counts[index], 0));
  }
  return totals;
}

function districtTotals(data, districtIndex) {
  const totals = new Map();
  for (const row of data.rows) {
    totals.set(row.major, (totals.get(row.major) || 0) + row.counts[districtIndex]);
  }
  return totals;
}

function domesticDistricts(data) {
  return data.districts
    .map((district, index) => ({ ...district, index }))
    .filter((district) => district.region !== "해외");
}

function localitySummaries(data) {
  return data.districts.map((district, index) => {
    const categories = [...districtTotals(data, index)]
      .filter(([type]) => selectedTypes.has(type))
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);
    return {
      ...district,
      index,
      coordinates: LOCATION_COORDINATES[`${district.region}|${district.name}`] || null,
      categories,
      total: categories.reduce((sum, category) => sum + category.count, 0),
    };
  }).filter((district) => district.coordinates);
}

function buildFilters() {
  typeFilters.replaceChildren();
  mapLegend.querySelectorAll(".legend-item").forEach((item) => item.remove());
  const totals = categoryTotals(activeData);
  const categoryNames = [...totals.keys()];
  selectedTypes = new Set(categoryNames);

  categoryNames.forEach((name) => {
    const details = categoryDetails(name);
    const label = document.createElement("label");
    label.className = "type-option";
    label.innerHTML = `<input type="checkbox" value="${escapeHtml(name)}" checked><span class="type-swatch shape-${details.shape}" style="--crime-color:${details.color}" aria-hidden="true"></span><span class="type-name">${escapeHtml(name)}</span><span class="type-count">${formatCount(totals.get(name))}</span>`;
    label.querySelector("input").addEventListener("change", (event) => {
      if (event.currentTarget.checked) selectedTypes.add(name);
      else selectedTypes.delete(name);
      render();
    });
    typeFilters.append(label);

    const legendItem = document.createElement("span");
    legendItem.className = "legend-item";
    legendItem.innerHTML = `<span class="legend-shape shape-${details.shape}" style="--crime-color:${details.color}" aria-hidden="true"></span>${escapeHtml(name)}`;
    mapLegend.append(legendItem);
  });
  document.getElementById("toggle-all-button").textContent = "전체 해제";

  const regions = [...new Set(activeData.districts.map((district) => district.region))];
  regionSelect.replaceChildren(new Option("전체 지역", ""));
  regions.forEach((region) => regionSelect.add(new Option(region === "해외" ? "해외 국가" : region, region)));
}

function filteredDistrictRows() {
  return localitySummaries(activeData)
    .filter((locality) => !selectedRegion || locality.region === selectedRegion)
    .filter((locality) => !searchQuery
      || locality.name.toLowerCase().includes(searchQuery)
      || locality.region.toLowerCase().includes(searchQuery))
    .sort((a, b) => b.total - a.total);
}

function markerIcon(locality) {
  const dominant = locality.categories[0];
  const category = dominant ? categoryDetails(dominant.type) : { color: "#aab4ae", shape: 0 };
  const label = locality.name.replace(/(특별자치도|특별자치시|특별시|광역시|자치시|자치구|시|군|구)$/u, "");
  return L.divIcon({
    className: "",
    html: `<span class="district-marker-wrap"><span class="marker-count">${escapeHtml(label)}</span><span class="district-marker shape-${category.shape}" style="--crime-color:${category.color}" aria-label="${escapeHtml(locality.region)} ${escapeHtml(locality.name)} ${formatCount(locality.total)}건"></span></span>`,
    iconSize: [54, 43],
    iconAnchor: [27, 39],
  });
}

function placeKey(locality) {
  return `${locality.region}|${locality.name}`;
}

function popupContent(locality) {
  const categories = locality.categories.slice(0, 5)
    .map((item) => `<div class="popup-category">${escapeHtml(item.type)} <strong>${formatCount(item.count)}건</strong></div>`)
    .join("");
  return `<div class="popup-title">${escapeHtml(locality.region)} ${escapeHtml(locality.name)} · ${activeData.year}년</div><div class="popup-total">${formatCount(locality.total)}건</div>${categories || '<div class="popup-category">선택한 유형의 통계가 없습니다.</div>'}<div class="popup-category">지역별 통계 집계 위치</div>`;
}

function focusLocality(locality) {
  selectedRegion = locality.region;
  regionSelect.value = selectedRegion;
  render();
  map.setView(locality.coordinates, locality.region === "해외" ? 5 : 14);
  markerByPlace.get(placeKey(locality))?.bindPopup(popupContent(locality)).openPopup();
}

function renderDistrictList(rows) {
  const list = document.getElementById("district-list");
  list.replaceChildren();
  if (rows.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "조건에 맞는 지역이 없습니다.";
    list.append(empty);
    return;
  }

  rows.forEach((district, index) => {
    const button = document.createElement("button");
    button.className = "district-row";
    button.type = "button";
    button.innerHTML = `<span class="district-rank${index < 3 ? " is-top" : ""}">${String(index + 1).padStart(3, "0")}</span><span class="district-row-name">${escapeHtml(district.name)}</span><span class="district-row-category">${escapeHtml(district.region)} · ${escapeHtml(district.categories[0]?.type || "선택된 유형 없음")}</span><span class="district-row-total">${formatCount(district.total)}</span>`;
    button.addEventListener("click", () => focusLocality(district));
    list.append(button);
  });
}

function render() {
  const allLocalities = localitySummaries(activeData);
  const listRows = filteredDistrictRows();
  const scopeLocalities = allLocalities.filter((locality) => selectedRegion
    ? locality.region === selectedRegion
    : locality.region !== "해외");
  const categoryTotalsSelected = new Map();
  for (const locality of scopeLocalities) {
    for (const category of locality.categories) {
      categoryTotalsSelected.set(category.type, (categoryTotalsSelected.get(category.type) || 0) + category.count);
    }
  }
  const total = [...categoryTotalsSelected.values()].reduce((sum, count) => sum + count, 0);
  const topCategory = [...categoryTotalsSelected].sort((a, b) => b[1] - a[1])[0];
  const topDistrict = scopeLocalities.slice().sort((a, b) => b.total - a.total)[0];

  document.getElementById("total-count").textContent = formatCount(total);
  document.getElementById("top-category").textContent = topCategory ? topCategory[0] : "-";
  document.getElementById("top-category-caption").textContent = topCategory ? `${formatCount(topCategory[1])}건 · 유형별 합계` : "선택된 범죄 유형 없음";
  document.getElementById("top-district").textContent = selectedTypes.size ? topDistrict?.name || "-" : "-";
  document.getElementById("top-district-caption").textContent = selectedTypes.size && topDistrict ? `${formatCount(topDistrict.total)}건 · 선택 유형 합계` : "선택된 범죄 유형 없음";
  document.getElementById("total-label").textContent = selectedRegion === "해외"
    ? "해외 발생 건수"
    : selectedRegion ? `${selectedRegion} 발생 건수` : "전국 발생 건수";
  document.getElementById("top-district-label").textContent = "발생 건수 최다 지역";
  document.getElementById("result-count").textContent = `${listRows.length}개 지역`;
  document.getElementById("map-result-label").textContent = `${allLocalities.length}개 시군구·국가 위치`;
  document.getElementById("district-heading").textContent = selectedRegion ? `${selectedRegion} 지역 현황` : "전체 지역 현황";
  document.getElementById("district-subheading").textContent = selectedRegion
    ? "CSV에 수록된 지역별 통계입니다."
    : "CSV에 포함된 모든 지역별 통계입니다.";
  document.getElementById("list-heading").textContent = selectedRegion ? `${selectedRegion} 지역 순위` : "시군구·국가 순위";

  map.closePopup();
  markerLayer.clearLayers();
  markerByPlace.clear();
  allLocalities.forEach((locality) => {
    const marker = L.marker(locality.coordinates, { icon: markerIcon(locality) });
    marker.on("click", () => focusLocality(locality));
    markerLayer.addLayer(marker);
    markerByPlace.set(placeKey(locality), marker);
  });
  const domesticLocations = allLocalities.filter((locality) => locality.region !== "해외");
  if (!selectedRegion && !searchQuery && !hasFittedNation && domesticLocations.length) {
    map.fitBounds(L.latLngBounds(domesticLocations.map((locality) => locality.coordinates)), { padding: [35, 35], maxZoom: 7 });
    hasFittedNation = true;
  }
  renderDistrictList(listRows);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    if (row.some((value) => value.trim() !== "")) rows.push(row);
  }
  return rows;
}

async function readCsvFile(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("euc-kr").decode(bytes);
  }
  return text.replace(/^\uFEFF/, "");
}

function parseDataset(text) {
  const parsed = parseCsv(text);
  const headers = parsed[0];
  const majorIndex = headers.indexOf("범죄대분류");
  const minorIndex = headers.indexOf("범죄중분류");
  if (majorIndex < 0 || minorIndex < 0) {
    throw new Error("CSV에 '범죄대분류'와 '범죄중분류' 열이 필요합니다.");
  }
  const aliases = {
    서울: "서울특별시", 부산: "부산광역시", 대구: "대구광역시", 인천: "인천광역시",
    광주: "광주광역시", 대전: "대전광역시", 울산: "울산광역시", 경기: "경기도",
    경기도: "경기도", 강원: "강원특별자치도", 강원도: "강원특별자치도",
    충북: "충청북도", 충남: "충청남도", 전북: "전북특별자치도", 전남: "전라남도",
    경북: "경상북도", 경남: "경상남도", 제주: "제주특별자치도", 외국: "해외",
  };
  const districtColumns = headers.map((header, index) => {
    const value = header.trim();
    if (value === "세종시") return { name: value, region: "세종특별자치시", index };
    const match = value.match(/^(\S+)\s+(.+)$/);
    if (!match || !aliases[match[1]]) return null;
    return { name: match[2].trim(), region: aliases[match[1]], index };
  }).filter(Boolean);
  if (!districtColumns.some((district) => district.region !== "해외")) {
    throw new Error("CSV에서 지역별 통계 열을 찾지 못했습니다.");
  }

  const rows = parsed.slice(1).map((fields, index) => {
    const major = fields[majorIndex]?.trim();
    if (!major) return null;
    const counts = districtColumns.map(({ index: columnIndex }) => {
      const value = (fields[columnIndex] || "0").trim().replaceAll(",", "");
      const count = Number(value);
      if (!Number.isFinite(count) || count < 0) {
        throw new Error(`${index + 2}행의 발생 건수가 올바른 숫자가 아닙니다.`);
      }
      return count;
    });
    return { major, minor: fields[minorIndex]?.trim() || "", counts };
  }).filter(Boolean);
  if (rows.length === 0) throw new Error("CSV에 읽을 수 있는 범죄 통계 행이 없습니다.");

  const yearMatch = fileNameYear(document.getElementById("csv-file").files[0]?.name || "");
  return {
    year: yearMatch || activeData.year,
    source: document.getElementById("csv-file").files[0]?.name || "CSV 통계",
    districts: districtColumns.map(({ name, region }) => ({ name, region })),
    rows,
  };
}

function fileNameYear(name) {
  const match = name.match(/(?:19|20)\d{2}/);
  return match ? Number(match[0]) : null;
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 3600);
}

function updateSource(data) {
  const source = data.source || "경찰청 범죄 발생 지역별 통계";
  document.getElementById("data-year").textContent = `${data.year}년 통계`;
  document.getElementById("data-source").textContent = source;
  document.getElementById("map-period").textContent = `${data.year}년 연간`;
  document.getElementById("guide-source").textContent = `${source}, ${data.year}년`;
}

document.getElementById("toggle-all-button").addEventListener("click", (event) => {
  const allSelected = selectedTypes.size === activeData.rows.reduce((types, row) => types.add(row.major), new Set()).size;
  selectedTypes = allSelected ? new Set() : new Set(activeData.rows.map((row) => row.major));
  typeFilters.querySelectorAll("input").forEach((checkbox) => {
    checkbox.checked = selectedTypes.has(checkbox.value);
  });
  event.currentTarget.textContent = allSelected ? "전체 선택" : "전체 해제";
  render();
});

regionSelect.addEventListener("change", () => {
  selectedRegion = regionSelect.value;
  render();
  if (selectedRegion) {
    const locations = localitySummaries(activeData).filter((locality) => locality.region === selectedRegion);
    if (locations.length === 1) {
      map.flyTo(locations[0].coordinates, selectedRegion === "해외" ? 3 : 10, { duration: 0.45 });
    } else if (locations.length > 1) {
      map.flyToBounds(L.latLngBounds(locations.map((locality) => locality.coordinates)), {
        padding: [30, 30],
        maxZoom: selectedRegion === "해외" ? 3 : 9,
        duration: 0.45,
      });
    }
  } else {
    const locations = localitySummaries(activeData).filter((locality) => locality.region !== "해외");
    map.flyToBounds(L.latLngBounds(locations.map((locality) => locality.coordinates)), { padding: [35, 35], maxZoom: 7, duration: 0.45 });
  }
});

document.getElementById("csv-file").addEventListener("change", async (event) => {
  const file = event.currentTarget.files[0];
  if (!file) return;
  try {
    const parsed = parseDataset(await readCsvFile(file));
    activeData = parsed;
    selectedRegion = "";
    buildFilters();
    updateSource(activeData);
    render();
    const localities = domesticDistricts(activeData);
    showToast(`${file.name}에서 국내 ${localities.length}개 시군구와 해외 ${activeData.districts.length - localities.length}개 국가를 불러왔습니다.`);
  } catch (error) {
    showToast(`CSV를 불러오지 못했습니다: ${error.message}`);
    event.currentTarget.value = "";
  }
});

const searchInput = document.getElementById("search-input");
searchInput.addEventListener("input", () => {
  searchQuery = searchInput.value.trim().toLowerCase();
  render();
});
searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    searchInput.value = "";
    searchQuery = "";
    render();
  }
});
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    searchInput.focus();
  }
});

document.getElementById("zoom-in-button").addEventListener("click", () => map.zoomIn());
document.getElementById("zoom-out-button").addEventListener("click", () => map.zoomOut());
document.getElementById("reset-map-button").addEventListener("click", () => {
  selectedRegion = "";
  searchQuery = "";
  searchInput.value = "";
  regionSelect.value = "";
  render();
  const locations = localitySummaries(activeData).filter((locality) => locality.region !== "해외");
  map.flyToBounds(L.latLngBounds(locations.map((locality) => locality.coordinates)), { padding: [35, 35], maxZoom: 7, duration: 0.5 });
});

if (!activeData || !Array.isArray(activeData.rows)) {
  showToast("기본 통계 파일을 읽지 못했습니다. 페이지를 새로고침해 주세요.");
} else {
  buildFilters();
  updateSource(activeData);
  render();
}
