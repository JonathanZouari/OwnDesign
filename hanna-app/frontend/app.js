"use strict";
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const app = $("#app");
const S = { token: localStorage.token || null, me: null, slug: null, brand: null, cat: null, tab: "plan", project: null, plan: null, brief: {}, tool: "select", sel: null, undo: [], guest: false };
const emptyPlan = () => ({ rooms: [], walls: [], openings: [], furniture: [], materials: { floor: "oak", wall: "white", accent: "terracotta" } });
const uid = () => Math.random().toString(36).slice(2, 10);
const human = s => { s = String(s || "").replace(/_/g, " "); return s.charAt(0).toUpperCase() + s.slice(1); };
function fitView() {
  const P = S.plan, xs = [], ys = [];
  P.rooms.forEach(r => { xs.push(r.x, r.x + r.w); ys.push(r.y, r.y + r.h); });
  P.furniture.forEach(f => { xs.push(f.x, f.x + f.w); ys.push(f.y, f.y + f.d); });
  P.walls.forEach(w => { xs.push(w.x1, w.x2); ys.push(w.y1, w.y2); });
  if (!xs.length) return (S.vb = [-100, -100, 1200, 720]);
  const x = Math.min(...xs) - 100, y = Math.min(...ys) - 100;
  return S.vb = [x, y, Math.max(Math.max(...xs) + 100 - x, 1000), Math.max(Math.max(...ys) + 100 - y, 620)];
}
const snap = v => Math.round(v / 10) * 10;

function toast(m) { const t = $("#toast"); t.textContent = m; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 3500); }
async function api(method, path, body) {
  const r = await fetch("/api" + path, { method, headers: { "Content-Type": "application/json", ...(S.token ? { Authorization: "Bearer " + S.token } : {}) }, body: method === "GET" ? undefined : JSON.stringify(body || {}) });
  const ct = r.headers.get("Content-Type") || "";
  const data = ct.includes("json") ? await r.json() : await r.text();
  if (!r.ok) { if (r.status === 401 && S.token) logout(); throw new Error(data.error || "Request failed"); }
  return data;
}
const run = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message); } };

function brand(b) {
  S.brand = b; const st = document.documentElement.style;
  st.setProperty("--c1", b?.color_primary || "#2f3e46"); st.setProperty("--c2", b?.color_accent || "#1f6feb"); st.setProperty("--font", b?.font || "Georgia");
  document.title = b?.name || "Interior Design Studio";
}
function logout() { localStorage.removeItem("token"); S.token = S.me = S.project = null; boot(); }

/* ---------- boot / auth ---------- */
async function boot() {
  const m = location.pathname.match(/^\/s\/([a-z0-9-]+)/);
  S.slug = m ? m[1] : null;
  S.cat = S.cat || await api("GET", "/catalog");
  if (S.token) {
    try { S.me = await api("GET", "/me"); } catch { S.token = null; }
  }
  if (S.me) { brand(S.me.studios[0]); return showApp(); }
  if (S.slug) { try { brand(await api("GET", "/studios/" + S.slug)); } catch { toast("Studio not found"); } } else brand(null);
  S.guest ? showGuest() : showAuth();
}
function showAuth(mode = "login") {
  const invite = new URLSearchParams(location.search).get("invite");
  const reg = mode === "register";
  app.innerHTML = `<div class="card auth"><h1>${esc(S.brand?.name || "Interior Design Studio")}</h1>
    ${S.brand?.logo_url ? `<img src="${esc(S.brand.logo_url)}" height="48" alt="">` : ""}
    <form id="f"><label>Email</label><input name="email" type="email" required>
    ${reg ? `<label>Name</label><input name="name">` : ""}
    <label>Password (8+ characters)</label><input name="password" type="password" minlength="8" required>
    ${reg && !S.slug && !invite ? `<label>Studio name (creates a designer studio, 14-day trial)</label><input name="studio_name" required>` : ""}
    <p class="row"><button>${reg ? "Create account" : "Log in"}</button>
    <button type="button" class="ghost" id="sw">${reg ? "I have an account" : "Register"}</button></p></form>
    ${S.slug ? `<button class="ghost" id="guest">Try it as a guest (saving requires registration)</button>` : ""}</div>`;
  $("#sw").onclick = () => showAuth(reg ? "login" : "register");
  if ($("#guest")) $("#guest").onclick = () => { S.guest = true; showGuest(); };
  $("#f").onsubmit = run(async e => {
    e.preventDefault(); const b = Object.fromEntries(new FormData(e.target));
    if (reg) { b.studio_slug = S.slug; b.invite = invite; }
    const r = await api("POST", reg ? "/register" : "/login", b);
    S.token = localStorage.token = r.token; S.me = await api("GET", "/me");
    if (S.guest && S.plan?.rooms?.length) { // import the guest trial into the new account
      const p = await api("POST", "/projects", { name: "My home", plan: S.plan }); await api("PUT", `/projects/${p.id}/brief`, S.brief);
      S.guest = false; localStorage.removeItem("guest"); brand(S.me.studios[0]); return openProject(p.id);
    }
    brand(S.me.studios[0]); showApp();
  });
}

