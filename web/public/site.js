// Swoop Ahead's page. Everything here is an extra: with no script the page still reads in full.
document.documentElement.classList.add("js");
const $ = (sel, root = document) => root.querySelector(sel);
const part = (name) => $(`[data-part="${name}"]`);

// Parts of a section arrive as it comes into view.
const seen = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); seen.unobserve(e.target); }
}, { rootMargin: "0px 0px -8% 0px" });
document.querySelectorAll(".reveal").forEach((el) => seen.observe(el));

// On the first screen the Karoo's strip steps through one pass of a magpie.
const PASS = [
  { before: ["400 m", false], alert: ["Magpie ahead", "250 m · Northbourne Ave · last 3 Nov"], after: ["CLEAR", false], caption: "Free · no account · August to November" },
  { before: ["120 m", true], alert: ["Magpie ahead", "120 m · Northbourne Ave · last 3 Nov"], after: ["120 m", true], caption: "Inside the warn distance the Magpie field turns orange." },
  { before: ["40 m", true], alert: ["Swoop marked", "Other riders get it when there's a link"], after: ["40 m", true], caption: "Swooped somewhere new? One tap marks it for everyone." },
  { before: ["CLEAR", false], alert: null, after: ["CLEAR", false], caption: "Then it stays quiet until the next one." },
];
const stage = $(".stage");
function showPass(step) {
  if (stage.dataset.step === String(step)) return;
  stage.dataset.step = step;
  const s = PASS[step];
  for (const name of ["before", "after"]) {
    const field = part(name);
    $("strong", field).textContent = s[name][0];
    field.classList.toggle("near", s[name][1]);
  }
  const alert = part("alert");
  alert.classList.toggle("gone", !s.alert);
  if (s.alert) { $("strong", alert).textContent = s.alert[0]; $("span", alert).textContent = s.alert[1]; }
  const caption = part("caption");
  caption.style.opacity = 0;
  setTimeout(() => { caption.textContent = s.caption; caption.style.opacity = 1; }, 180);
}
// It plays while the first screen is in view, and holds still for anyone who asked for less motion.
const calm = matchMedia("(prefers-reduced-motion: reduce)");
let passStep = 0, passTimer = null;
function playPass(on) {
  clearInterval(passTimer);
  if (on && !calm.matches) passTimer = setInterval(() => { passStep = (passStep + 1) % PASS.length; showPass(passStep); }, 2800);
}
new IntersectionObserver((entries) => playPass(entries[0].isIntersecting), { threshold: 0.4 }).observe(stage);

// The Magpie field at poster size: tap it and it does what the real one does.
const big = $(".bigfield");
let back;
big.addEventListener("click", () => {
  const marked = big.getAttribute("aria-pressed") !== "true";
  clearTimeout(back);
  setBig(marked);
  if (marked) back = setTimeout(() => setBig(false), 4000);
});
function setBig(marked) {
  big.setAttribute("aria-pressed", marked);
  part("tap-big").textContent = marked ? "Marked" : "180 m";
  part("tap-small").textContent = marked ? "Other riders get it when there's a link" : "Magpie · tap to mark a swoop";
  part("tap-heading").textContent = marked ? "Swoop marked." : "Tap when it swoops.";
}

// Four stages, one slider.
const icon = '<img src="assets/magpie.svg" alt="">';
const STAGES = [
  ["First, a magpie swoops a rider.", `<img class="shot" src="assets/australian-magpie-the-bike-rider-s-nemesis.jpg" width="1920" height="1280" alt="A magpie in flight against the sky, banking towards the camera"><div class="field" data-ui>${icon}<strong>CLEAR</strong><span>Magpies · tap to mark a swoop</span></div>`],
  ["Then they tap the Magpie field.", `<div class="alert" data-ui><div><strong>Swoop marked</strong><span>Other riders get it when there's a link</span></div>${icon}<i></i></div>`],
  ["Next, the shared map has the spot.", `<div class="row"><span>Northbourne Ave</span><b>1 report · today</b></div><div class="row"><span>Stays on the map</span><b>two seasons</b></div><div class="row"><span>Shown to</span><b>every rider nearby</b></div>`],
  ["Last, your Karoo warns you.", `<div class="alert" data-ui><div><strong>Magpie ahead</strong><span>250 m · Northbourne Ave · last 3 Nov</span></div>${icon}<i></i></div><div class="field near" data-ui>${icon}<strong>250 m</strong><span>Magpie · tap to mark a swoop</span></div>`],
];
const slider = $("#stage");
function showStage(i, quick) {
  const clause = part("how-clause"), fragment = part("how-fragment");
  const swap = () => {
    clause.textContent = STAGES[i][0];
    fragment.innerHTML = STAGES[i][1];
    clause.style.opacity = fragment.style.opacity = 1;
    document.querySelectorAll(".stage-names li").forEach((li, n) => li.classList.toggle("on", n === i));
  };
  if (quick) return swap();
  clause.style.opacity = fragment.style.opacity = 0;
  setTimeout(swap, 200);
}
slider.addEventListener("input", () => showStage(Number(slider.value)));
document.querySelectorAll(".stage-names li").forEach((li, n) => li.addEventListener("click", () => { slider.value = n; showStage(n); }));
showStage(0, true);

