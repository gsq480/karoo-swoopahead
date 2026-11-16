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

// The live map, and reporting a swoop on it.
const count = part("map-count");
const note = $("#report-note");
let map, placing = false, marker = null, place = null, humanKey = null, humanToken = "";
function geo(spots) {
  return { type: "FeatureCollection", features: spots.map(([lat, lng, last, n]) => ({
    type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties: { last, n } })) };
}
async function loadSpots(fresh) {
  const data = await (await fetch("/api/map" + (fresh ? "?t=" + Date.now() : ""))).json();
  humanKey = data.human_check_key;
  const n = data.spots.length;
  count.textContent = n === 0
    ? "No spots yet. The first report makes the first one."
    : `${n.toLocaleString("en-AU")} ${n === 1 ? "spot" : "spots"} reported by riders${data.season ? "." : ", waiting for August."}`;
  if (data.tip_url) { const tip = $("#tip"); tip.href = data.tip_url; tip.hidden = false; }
  return data.spots;
}
async function startMap() {
  let spots = [];
  try { spots = await loadSpots(); } catch { count.textContent = "The spots could not be loaded just now."; }
  if (!window.maplibregl) return;
  map = new maplibregl.Map({ container: "themap", style: "https://tiles.openfreemap.org/styles/positron", center: [134.5, -27.5], zoom: 3.3, cooperativeGestures: true, attributionControl: { compact: true } });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }));
  map.on("load", () => {
    map.addSource("spots", { type: "geojson", data: geo(spots) });
    map.addLayer({ id: "spots", type: "circle", source: "spots", paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 4, 13, 10],
      "circle-color": "#fc5200", "circle-stroke-color": "#121412", "circle-stroke-width": 1.5 } });
    map.on("click", "spots", (e) => {
      if (placing) return;
      const p = e.features[0].properties;
      new maplibregl.Popup({ closeButton: false }).setLngLat(e.features[0].geometry.coordinates)
        .setText(`${p.n} ${p.n === 1 ? "report" : "reports"}, last on ${p.last}`).addTo(map);
    });
    map.on("click", (e) => {
      if (!placing) return;
      place = e.lngLat;
      marker?.remove();
      marker = new maplibregl.Marker({ color: "#121412" }).setLngLat(place).addTo(map);
      $("#confirm").hidden = false;
      $("#confirm-text").textContent = "Report a swoop at this spot, today?";
      showHumanCheck();
    });
  });
}
function showHumanCheck() {
  if (!humanKey || $("#human").dataset.on) return;
  $("#human").dataset.on = "1";
  const s = document.createElement("script");
  s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  s.onload = () => turnstile.render("#human", { sitekey: humanKey, callback: (t) => { humanToken = t; } });
  document.head.append(s);
}
function stopPlacing() {
  placing = false;
  $("#themap").classList.remove("placing");
  $("#report").textContent = "Report a swoop";
  $("#confirm").hidden = true;
  marker?.remove(); marker = null; place = null;
}
$("#report").addEventListener("click", () => {
  if (placing) return stopPlacing();
  if (!map) { note.textContent = "The map has not loaded, so there is nowhere to tap yet."; return; }
  placing = true;
  note.textContent = "";
  $("#themap").classList.add("placing");
  $("#report").textContent = "Now tap the map where it swooped";
  $("#themap").scrollIntoView({ block: "center", behavior: "smooth" });
});
$("#cancel").addEventListener("click", stopPlacing);
$("#send").addEventListener("click", async () => {
  if (!place) return;
  const send = $("#send");
  send.disabled = true; send.textContent = "Sending";
  try {
    const res = await fetch("/api/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      source: "web", lat: place.lat, lng: place.lng, at: new Date().toISOString(),
      uid: "web-" + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(36).slice(2)), human: humanToken }) });
    const answer = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(
      res.status === 429 ? "That's the limit for one hour. Try again later." :
      res.status === 400 ? "That spot isn't in Australia, so it wasn't added." :
      res.status === 403 ? "The human check didn't pass. Try it again." : (answer.error || "It didn't go through."));
    note.textContent = answer.created ? "Reported. That's a new spot on the map." : "Reported. It joined a spot that was already there.";
    stopPlacing();
    const spots = await loadSpots(true).catch(() => null);
    if (spots && map.getSource("spots")) map.getSource("spots").setData(geo(spots));
  } catch (e) {
    note.textContent = e.message;
  } finally {
    send.disabled = false; send.textContent = "Send the report";
  }
});
// Start the map when its section is near, so the first screen never waits on it.
new IntersectionObserver((entries, o) => { if (entries.some((e) => e.isIntersecting)) { o.disconnect(); startMap(); } }, { rootMargin: "600px" }).observe($("#map"));