/* ---------- guest trial ---------- */
function showGuest() {
  const g = JSON.parse(localStorage.guest || "null");
  S.plan = g?.plan || emptyPlan(); S.brief = g?.brief || {}; S.project = { id: null, name: "Guest trial" }; S.tab = "plan"; S.undo = [];
  shell();
}

/* ---------- app shell ---------- */
async function showApp() {
  S.guest = false; S.project = null; const st = S.me.studios[0];
  const projects = await api("GET", "/projects");
  const staff = st.role !== "client";
  app.innerHTML = `${header()}<main><div class="row"><h2 class="grow">Projects</h2><button id="new">New project</button>
    ${staff ? `<button class="ghost" id="brand">Branding</button><button class="ghost" id="inv">Invite client</button>` : ""}</div>
    <div class="grid">${projects.map(p => `<div class="card"><h3>${esc(p.name)}</h3><span class="tag">${esc(human(p.status))}</span>
      <p><button data-id="${p.id}">Open</button></p></div>`).join("") || "<p>No projects yet.</p>"}</div>
    <div class="card">Public studio link: <code>${location.origin}/s/${esc(st.slug)}</code></div><div id="extra"></div></main>`;
  $("#new").onclick = run(async () => {
    const name = prompt("Project name", "My home"); if (!name) return;
    const kind = confirm("OK = renovation of an existing home\nCancel = new-build apartment") ? "renovation" : "new_build";
    openProject((await api("POST", "/projects", { name, kind })).id);
  });
  app.querySelectorAll("[data-id]").forEach(b => b.onclick = () => openProject(b.dataset.id));
  if ($("#inv")) $("#inv").onclick = run(async () => {
    const email = prompt("Client email (optional label)", ""); if (email === null) return;
    const r = await api("POST", "/invites", { email });
    $("#extra").innerHTML = `<div class="card">Invitation link:<br><code>${location.origin}/s/${esc(st.slug)}?invite=${esc(r.token)}</code></div>`;
  });
  if ($("#brand")) $("#brand").onclick = () => brandingForm(st);
  logoutBtn();
}
function header() {
  const st = S.me?.studios[0];
  return `<header>${S.brand?.logo_url ? `<img src="${esc(S.brand.logo_url)}" alt="">` : ""}<b>${esc(S.brand?.name || "Interior Design")}</b>
    ${st ? `<span class="pill">${esc(st.role)}</span><span class="pill">${st.credits} AI credits</span>${st.plan === "trial" ? `<span class="pill">Trial ends ${esc(st.trial_ends.slice(0, 10))}</span>` : ""}` : ""}
    <button id="home">Projects</button><button id="out">${S.me ? "Log out" : "Register to save"}</button></header>`;
}
function logoutBtn() {
  $("#out").onclick = () => S.me ? logout() : showAuth("register");
  $("#home").onclick = () => S.me ? showApp() : showGuest();
}
function brandingForm(st) {
  const b = S.brand;
  $("#extra").innerHTML = `<form class="card" id="bf"><h3>Studio branding</h3>
    <label>Name</label><input name="name" value="${esc(b.name)}"><label>Logo URL</label><input name="logo_url" value="${esc(b.logo_url)}">
    <label>Primary colour</label><input name="color_primary" type="color" value="${esc(b.color_primary)}">
    <label>Accent colour</label><input name="color_accent" type="color" value="${esc(b.color_accent)}">
    <label>Font</label><select name="font">${["Georgia", "Helvetica", "Trebuchet MS", "Courier New"].map(f => `<option ${f === b.font ? "selected" : ""}>${f}</option>`).join("")}</select>
    <label>Dossier template</label><select name="template"><option>classic</option><option ${b.template === "modern" ? "selected" : ""}>modern</option></select>
    <p><button>Save branding</button></p></form>`;
  $("#bf").onsubmit = run(async e => { e.preventDefault(); await api("PUT", "/studio", Object.fromEntries(new FormData(e.target))); S.me = await api("GET", "/me"); brand(S.me.studios[0]); toast("Branding saved"); showApp(); });
}