// Questions: the first is open; hover, focus or a tap picks another.
const answer = $("#answer");
const questions = [...document.querySelectorAll("#qs button")];
function pick(button) {
  for (const q of questions) {
    q.setAttribute("aria-current", q === button);
    q.parentElement.querySelector(".inline-answer")?.remove();
  }
  answer.style.opacity = 0;
  setTimeout(() => { answer.textContent = button.dataset.a; answer.style.opacity = 1; }, 120);
  const inline = document.createElement("p");
  inline.className = "inline-answer";
  inline.textContent = button.dataset.a;
  button.parentElement.append(inline);
}
for (const q of questions) {
  q.addEventListener("click", () => pick(q));
  q.addEventListener("focus", () => pick(q));
  q.addEventListener("mouseenter", () => pick(q));
}
pick(questions[0]);

// The live map, and reporting a swoop on it. A report takes three deliberate steps (the exact
// place at street level, the day and what you were doing, then a review), so nobody sends one by
// a slip of the thumb. A new spot from this page is held until it is confirmed.
const count = part("map-count");
const note = $("#report-note");
const form = $("#report-form");
const STREET_ZOOM = 14;
const UNDO_MS = 10 * 60_000;
let map, placing = false, marker = null, place = null, humanKey = null, humanToken = "", lastSent = null, undoTimer = null;
function geo(spots) {
  return { type: "FeatureCollection", features: spots.map(([lat, lng, last, n, held]) => ({
    type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties: { last, n, held: held ? 1 : 0 } })) };
}
async function loadSpots(fresh) {
  const data = await (await fetch("/api/map" + (fresh ? "?t=" + Date.now() : ""))).json();
  humanKey = data.human_check_key;
  const waiting = data.spots.filter((s) => s[4]).length;
  const n = data.spots.length - waiting;
  const more = waiting ? ` ${waiting} more ${waiting === 1 ? "is" : "are"} waiting to be confirmed.` : "";
  count.textContent = n === 0
    ? (waiting ? `No confirmed spots yet. ${waiting} ${waiting === 1 ? "is" : "are"} waiting to be confirmed.` : "No spots yet. The first report makes the first one.")
    : `${n.toLocaleString("en-AU")} ${n === 1 ? "spot" : "spots"} reported by riders${data.season ? "." : ", waiting for August."}${more}`;
  if (data.tip_url) { const tip = $("#tip"); tip.href = data.tip_url; tip.hidden = false; }
  return data.spots;
}
async function refreshSpots() {
  const spots = await loadSpots(true).catch(() => null);
  if (spots && map && map.getSource("spots")) map.getSource("spots").setData(geo(spots));
}
async function startMap() {
  let spots = [];
  try { spots = await loadSpots(); } catch { count.textContent = "The spots could not be loaded just now."; }
  if (!window.maplibregl) return;
  map = new maplibregl.Map({ container: "themap", style: "https://tiles.openfreemap.org/styles/positron", center: [134.5, -27.5], zoom: 3.3, cooperativeGestures: true, attributionControl: { compact: true } });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }));
  map.addControl(new maplibregl.GeolocateControl({ fitBoundsOptions: { maxZoom: 15 } }));
  map.on("load", () => {
    map.addSource("spots", { type: "geojson", data: geo(spots) });
    // A confirmed spot is a solid dot. One still waiting is hollow.
    map.addLayer({ id: "spots", type: "circle", source: "spots", paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 4, 13, 10],
      "circle-color": ["case", ["==", ["get", "held"], 1], "#f3f5f1", "#fc5200"],
      "circle-stroke-color": ["case", ["==", ["get", "held"], 1], "#fc5200", "#121412"],
      "circle-stroke-width": ["case", ["==", ["get", "held"], 1], 2.5, 1.5] } });
    map.on("click", "spots", (e) => {
      if (placing) return;
      const p = e.features[0].properties;
      new maplibregl.Popup({ closeButton: false }).setLngLat(e.features[0].geometry.coordinates)
        .setText(`${p.held ? "Not confirmed yet. " : ""}${p.n} ${p.n === 1 ? "report" : "reports"}, last on ${p.last}`).addTo(map);
    });
    map.on("click", (e) => {
      if (!placing) return;
      if (map.getZoom() < STREET_ZOOM) {
        $("#rf-place-note").textContent = "Zoom in further first. The pin only drops once you can see the street.";
        return;
      }
      setPlace(e.lngLat);
    });
  });
}
function setPlace(lngLat) {
  place = lngLat;
  if (!marker) {
    marker = new maplibregl.Marker({ color: "#121412", draggable: true }).setLngLat(place).addTo(map);
    marker.on("dragend", () => { place = marker.getLngLat(); });
  } else marker.setLngLat(place);
  $("#rf-place-note").textContent = "Pin placed. Drag it if it isn't quite right.";
  $("#rf-place-next").disabled = false;
}
function show(step) {
  for (const id of ["rf-place", "rf-facts", "rf-review"]) $("#" + id).hidden = id !== step;
  placing = step === "rf-place";
  $("#themap").classList.toggle("placing", placing);
  if (marker) marker.setDraggable(placing);
}
function startReport() {
  if (!map) { note.textContent = "The map has not loaded, so there is nowhere to put the pin yet."; return; }
  note.textContent = "";
  form.hidden = false; $("#report").hidden = true;
  $("#rf-place-note").textContent = "Zoom in until you can see the street, then tap the exact spot. You can drag the pin.";
  $("#rf-place-next").disabled = true;
  const d = $("#rf-date"), today = new Date(), iso = (x) => new Date(x.getTime() - x.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  d.max = iso(today); d.min = iso(new Date(today.getTime() - 14 * 86_400_000)); d.value = "";
  show("rf-place");
  $("#themap").scrollIntoView({ block: "center", behavior: "smooth" });
}
function stopReport() {
  form.hidden = true; $("#report").hidden = false;
  placing = false; $("#themap").classList.remove("placing");
  marker?.remove(); marker = null; place = null;
  form.reset(); $("#rf-date").hidden = true; $("#rf-facts-note").textContent = "";
}
function facts() {
  const when = form.elements.when.value, activity = form.elements.activity.value;
  let day = new Date();
  if (when === "yesterday") day = new Date(Date.now() - 86_400_000);
  if (when === "date") {
    const v = $("#rf-date").value;
    if (!v) return { problem: "Pick the day it happened." };
    day = new Date(v + "T12:00:00");
    if (v > $("#rf-date").max || v < $("#rf-date").min) return { problem: "Pick a day in the last two weeks." };
  }
  if (!activity) return { problem: "Say what you were doing." };
  if (!$("#rf-true").checked) return { problem: "Tick the box to say it really happened." };
  return { day, activity };
}
const DOING = { cycling: "cycling", walking: "walking", running: "running", other: "doing something else" };
$("#report").addEventListener("click", startReport);
form.querySelector("[data-cancel]").addEventListener("click", stopReport);
form.addEventListener("submit", (e) => e.preventDefault());
form.elements.when.forEach((r) => r.addEventListener("change", () => { $("#rf-date").hidden = form.elements.when.value !== "date"; }));
$("#rf-place-next").addEventListener("click", () => { if (place) show("rf-facts"); });
$("#rf-facts-back").addEventListener("click", () => show("rf-place"));
$("#rf-review-back").addEventListener("click", () => show("rf-facts"));
$("#rf-facts-next").addEventListener("click", () => {
  const f = facts();
  $("#rf-facts-note").textContent = f.problem || "";
  if (f.problem) return;
  $("#rf-summary").textContent = `A swoop on ${f.day.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })}, while ${DOING[f.activity]}, at the pin on the map.`;
  show("rf-review");
  showHumanCheck();
});
function showHumanCheck() {
  if (!humanKey || $("#human").dataset.on) return;
  $("#human").dataset.on = "1";
  const s = document.createElement("script");
  s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  s.onload = () => turnstile.render("#human", { sitekey: humanKey, callback: (t) => { humanToken = t; } });
  document.head.append(s);
}
$("#send").addEventListener("click", async () => {
  const f = facts();
  if (!place || f.problem) return;
  const send = $("#send");
  send.disabled = true; send.textContent = "Sending";
  const uid = "web-" + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(36).slice(2));
  try {
    const res = await fetch("/api/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      source: "web", lat: place.lat, lng: place.lng, at: f.day.toISOString(), uid, activity: f.activity, confirmed: true, human: humanToken }) });
    const answer = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(
      res.status === 429 ? "That's the limit for one hour. Try again later." :
      res.status === 400 ? "That spot isn't in Australia, so it wasn't added." :
      res.status === 403 ? "The human check didn't pass. Try it again." : (answer.error || "It didn't go through."));
    note.textContent = answer.held
      ? "Reported. It shows as a hollow dot until a second report or a check by hand confirms it."
      : "Reported. It joined a spot that riders already know.";
    lastSent = { uid, cancel: answer.cancel };
    $("#undo").hidden = !answer.cancel;
    clearTimeout(undoTimer); undoTimer = setTimeout(() => { $("#undo").hidden = true; }, UNDO_MS);
    stopReport();
    refreshSpots();
  } catch (e) {
    note.textContent = e.message;
  } finally {
    send.disabled = false; send.textContent = "Send the report";
  }
});
$("#undo").addEventListener("click", async () => {
  if (!lastSent) return;
  const res = await fetch("/api/reports/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(lastSent) }).catch(() => null);
  if (res && res.ok) { note.textContent = "Report undone. It's off the map."; $("#undo").hidden = true; lastSent = null; refreshSpots(); }
  else note.textContent = res && res.status === 410 ? "It's too late to undo that one here. Open an issue on GitHub and it will be removed." : "The undo didn't go through. Try again.";
});
// Start the map when its section is near, so the first screen never waits on it.
new IntersectionObserver((entries, o) => { if (entries.some((e) => e.isIntersecting)) { o.disconnect(); startMap(); } }, { rootMargin: "600px" }).observe($("#map"));
