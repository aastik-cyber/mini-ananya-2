// Memory Map front-end: plain JavaScript + Leaflet.
const $ = (s) => document.querySelector(s);
const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g,
  (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));

const MOODS = {Happy: "😊", Excited: "🤩", Peaceful: "😌", Nostalgic: "🥹", Grateful: "🙏", Loved: "🥰", Sad: "😢"};
const CATS = {Travel: "✈️", College: "🎓", Family: "👨‍👩‍👧", Friends: "👯", Food: "🍰", Celebration: "🎉", Nature: "🌿", Other: "✨"};
const FEATURES = [
  ['<img class="ico" src="/static/girl.svg" alt="">', "Pin a moment", "Click the map or press Use my location to attach a memory to the exact place it happened."],
  ["📸", "Keep the photos", "Add several photos to every memory and tap any picture to see it full size."],
  ["🕰️", "Travel in time", "The timeline groups memories by year and month, and On this day brings back old ones."],
  ["🧳", "Build journeys", "Link memories into a route, see the distance, and press play to watch the trip."],
  ["🔥", "Find your hotspots", "Switch on the heatmap to see where your life happens most."],
  ["🎞️", "Replay your life", "Start a slideshow of your photos and stories, with captions, speed control and shuffle."],
  ["💗", "Favourites and badges", "Heart your best memories, grow your streak and unlock badges."]
];

async function api(url, options) {
  const res = await fetch(url, options);
  let data = {};
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 2600);
}

function formatDate(d) { const [y, m, day] = d.split("-"); return day + "-" + m + "-" + y; }
function emo(label, set) { return label && set[label] ? set[label] + " " : ""; }
function chip(label, set) { return label ? '<span class="tag">' + emo(label, set) + esc(label) + "</span>" : ""; }
function tagsHtml(m) { return m.tags ? m.tags.split(",").map((t) => '<span class="tag">#' + esc(t) + "</span>").join("") : ""; }
function photosHtml(m) { return m.photos.map((p) => '<img class="zoom" src="' + p.url + '" alt="Photo from ' + esc(m.title) + '">').join(""); }
function todayIso() { return new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10); }

function fillSelects() {
  document.querySelectorAll("select[data-opts]").forEach((s) => {
    const set = s.dataset.opts === "mood" ? MOODS : CATS;
    s.innerHTML = '<option value="">' + (s.dataset.blank || "-") + "</option>" +
      Object.keys(set).map((k) => '<option value="' + k + '">' + set[k] + " " + k + "</option>").join("");
  });
}

function countUp(el, to) {
  const from = +el.textContent || 0, start = performance.now();
  (function step(now) {
    const p = Math.min(1, (now - start) / 800);
    el.textContent = Math.round(from + (to - from) * p);
    if (p < 1) requestAnimationFrame(step);
  })(start);
}

function floatHearts(root) {
  const box = root.querySelector(".hearts");
  if (!box) return;
  const icons = ["💗", "🌸", "💖", "🎀"];
  for (let i = 0; i < 9; i++) {
    const s = document.createElement("span");
    s.textContent = icons[i % icons.length];
    s.style.cssText = "left:" + Math.random() * 95 + "%;font-size:" + (14 + Math.random() * 16) + "px;animation-duration:" +
      (12 + Math.random() * 10) + "s;animation-delay:-" + Math.random() * 14 + "s";
    box.appendChild(s);
  }
}

// Auto-rotating feature carousel (used in the landing page and the map banner).
function buildCarousel(root) {
  root.innerHTML = FEATURES.map((f, i) => '<div class="slide' + (i ? "" : " on") + '"><span class="emoji">' + f[0] +
    "</span><h3>" + f[1] + "</h3><p>" + f[2] + '</p></div>').join("") + '<div class="dots">' +
    FEATURES.map((f, i) => '<button type="button" aria-label="Show tip ' + (i + 1) + '"' + (i ? "" : ' class="on"') + "></button>").join("") + "</div>";
  const slides = root.querySelectorAll(".slide"), dots = root.querySelectorAll(".dots button");
  let at = 0, timer;
  function show(i) {
    at = (i + slides.length) % slides.length;
    slides.forEach((s, k) => s.classList.toggle("on", k === at));
    dots.forEach((d, k) => d.classList.toggle("on", k === at));
  }
  function play() { clearInterval(timer); timer = setInterval(() => show(at + 1), 4500); }
  dots.forEach((d, k) => d.onclick = () => { show(k); play(); });
  root.onmouseenter = () => clearInterval(timer);
  root.onmouseleave = play;
  play();
}