/* ---------- project ---------- */
async function openProject(id) {
  const p = await api("GET", "/projects/" + id);
  S.project = p; S.plan = p.version?.data || emptyPlan(); S.brief = p.brief || {}; S.undo = []; S.sel = null; S.tab = "plan"; shell();
}
const TABS = { plan: "2D Plan", brief: "Brief", design: "Design", ai: "AI Advisor", renders: "Renders", budget: "Budget", team: "Collaboration", versions: "Versions", dossier: "Dossier" };
function shell() {
  const tabs = S.guest ? ["plan", "brief", "design"] : Object.keys(TABS);
  app.innerHTML = `${header()}<nav>${tabs.map(t => `<button data-t="${t}" class="${t === S.tab ? "on" : ""}">${TABS[t]}</button>`).join("")}</nav>
    <main><h2>${esc(S.project.name)} ${S.project.status ? `<span class="tag">${esc(human(S.project.status))}</span>` : ""}</h2><div id="tab"></div></main>`;
  app.querySelectorAll("nav button").forEach(b => b.onclick = () => { S.tab = b.dataset.t; shell(); });
  logoutBtn(); run(TAB[S.tab])();
}
async function persistBrief() { if (S.guest) saveGuest(); else await api("PUT", `/projects/${S.project.id}/brief`, S.brief); }
function saveGuest() { localStorage.guest = JSON.stringify({ plan: S.plan, brief: S.brief }); }

const TAB = {};
/* ---- plan editor ---- */
TAB.plan = () => {
  const cat = S.cat;
  const groups = [...new Set(cat.furniture.map(f => f.group))];
  $("#tab").innerHTML = `<div class="card toolbar"><div class="row">
    ${["select", "room", "wall", "door", "window"].map(t => `<button class="ghost ${S.tool === t ? "on" : ""}" data-tool="${t}">${{ select: "Select", room: "Room", wall: "Partition", door: "Door", window: "Window" }[t]}</button>`).join("")}
    <button class="ghost" id="undo">Undo</button><button class="ghost" id="wiz">Room wizard</button>
    <span class="grow"></span><input id="note" placeholder="Version note" style="width:12rem"><button id="save">${S.guest ? "Register to save" : "Save version"}</button></div>
    <div id="flags"></div></div>
    <div class="editor"><div class="pal card">${groups.map(g => `<b>${g}</b>${cat.furniture.filter(f => f.group === g).map(f => `<button data-f="${f.id}">${esc(f.name)}</button>`).join("")}`).join("")}</div>
    <svg id="canvas" viewBox="${(S.vb = fitView() || S.vb).join(" ")}"></svg><div class="card" id="props"><small>Select an object. Tools: room/partition = drag; door/window = click.</small></div></div>
    <p><small>Conceptual planning only. Changes to walls, openings and wet areas need assessment by a qualified professional.</small></p>`;
  app.querySelectorAll("[data-tool]").forEach(b => b.onclick = () => { S.tool = b.dataset.tool; TAB.plan(); });
  app.querySelectorAll("[data-f]").forEach(b => b.onclick = () => addFurniture(b.dataset.f));
  $("#undo").onclick = () => { const p = S.undo.pop(); if (p) { S.plan = JSON.parse(p); S.sel = null; draw(); } };
  $("#wiz").onclick = wizard;
  $("#save").onclick = run(async () => {
    if (S.guest) { saveGuest(); return showAuth("register"); }
    const v = await api("POST", `/projects/${S.project.id}/versions`, { data: S.plan, note: $("#note").value });
    S.project.version = v; $("#note").value = "";
    $("#flags").innerHTML = v.needs_review ? `<div class="warn"><b>Professional review required:</b> ${v.review_reasons.map(esc).join("; ")}.</div>` : "";
    toast("Saved as version " + v.n);
  });
  if (S.project.version?.needs_review) $("#flags").innerHTML = `<div class="warn"><b>Professional review required:</b> ${S.project.version.review_reasons.map(esc).join("; ")}.</div>`;
  bindCanvas(); draw();
};
const push = () => { S.undo.push(JSON.stringify(S.plan)); if (S.undo.length > 50) S.undo.shift(); if (S.guest) saveGuest(); };
function addFurniture(ref) {
  const it = S.cat.furniture.find(f => f.id === ref); push();
  S.plan.furniture.push({ id: uid(), ref, x: 100, y: 100, w: it.w, d: it.d, rot: 0 }); S.sel = S.plan.furniture.at(-1).id; draw();
}
function wizard() {
  const rows = prompt("Rooms as 'name,width m,depth m' separated by ; \nExample: Living room,5,4; Kitchen,3,3; Bedroom,4,3.5", "Living room,5,4; Kitchen,3,3; Bedroom,4,3.5");
  if (!rows) return; push();
  let x = 0, y = 0, rowH = 0;
  for (const r of rows.split(";")) {
    const [name, w, h] = r.split(",").map(s => s.trim()), W = parseFloat(w) * 100, H = parseFloat(h) * 100;
    if (!name || !(W > 0) || !(H > 0)) { toast("Skipped invalid row: " + r); continue; }
    if (x + W > 1200) { x = 0; y += rowH; rowH = 0; }
    S.plan.rooms.push({ id: uid(), name, x, y, w: W, h: H }); x += W; rowH = Math.max(rowH, H);
  }
  draw();
}
let drag = null;
function pt(e) { const c = $("#canvas"), p = c.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; const q = p.matrixTransform(c.getScreenCTM().inverse()); return { x: snap(q.x), y: snap(q.y) }; }
function bindCanvas() {
  const c = $("#canvas");
  c.onpointerdown = e => {
    const p = pt(e), id = e.target.closest("[data-id]")?.dataset.id, t = S.tool;
    if (t === "door" || t === "window") { push(); S.plan.openings.push({ id: uid(), type: t, x: p.x, y: p.y, w: t === "door" ? 90 : 120, vertical: false }); S.tool = "select"; return TAB.plan(); }
    if (t === "room" || t === "wall") { drag = { kind: t, a: p, b: p }; c.setPointerCapture(e.pointerId); return draw(); }
    S.sel = id || null;
    const o = id && find(id);
    if (o) { push(); drag = { kind: "move", o, dx: p.x - (o.x ?? o.x1), dy: p.y - (o.y ?? o.y1) }; c.setPointerCapture(e.pointerId); }
    draw();
  };
  c.onpointermove = e => {
    if (!drag) return; const p = pt(e);
    if (drag.kind === "move") { const o = drag.o; if (o.x1 !== undefined) { const w = o.x2 - o.x1, h = o.y2 - o.y1; o.x1 = p.x - drag.dx; o.y1 = p.y - drag.dy; o.x2 = o.x1 + w; o.y2 = o.y1 + h; } else { o.x = p.x - drag.dx; o.y = p.y - drag.dy; } }
    else drag.b = p; draw();
  };
  c.onpointerup = () => {
    if (!drag) return;
    const { kind, a, b } = drag; drag = null;
    if (kind === "room" && Math.abs(b.x - a.x) >= 50 && Math.abs(b.y - a.y) >= 50) { push(); const n = S.plan.rooms.length + 1; S.plan.rooms.push({ id: uid(), name: "Room " + n, x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }); S.tool = "select"; TAB.plan(); }
    else if (kind === "wall" && (a.x !== b.x || a.y !== b.y)) { push(); S.plan.walls.push({ id: uid(), x1: a.x, y1: a.y, x2: b.x, y2: b.y, proposed: true }); S.tool = "select"; TAB.plan(); }
    else if (kind === "move") { if (S.guest) saveGuest(); props(); }
    draw();
  };
}
const find = id => ["rooms", "walls", "openings", "furniture"].flatMap(k => S.plan[k]).find(o => o.id === id);
function draw() {
  const c = $("#canvas"); if (!c) return; const P = S.plan, cat = S.cat;
  let g = "";
  g += P.rooms.map(r => `<g data-id="${r.id}"><rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${S.sel === r.id ? "#f3ead8" : "#faf6ee"}" stroke="#444" stroke-width="10"/>
    <text x="${r.x + 12}" y="${r.y + 32}" font-size="26" fill="#555">${esc(r.name)} · ${(r.w * r.h / 1e4).toFixed(1)} m²</text></g>`).join("");
  g += P.walls.map(w => `<line data-id="${w.id}" x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}" stroke="${S.sel === w.id ? "#1f6feb" : "#c0392b"}" stroke-width="14" stroke-dasharray="${w.proposed ? "24 10" : ""}"/>`).join("");
  g += P.openings.map(o => { const l = o.vertical ? [o.x, o.y - o.w / 2, o.x, o.y + o.w / 2] : [o.x - o.w / 2, o.y, o.x + o.w / 2, o.y]; return `<line data-id="${o.id}" x1="${l[0]}" y1="${l[1]}" x2="${l[2]}" y2="${l[3]}" stroke="${o.type === "door" ? "#8b6b4a" : "#4aa3d0"}" stroke-width="${S.sel === o.id ? 22 : 16}"/>`; }).join("");
  g += P.furniture.map(f => { const it = cat.furniture.find(x => x.id === f.ref); return `<g data-id="${f.id}" transform="rotate(${f.rot || 0} ${f.x + f.w / 2} ${f.y + f.d / 2})"><rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.d}" fill="${f.existing ? "#cfd8cf" : "#d9cdb8"}" stroke="${S.sel === f.id ? "#1f6feb" : "#777"}" stroke-width="${S.sel === f.id ? 8 : 3}"/><text x="${f.x + 6}" y="${f.y + 24}" font-size="20" fill="#333">${esc(it?.name || "")}</text></g>`; }).join("");
  if (drag && drag.kind !== "move") { const { a, b } = drag; g += drag.kind === "room" ? `<rect x="${Math.min(a.x, b.x)}" y="${Math.min(a.y, b.y)}" width="${Math.abs(b.x - a.x)}" height="${Math.abs(b.y - a.y)}" fill="none" stroke="#1f6feb" stroke-width="6" stroke-dasharray="20 10"/>` : `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#1f6feb" stroke-width="10"/>`; }
  c.innerHTML = g; props();
}
function props() {
  const el = $("#props"); if (!el) return; const o = S.sel && find(S.sel);
  if (!o) { el.innerHTML = "<small>Select an object. Tools: room/partition = drag; door/window = click.</small>"; return; }
  const num = (k, l) => o[k] === undefined ? "" : `<label>${l}</label><input type="number" data-k="${k}" value="${Math.round(o[k])}">`;
  el.innerHTML = `${o.name !== undefined ? `<label>Name</label><input data-k="name" value="${esc(o.name)}">` : ""}
    ${num("x", "X cm")}${num("y", "Y cm")}${num("w", "Width cm")}${num("h", "Depth cm")}${num("d", "Depth cm")}${num("rot", "Rotation °")}
    ${o.ref ? `<label><input type="checkbox" data-k="existing" ${o.existing ? "checked" : ""} style="width:auto"> Already owned</label>` : ""}
    ${o.type ? `<label><input type="checkbox" data-k="vertical" ${o.vertical ? "checked" : ""} style="width:auto"> Vertical</label>` : ""}
    <p class="row">${o.ref ? `<button class="ghost" id="rot">Rotate 90°</button>` : ""}<button class="ghost" id="del">Delete</button></p>`;
  el.querySelectorAll("[data-k]").forEach(i => i.onchange = () => { push(); const k = i.dataset.k; o[k] = i.type === "checkbox" ? i.checked : i.type === "number" ? Math.max(k === "rot" || k === "x" || k === "y" ? -99999 : 10, +i.value || 0) : i.value; draw(); });
  if ($("#rot")) $("#rot").onclick = () => { push(); o.rot = ((o.rot || 0) + 90) % 360; draw(); };
  $("#del").onclick = () => { push(); for (const k of ["rooms", "walls", "openings", "furniture"]) S.plan[k] = S.plan[k].filter(x => x.id !== o.id); S.sel = null; draw(); };
}