function makeMap() {
  const street = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    {maxZoom: 19, attribution: "&copy; OpenStreetMap contributors"});
  const sat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {maxZoom: 18, attribution: "Imagery &copy; Esri"});
  const map = L.map("map", {layers: [street]}).setView([30.3165, 78.0322], 6);
  L.control.layers({"Streets": street, "Satellite": sat}).addTo(map);
  return map;
}

// Map marker: the girl with luggage (a small heart is added for favourites).
function pin(fav) {
  return L.divIcon({className: "",
    html: '<div class="avatar"><img src="/static/girl.svg" alt="">' + (fav ? '<span class="fh">💗</span>' : "") + "</div>",
    iconSize: [45, 60], iconAnchor: [22, 56], popupAnchor: [0, -52]});
}

// ------------------------------------------------------------------ map page
function initMapPage() {
  const map = makeMap();
  const markers = L.layerGroup().addTo(map);
  let pickMarker = null, heat = null, memories = [], allMemories = [], editingId = null, markerById = {};
  const form = $("#memForm");

  function setPick(lat, lng) {
    form.latitude.value = lat.toFixed(6);
    form.longitude.value = lng.toFixed(6);
    $("#pickHint").textContent = "Location chosen. Drag the pin to adjust it.";
    if (pickMarker) pickMarker.setLatLng([lat, lng]);
    else {
      pickMarker = L.marker([lat, lng], {draggable: true, icon: pin(false)}).addTo(map);
      pickMarker.on("dragend", () => { const p = pickMarker.getLatLng(); setPick(p.lat, p.lng); });
    }
    guessPlace(lat, lng);
  }
  async function guessPlace(lat, lng) {  // fills the place name from OpenStreetMap
    if (editingId || (form.place.value && !form.place.dataset.auto)) return;
    try {
      const r = await fetch("https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&lat=" + lat + "&lon=" + lng);
      const a = (await r.json()).address || {};
      const name = a.city || a.town || a.village || a.suburb || a.county || a.state || "";
      if (name && (!form.place.value || form.place.dataset.auto)) { form.place.value = name; form.place.dataset.auto = "1"; }
    } catch (e) {}
  }
  form.place.oninput = () => delete form.place.dataset.auto;
  map.on("click", (e) => setPick(e.latlng.lat, e.latlng.lng));

  $("#useLoc").onclick = () => {
    if (!navigator.geolocation) { $("#formMsg").textContent = "Your browser has no location support. Click the map instead."; return; }
    navigator.geolocation.getCurrentPosition((pos) => {
      setPick(pos.coords.latitude, pos.coords.longitude);
      map.setView([pos.coords.latitude, pos.coords.longitude], 15);
    }, () => { $("#formMsg").textContent = "Location permission was refused. Click the map instead."; });
  };

  $("#geoForm").onsubmit = async (e) => {  // search a place and fly there
    e.preventDefault();
    const q = $("#geoQ").value.trim();
    if (!q) return;
    try {
      const r = await (await fetch("https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=" + encodeURIComponent(q))).json();
      if (!r.length) { toast("No place found for that search."); return; }
      map.flyTo([+r[0].lat, +r[0].lon], 13);
    } catch (err) { toast("Place search needs an internet connection."); }
  };

  form.photos.onchange = () => {  // preview chosen photos
    $("#newPhotos").innerHTML = [...form.photos.files].map((f) => '<div><img src="' + URL.createObjectURL(f) + '" alt="Selected photo"></div>').join("");
  };

  function popupHtml(m) {
    return '<div class="card"><h3>' + esc(m.title) + "</h3>" +
      '<div class="meta">' + formatDate(m.date) + (m.place ? " · " + esc(m.place) : "") + "</div>" +
      "<div>" + chip(m.category, CATS) + chip(m.mood, MOODS) + "</div>" +
      '<div class="photos">' + photosHtml(m) + "</div>" +
      "<p>" + esc(m.description) + "</p>" + tagsHtml(m) +
      '<div class="actions"><button onclick="toggleFav(' + m.id + ')">' + (m.favorite ? "💗 Favourite" : "🤍 Favourite") + "</button>" +
      '<button onclick="editMemory(' + m.id + ')">Edit</button>' +
      '<button class="danger" onclick="deleteMemory(' + m.id + ')">Delete</button></div></div>';
  }

  function drawHeat() {
    if (heat) { map.removeLayer(heat); heat = null; }
    if (!$("#heatToggle").checked || !memories.length) return;
    heat = L.heatLayer(memories.map((m) => [m.latitude, m.longitude, 0.6]),
      {radius: 30, blur: 22, gradient: {0.3: "#ffc2d9", 0.6: "#ff77a8", 1: "#c2186b"}}).addTo(map);
  }

  async function load(fit) {
    const params = new URLSearchParams(new FormData($("#filterForm")));
    for (const [k, v] of [...params]) if (!v) params.delete(k);
    memories = await api("/api/memories?" + params);
    markers.clearLayers(); markerById = {};
    memories.forEach((m) => {
      const mk = L.marker([m.latitude, m.longitude], {icon: pin(m.favorite)}).bindPopup(popupHtml(m), {maxWidth: 290});
      mk.addTo(markers); markerById[m.id] = mk;
    });
    $("#count").textContent = memories.length + (memories.length === 1 ? " memory shown" : " memories shown");
    if (fit && memories.length) map.fitBounds(memories.map((m) => [m.latitude, m.longitude]), {maxZoom: 13, padding: [40, 40]});
    drawHeat();
  }

  async function loadOnThisDay() {
    const list = await api("/api/onthisday");
    $("#onThisDay").hidden = !list.length;
    $("#otdList").innerHTML = list.map((m) => '<div class="otd"><b>' + esc(m.title) + '</b><br><span class="meta">' +
      formatDate(m.date) + (m.place ? " · " + esc(m.place) : "") + "</span></div>").join("");
    document.querySelectorAll(".otd").forEach((el, i) => el.onclick = () => showMemory(list[i].id));
  }

  async function refreshBanner() {
    const [s, all] = await Promise.all([api("/api/stats"), api("/api/memories")]);
    allMemories = all;
    countUp($("#cMem"), s.total_memories); countUp($("#cLoc"), s.total_locations);
    countUp($("#cPho"), s.total_photos); countUp($("#cStr"), s.streak);
    const box = $("#mod");
    if (!all.length) { box.innerHTML = "<h3>Your map is empty</h3><p>Click anywhere on the map to pin your first memory.</p>"; return; }
    const m = all[Math.floor(Date.now() / 86400000) % all.length];
    box.innerHTML = '<div class="meta">Memory of the day</div><h3>' + esc(m.title) + '</h3><div class="meta">' + formatDate(m.date) +
      (m.place ? " · " + esc(m.place) : "") + "</div>" + (m.photos[0] ? '<img src="' + m.photos[0].url + '" alt="">' : "") +
      '<button id="modGo" type="button">Visit this memory</button>';
    $("#modGo").onclick = () => showMemory(m.id);
  }

  async function showMemory(id) {
    if (!markerById[id]) { $("#filterForm").reset(); await load(false); }
    const m = memories.find((x) => x.id === id);
    if (!m) return;
    map.setView([m.latitude, m.longitude], 14);
    markerById[id].openPopup();
  }

  async function refreshAll() { await load(false); loadOnThisDay(); refreshBanner(); }

  function resetForm() {
    form.reset(); editingId = null;
    form.latitude.value = ""; form.longitude.value = ""; form.date.value = todayIso();
    delete form.place.dataset.auto;
    $("#formTitle").textContent = "Add a memory"; $("#saveBtn").textContent = "Save memory";
    $("#cancelEdit").hidden = true; $("#oldPhotos").innerHTML = ""; $("#newPhotos").innerHTML = "";
    $("#pickHint").textContent = "Click the map to choose where it happened.";
    if (pickMarker) { map.removeLayer(pickMarker); pickMarker = null; }
  }

  form.onsubmit = async (e) => {
    e.preventDefault();
    $("#formMsg").textContent = "";
    const wasEdit = !!editingId;
    try {
      await api(editingId ? "/api/memories/" + editingId : "/api/memories", {method: "POST", body: new FormData(form)});
      resetForm(); await refreshAll();
      toast(wasEdit ? "Changes saved 💗" : "Memory pinned 🧳");
    } catch (err) { $("#formMsg").textContent = err.message; }
  };
  $("#cancelEdit").onclick = resetForm;

  window.editMemory = (id) => {
    const m = memories.find((x) => x.id === id);
    if (!m) return;
    map.closePopup();
    editingId = id;
    for (const k of ["title", "date", "place", "mood", "category", "description"]) form[k].value = m[k] || "";
    form.tags.value = m.tags;
    setPick(m.latitude, m.longitude);
    $("#formTitle").textContent = "Edit memory"; $("#saveBtn").textContent = "Save changes";
    $("#cancelEdit").hidden = false;
    $("#oldPhotos").innerHTML = m.photos.map((p) => '<div><img src="' + p.url + '" alt=""><button type="button" onclick="removePhoto(' + p.id + ')" aria-label="Remove photo">x</button></div>').join("");
    form.scrollIntoView({behavior: "smooth"});
  };
  window.removePhoto = async (pid) => {
    if (!confirm("Remove this photo?")) return;
    await api("/api/photos/" + pid, {method: "DELETE"});
    await load(false); refreshBanner(); window.editMemory(editingId);
  };
  window.deleteMemory = async (id) => {
    if (!confirm("Delete this memory and its photos?")) return;
    await api("/api/memories/" + id, {method: "DELETE"});
    map.closePopup(); await refreshAll(); toast("Memory deleted");
  };
  window.toggleFav = async (id) => {
    const r = await api("/api/memories/" + id + "/favorite", {method: "POST"});
    await load(false); refreshBanner();
    if (markerById[id]) markerById[id].openPopup();
    toast(r.favorite ? "Added to favourites 💗" : "Removed from favourites");
  };

  $("#filterForm").onsubmit = (e) => { e.preventDefault(); load(true); };
  $("#clearFilters").onclick = () => { $("#filterForm").reset(); load(true); };
  $("#heatToggle").onchange = drawHeat;
  $("#playAll").onclick = () => startSlideshow(allMemories);
  $("#playFiltered").onclick = () => startSlideshow(memories);

  // banner
  const h = new Date().getHours();
  $("#greet").textContent = (h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening") + ", " + (document.body.dataset.user || "friend") + " 🌸";
  $("#heroToggle").onclick = () => {
    const c = $("#hero").classList.toggle("collapsed");
    $("#heroToggle").textContent = c ? "Show banner" : "Hide banner";
    setTimeout(() => map.invalidateSize(), 50);
  };
  $("#focusAdd").onclick = () => { form.scrollIntoView({behavior: "smooth"}); form.title.focus(); toast("Click the map to choose the place"); };
  $("#surprise").onclick = () => {
    if (!allMemories.length) { toast("Add a memory first, then I can surprise you."); return; }
    const m = allMemories[Math.floor(Math.random() * allMemories.length)];
    showMemory(m.id); toast("Remember this one? " + m.title);
  };

  resetForm(); load(true); loadOnThisDay(); refreshBanner();
}

// ----------------------------------------------------------------- slideshow
function startSlideshow(list) {
  if (!list || !list.length) { toast("Add a memory first, then press play."); return; }
  const base = list.slice().sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  let slides = [], at = 0, playing = true, secs = 5, shuffle = false, timer = null;

  function build() {  // one slide per photo; memories without photos get a text slide
    const src = base.slice();
    if (shuffle) for (let i = src.length - 1; i > 0; i--) { const k = Math.floor(Math.random() * (i + 1)); [src[i], src[k]] = [src[k], src[i]]; }
    slides = [];
    src.forEach((m) => {
      if (m.photos.length) m.photos.forEach((p, i) => slides.push({m: m, src: p.url, n: i + 1, of: m.photos.length}));
      else slides.push({m: m, src: "", n: 1, of: 1});
    });
  }

  const box = document.createElement("div");
  box.id = "show";
  box.innerHTML = '<div class="show-stage"><div class="show-bg"></div><img class="show-ava" src="/static/girl.svg" alt="">' +
    '<img class="show-img" alt=""><div class="show-cap"></div></div><div class="show-bar"><i></i></div>' +
    '<div class="show-ctl"><span class="show-count"></span>' +
    '<button type="button" data-a="prev" aria-label="Previous">⏮</button>' +
    '<button type="button" data-a="play" aria-label="Pause">⏸</button>' +
    '<button type="button" data-a="next" aria-label="Next">⏭</button>' +
    '<select aria-label="Speed"><option value="3">Fast</option><option value="5" selected>Normal</option><option value="9">Slow</option></select>' +
    '<button type="button" data-a="shuffle">🔀 Shuffle</button><button type="button" data-a="full">⛶ Full screen</button>' +
    '<button type="button" data-a="close">✕ Close</button></div>';
  document.body.appendChild(box);
  document.body.style.overflow = "hidden";
  const q = (s) => box.querySelector(s);

  function schedule() {
    clearTimeout(timer);
    const bar = q(".show-bar i");
    bar.style.animation = "none";
    void bar.offsetWidth;  // restart the progress bar
    if (playing) { bar.style.animation = "fill " + secs + "s linear forwards"; timer = setTimeout(() => go(1), secs * 1000); }
  }

  function render() {
    const s = slides[at], m = s.m;
    q(".show-stage").classList.toggle("textonly", !s.src);
    q(".show-bg").style.backgroundImage = s.src ? 'url("' + s.src + '")' : "none";
    const img = q(".show-img");
    if (s.src) { img.src = s.src; img.alt = "Photo from " + m.title; img.classList.remove("kb"); void img.offsetWidth; img.classList.add("kb"); }
    q(".show-cap").innerHTML = "<h2>" + esc(m.title) + (m.favorite ? " 💗" : "") + '</h2><div class="show-meta">' + formatDate(m.date) +
      (m.place ? " · " + esc(m.place) : "") + (s.of > 1 ? " · photo " + s.n + " of " + s.of : "") + "</div><div>" +
      chip(m.category, CATS) + chip(m.mood, MOODS) + "</div>" + (m.description ? "<p>" + esc(m.description) + "</p>" : "");
    q(".show-count").textContent = (at + 1) + " / " + slides.length;
    const nx = slides[(at + 1) % slides.length];
    if (nx.src) new Image().src = nx.src;  // load the next photo early
    schedule();
  }

  function go(d) { at = (at + d + slides.length) % slides.length; render(); }
  function togglePlay() {
    playing = !playing;
    const b = q('[data-a="play"]');
    b.textContent = playing ? "⏸" : "▶";
    b.setAttribute("aria-label", playing ? "Pause" : "Play");
    schedule();
  }
  function close() {
    clearTimeout(timer);
    document.removeEventListener("keydown", onKey);
    if (document.fullscreenElement) document.exitFullscreen();
    box.remove();
    document.body.style.overflow = "";
  }
  function onKey(e) {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowRight") go(1);
    else if (e.key === "ArrowLeft") go(-1);
    else if (e.key === " ") { e.preventDefault(); togglePlay(); }
  }

  box.onclick = (e) => {
    const a = e.target.dataset && e.target.dataset.a;
    if (a === "prev") go(-1);
    else if (a === "next") go(1);
    else if (a === "play") togglePlay();
    else if (a === "close") close();
    else if (a === "full") { if (document.fullscreenElement) document.exitFullscreen(); else if (box.requestFullscreen) box.requestFullscreen(); }
    else if (a === "shuffle") { shuffle = !shuffle; e.target.classList.toggle("on", shuffle); build(); at = 0; render(); }
  };
  q("select").onchange = (e) => { secs = +e.target.value; schedule(); };
  document.addEventListener("keydown", onKey);
  build(); render();
}

// ------------------------------------------------------------- timeline page
async function initTimeline() {
  let list = await api("/api/memories");
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  let shown = [];
  function render() {
    const q = $("#tq").value.trim().toLowerCase(), cat = $("#tcat").value, fav = $("#tfav").checked;
    let rows = list.filter((m) => (!q || (m.title + " " + m.description + " " + m.place + " " + m.tags).toLowerCase().includes(q)) &&
      (!cat || m.category === cat) && (!fav || m.favorite));
    if ($("#tsort").value === "old") rows = rows.slice().reverse();
    shown = rows;
    if (!rows.length) { $("#timeline").innerHTML = '<p class="hint">' + (list.length ? "No memories match these filters." : 'No memories yet. <a href="/">Pin your first one on the map.</a>') + "</p>"; return; }
    let html = "", lastYear = "", lastMonth = "";
    rows.forEach((m) => {
      const [y, mo] = m.date.split("-");
      if (y !== lastYear) { html += '<div class="year">' + y + "</div>"; lastYear = y; lastMonth = ""; }
      if (mo + y !== lastMonth) { html += '<div class="month">' + months[+mo - 1] + "</div>"; lastMonth = mo + y; }
      html += '<div class="entry"><button class="heart" data-fav="' + m.id + '" aria-label="Toggle favourite">' + (m.favorite ? "💗" : "🤍") + "</button><h3>" +
        esc(m.title) + '</h3><div class="meta">' + formatDate(m.date) + (m.place ? " · " + esc(m.place) : "") + "</div><div>" +
        chip(m.category, CATS) + chip(m.mood, MOODS) + "</div><p>" + esc(m.description) + "</p>" + tagsHtml(m) +
        '<div class="photos">' + photosHtml(m) + "</div></div>";
    });
    $("#timeline").innerHTML = html;
    document.querySelectorAll("[data-fav]").forEach((b) => b.onclick = async () => {
      const r = await api("/api/memories/" + b.dataset.fav + "/favorite", {method: "POST"});
      list.find((m) => m.id === +b.dataset.fav).favorite = r.favorite;
      render();
    });
  }
  ["input", "change"].forEach((ev) => document.querySelector(".toolbar").addEventListener(ev, render));
  $("#tplay").onclick = () => startSlideshow(shown);
  render();
}

// -------------------------------------------------------------- journeys page
function km(a, b) {  // haversine distance between two [lat, lng] points
  const r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
}

async function initJourneys() {
  const map = makeMap();
  const layer = L.layerGroup().addTo(map);
  const memories = await api("/api/memories");
  let selected = [], journeys = [], timer = null;

  function renderPick() {
    $("#memPick").innerHTML = memories.length ? memories.map((m) => {
      const pos = selected.indexOf(m.id);
      return '<label><input type="checkbox" value="' + m.id + '"' + (pos >= 0 ? " checked" : "") + "> " +
        (pos >= 0 ? "<b>" + (pos + 1) + ".</b> " : "") + esc(m.title) + " (" + formatDate(m.date) + ")</label>";
    }).join("") : '<p class="hint">Add memories on the map first.</p>';
    document.querySelectorAll("#memPick input").forEach((cb) => cb.onchange = () => {
      const id = +cb.value;
      selected = cb.checked ? selected.concat(id) : selected.filter((x) => x !== id);
      renderPick();
    });
  }

  function distance(j) {
    let d = 0;
    for (let i = 1; i < j.memories.length; i++)
      d += km([j.memories[i - 1].latitude, j.memories[i - 1].longitude], [j.memories[i].latitude, j.memories[i].longitude]);
    return d;
  }

  async function renderJourneys() {
    journeys = await api("/api/journeys");
    $("#jList").innerHTML = journeys.length ? journeys.map((j, i) => '<div class="jitem" data-i="' + i + '"><b>' + esc(j.name) + "</b> " +
      '<span class="meta">' + j.memories.length + " stops · " + Math.round(distance(j)) + " km</span><br>" +
      '<span class="meta">' + j.memories.map((m) => esc(m.title)).join(" → ") + "</span><br>" +
      '<button data-play="' + i + '">▶ Play</button><button class="danger" data-del="' + j.id + '">Delete</button></div>').join("")
      : '<p class="hint">No journeys yet. Tick two or more memories to make one.</p>';
    document.querySelectorAll(".jitem").forEach((el) => el.onclick = (e) => {
      if (e.target.tagName !== "BUTTON") showJourney(journeys[+el.dataset.i]);
    });
    document.querySelectorAll("[data-play]").forEach((b) => b.onclick = () => play(journeys[+b.dataset.play]));
    document.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
      if (!confirm("Delete this journey? Its memories are kept.")) return;
      await api("/api/journeys/" + b.dataset.del, {method: "DELETE"});
      clearInterval(timer); layer.clearLayers(); renderJourneys(); toast("Journey deleted");
    });
  }

  function showJourney(j) {
    clearInterval(timer); layer.clearLayers();
    const pts = j.memories.map((m) => [m.latitude, m.longitude]);
    L.polyline(pts, {color: "#e0568c", weight: 4, dashArray: "8 8"}).addTo(layer);
    j.memories.forEach((m, i) => L.marker([m.latitude, m.longitude], {
      icon: L.divIcon({className: "", html: '<div class="num">' + (i + 1) + "</div>", iconSize: [26, 26]})
    }).bindPopup("<b>" + esc(m.title) + "</b><br>" + formatDate(m.date)).addTo(layer));
    map.fitBounds(pts, {padding: [60, 60]});
    return pts;
  }

  function play(j) {  // a little marker travels from stop to stop
    const pts = showJourney(j);
    const mover = L.marker(pts[0], {zIndexOffset: 1000, icon: L.divIcon({className: "", html: '<div class="mover">💖</div>', iconSize: [30, 30], iconAnchor: [15, 15]})}).addTo(layer);
    let seg = 0, step = 0;
    const N = 70;
    timer = setInterval(() => {
      const a = pts[seg], b = pts[seg + 1], t = step / N;
      mover.setLatLng([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      if (++step > N) { step = 0; if (++seg >= pts.length - 1) { clearInterval(timer); toast("Journey complete 🎀"); } }
    }, 30);
  }

  $("#jForm").onsubmit = async (e) => {
    e.preventDefault();
    $("#jMsg").textContent = "";
    try {
      await api("/api/journeys", {method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({name: e.target.name.value, description: e.target.description.value, memory_ids: selected})});
      e.target.reset(); selected = []; renderPick(); renderJourneys(); toast("Journey saved 🧳");
    } catch (err) { $("#jMsg").textContent = err.message; }
  };

  renderPick(); renderJourneys();
}

// ---------------------------------------------------------------- stats page
async function initStats() {
  const s = await api("/api/stats");
  const card = (n, label) => '<div class="stat"><b>' + n + "</b>" + label + "</div>";
  const bars = (title, rows, set) => {
    if (!rows.length) return "";
    const max = Math.max(...rows.map((r) => r.count));
    return '<div class="bars"><h2>' + title + "</h2>" + rows.map((r) => '<div class="bar"><span>' + (set ? emo(r.label, set) : "") + esc(r.label) +
      '</span><i style="width:' + (r.count / max * 55) + '%"></i><span>' + r.count + "</span></div>").join("") + "</div>";
  };
  const badges = [
    ["🌸", "First memory", s.total_memories >= 1], ["📚", "Memory keeper: 25 memories", s.total_memories >= 25],
    ["📸", "Shutterbug: 10 photos", s.total_photos >= 10], ["🗺️", "Explorer: 5 places", s.total_locations >= 5],
    ["🧳", "Journey maker", s.total_journeys >= 1], ["💗", "Heart collector: 5 favourites", s.favorites >= 5],
    ["🔥", "On a roll: 3-day streak", s.streak >= 3]
  ];
  $("#stats").innerHTML = '<div class="cards">' + card(s.total_memories, "Memories") + card(s.total_locations, "Locations") +
    card(s.total_photos, "Photographs") + card(s.total_journeys, "Journeys") + card(s.streak, "Day streak") +
    card(s.this_month, "This month") + card(s.favorites, "Favourites") + "</div>" +
    '<div class="bars"><h2>Badges</h2><div class="badges">' + badges.map((b) => '<span class="badge' + (b[2] ? "" : " locked") + '">' + b[0] + " " + b[1] + "</span>").join("") + "</div></div>" +
    bars("Memories by year", s.by_year) + bars("Memories by category", s.by_category, CATS) +
    bars("Memories by mood", s.by_mood, MOODS) + bars("Most recorded places", s.top_places);
}

// -------------------------------------------------------------------- start
document.addEventListener("click", (e) => {  // photo viewer
  const box = $("#lightbox");
  if (e.target.matches("img.zoom")) { box.querySelector("img").src = e.target.src; box.hidden = false; }
  else if (!box.hidden) box.hidden = true;
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("#lightbox").hidden = true; });

fillSelects();
document.querySelectorAll("[data-features]").forEach(buildCarousel);
const hero = document.querySelector(".hero, .landing");
if (hero) floatHearts(hero);
const page = document.body.dataset.page;
if (page === "map") initMapPage();
else if (page === "timeline") initTimeline();
else if (page === "journeys") initJourneys();
else if (page === "stats") initStats();