/* ---- brief ---- */
const BRIEF = [["style", "Preferred style", "style"], ["colors", "Colours & materials you like", "text"], ["budget", "Budget (EUR)", "number"], ["needs", "Functional needs (e.g. home office, storage)", "text"],
  ["household", "Household & lifestyle (people, pets, habits)", "text"], ["constraints", "Constraints (structural, rental rules, deadlines)", "text"], ["inspiration", "Inspiration (links or notes)", "text"], ["existing", "Existing furniture to keep", "text"]];
TAB.brief = () => {
  const val = k => esc(S.brief[k] || "");
  const field = ([k, l, t]) => `<label>${l}</label>` + (t === "style"
    ? `<select name="${k}"><option value="">—</option>${S.cat.styles.map(s => `<option ${S.brief[k] === s ? "selected" : ""}>${s}</option>`).join("")}</select>`
    : t === "number" ? `<input type="number" name="${k}" value="${val(k)}">` : `<textarea rows="2" name="${k}">${val(k)}</textarea>`);
  $("#tab").innerHTML = `<form class="card" id="bf">${BRIEF.map(field).join("")}<p><button>Save brief</button></p></form>`;
  $("#bf").onsubmit = run(async e => { e.preventDefault(); S.brief = Object.fromEntries(new FormData(e.target)); await persistBrief(); toast("Brief saved"); });
};

/* ---- design: materials, moodboard ---- */
TAB.design = () => {
  const M = S.plan.materials ||= {};
  const sw = kind => `<h3>${{ floor: "Floor", wall: "Walls", accent: "Accent / furniture tone" }[kind]}</h3>` + S.cat.materials.filter(m => m.kind === kind).map(m => `<span class="sw ${M[kind] === m.id ? "on" : ""}" data-k="${kind}" data-m="${m.id}" title="${esc(m.name)}${m.price ? " · ~€" + m.price + "/m²" : ""}" style="background:${m.color}"></span>`).join("");
  $("#tab").innerHTML = `<div class="card">${sw("floor")}${sw("wall")}${sw("accent")}<p><small>Selections are saved with the plan version. Prices are generic estimates.</small></p></div>
    <div class="card"><h3>Moodboard</h3><div class="row">${["floor", "wall", "accent"].map(k => { const m = S.cat.materials.find(x => x.id === M[k]); return m ? `<div style="background:${m.color};width:120px;height:90px;border-radius:8px;padding:6px;font-size:.8rem">${esc(m.name)}</div>` : ""; }).join("")}
    <div style="width:240px"><b>${esc(S.brief.style || "No style chosen")}</b><br>${esc(S.brief.inspiration || "")}</div></div></div>`;
  app.querySelectorAll(".sw").forEach(s => s.onclick = () => { push(); M[s.dataset.k] = s.dataset.m; TAB.design(); });
  if (!S.guest) $("#tab").insertAdjacentHTML("beforeend", `<p><button id="sv">Save as new version</button></p>`), $("#sv").onclick = run(async () => { S.project.version = await api("POST", `/projects/${S.project.id}/versions`, { data: S.plan, note: "Design update" }); toast("Saved version " + S.project.version.n); });
};

/* ---- AI ---- */
TAB.ai = async () => {
  const hist = await api("GET", `/projects/${S.project.id}/ai`);
  $("#tab").innerHTML = `<div class="card"><p><small>The advisor suggests only; it never changes your plan. Open-source / built-in model.</small></p><div class="chat" id="chat">${hist.map(m => `<div class="msg ${m.role}">${esc(m.content)}</div>`).join("")}</div>
    <form class="row" id="cf"><input class="grow" name="message" placeholder="Ask about layout, colours, furniture, budget…" required><button>Send (1 credit)</button></form></div>`;
  const ch = $("#chat"); ch.scrollTop = ch.scrollHeight;
  $("#cf").onsubmit = run(async e => {
    e.preventDefault(); const m = e.target.message.value; e.target.message.value = "";
    ch.insertAdjacentHTML("beforeend", `<div class="msg user">${esc(m)}</div>`);
    const r = await api("POST", `/projects/${S.project.id}/ai`, { message: m });
    ch.insertAdjacentHTML("beforeend", `<div class="msg assistant">${esc(r.reply)}</div>`); ch.scrollTop = ch.scrollHeight;
  });
};

/* ---- renders ---- */
const VP = { plan: "Top plan", iso_ne: "Corner NE", iso_se: "Corner SE", iso_sw: "Corner SW", iso_nw: "Corner NW" };
TAB.renders = async () => {
  const [jobs, vers] = await Promise.all([api("GET", `/projects/${S.project.id}/renders`), api("GET", `/projects/${S.project.id}/versions`)]);
  $("#tab").innerHTML = `<div class="card"><form class="row" id="rf"><select name="version_id">${vers.map(v => `<option value="${v.id}">Version ${v.n}${v.note ? " – " + esc(v.note) : ""}</option>`).join("")}</select>
    <select name="viewpoint">${Object.entries(VP).map(([k, v]) => `<option value="${k}" ${k === "iso_se" ? "selected" : ""}>${v}</option>`).join("")}</select><button ${vers.length ? "" : "disabled"}>Render (5 credits)</button></form>
    <p class="warn">Renders are illustrative and not dimensionally accurate. The 2D plan is the source of truth. ${vers.length ? "" : "Save a plan version first."}</p></div>
    <div class="grid rimg">${jobs.map(j => `<div class="card" data-j="${j.id}"><b>v${j.version_n} · ${VP[j.viewpoint]}</b> <span class="tag">${human(j.status)}</span> ${esc(j.error || "")}<div class="im"></div></div>`).join("")}</div>`;
  $("#rf").onsubmit = run(async e => { e.preventDefault(); await api("POST", `/projects/${S.project.id}/renders`, Object.fromEntries(new FormData(e.target))); TAB.renders(); });
  for (const j of jobs) if (j.status === "done") fetchBlob(`/projects/${S.project.id}/renders/${j.id}/image`, "image/svg+xml").then(u => $(`[data-j="${j.id}"] .im`).innerHTML = `<img src="${u}" alt="render">`);
  if (jobs.some(j => j.status === "running")) setTimeout(() => S.tab === "renders" && TAB.renders(), 1500);
};
async function fetchBlob(path, type) { const r = await fetch("/api" + path, { headers: { Authorization: "Bearer " + S.token } }); return URL.createObjectURL(new Blob([await r.text()], { type })); }

/* ---- budget ---- */
TAB.budget = async () => {
  const b = await api("GET", `/projects/${S.project.id}/budget`);
  $("#tab").innerHTML = `<div class="card"><table><tr><th>Item<th>Group<th>Qty<th>Unit €<th>Total €</tr>${b.lines.map(l => `<tr><td>${esc(l.item)}<td>${l.group}<td>${l.qty} ${l.unit}<td>${l.unit_price}<td>${l.total}</tr>`).join("")}
    <tr><th colspan="4">Estimated total<th>€${b.total}</tr></table><p class="warn"><b>Estimate only.</b> ${esc(b.note)}</p>
    ${S.brief.budget ? `<p>Your budget: €${esc(S.brief.budget)} — ${b.total > +S.brief.budget ? "estimate exceeds budget" : "within budget"}</p>` : ""}</div>`;
};

/* ---- collaboration ---- */
TAB.team = async () => {
  const id = S.project.id, [posts, tasks, dec] = await Promise.all([api("GET", `/projects/${id}/posts`), api("GET", `/projects/${id}/tasks`), api("GET", `/projects/${id}/decisions`)]);
  const staff = S.project.staff;
  $("#tab").innerHTML = `<div class="grid"><div class="card"><h3>Messages & comments</h3>${posts.map(p => `<div class="msg ${p.kind === "comment" ? "assistant" : "user"}"><small>${esc(p.author)} · ${esc(p.kind)} · ${esc(p.created.slice(0, 16))}</small><br>${esc(p.body)}</div>`).join("")}
    <form id="pf"><textarea name="body" rows="2" required></textarea><div class="row"><select name="kind"><option value="message">Message</option><option value="comment">Plan comment</option></select><button>Post</button></div></form></div>
    <div class="card"><h3>Tasks</h3>${tasks.map(t => `<label><input type="checkbox" style="width:auto" data-t="${t.id}" ${t.done ? "checked" : ""}> ${esc(t.title)}</label>`).join("") || "<p>None</p>"}
    ${staff ? `<form id="tf" class="row"><input name="title" placeholder="New client task" required><button>Assign</button></form>` : ""}</div>
    <div class="card"><h3>Review decisions</h3>${dec.map(d => `<p><span class="tag">${esc(human(d.decision))}</span> ${esc(d.note || "")}<br><small>${esc(d.created.slice(0, 16))}</small></p>`).join("") || "<p>None yet</p>"}
    ${staff ? `<form id="df"><select name="decision"><option value="approved">Approve design</option><option value="changes_requested">Request changes</option><option value="professional_review_required">Professional review required</option></select><input name="note" placeholder="Note"><p><button>Record</button></p></form>` : `<button id="sub">Submit dossier to designer</button>`}</div></div>
    ${staff ? `<div class="card"><h3>Audit log</h3><div id="aud"></div></div>` : ""}`;
  const post = (path, form, m = "POST") => run(async e => { e.preventDefault(); await api(m, `/projects/${id}/${path}`, Object.fromEntries(new FormData(e.target))); TAB.team(); });
  $("#pf").onsubmit = post("posts");
  if ($("#tf")) $("#tf").onsubmit = post("tasks");
  if ($("#df")) $("#df").onsubmit = post("decisions");
  if ($("#sub")) $("#sub").onclick = run(async () => { await api("POST", `/projects/${id}/submit`); toast("Submitted"); });
  app.querySelectorAll("[data-t]").forEach(c => c.onchange = run(() => api("PUT", `/projects/${id}/tasks/${c.dataset.t}`, { done: c.checked })));
  if (staff) api("GET", `/projects/${id}/audit`).then(a => $("#aud").innerHTML = `<table>${a.map(x => `<tr><td>${esc(x.created.slice(0, 16))}<td>${esc(x.action)}<td>${esc(x.detail)}</tr>`).join("")}</table>`);
};

/* ---- versions ---- */
TAB.versions = async () => {
  const vs = await api("GET", `/projects/${S.project.id}/versions`);
  $("#tab").innerHTML = `<div class="card"><table>${vs.map(v => `<tr><td>v${v.n}<td>${esc(v.note)}<td>${esc(v.created.slice(0, 16))}<td>${v.needs_review ? `<span class="tag">review: ${esc(v.review_reasons.join(", "))}</span>` : ""}<td><button class="ghost" data-v="${v.id}">Restore as draft</button></tr>`).join("")}</table>
    <small>Restoring loads the old version into the editor; saving it creates a new version, so history is never overwritten.</small></div>`;
  app.querySelectorAll("[data-v]").forEach(b => b.onclick = run(async () => { const v = await api("GET", `/projects/${S.project.id}/versions/${b.dataset.v}`); S.plan = v.data; S.undo = []; S.tab = "plan"; shell(); toast("Loaded v" + v.n + " – save to keep it as a new version"); }));
};

/* ---- dossier ---- */
TAB.dossier = async () => {
  const html = await api("GET", `/projects/${S.project.id}/dossier`);
  $("#tab").innerHTML = `<p class="row"><button id="dl">Download HTML</button><button class="ghost" id="pr">Print / PDF</button></p><iframe sandbox="allow-modals" id="fr"></iframe>`;
  $("#fr").srcdoc = html;
  $("#dl").onclick = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([html], { type: "text/html" })); a.download = "dossier.html"; a.click(); };
  $("#pr").onclick = () => $("#fr").contentWindow.print();
};

boot().catch(e => { app.textContent = "Cannot reach the server: " + e.message; });
