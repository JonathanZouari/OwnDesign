import { api, requireSession, signOut } from "../api.js";
import { COMMON, PROJECT_TYPES, ROLES, STUDIO } from "../strings.js";
import { isPlan, planArea } from "../plan.js";
import { KEYS, save } from "../store.js";
import { activityText, matchesProject, studioMetrics } from "../studio-data.js";
import { planThumbnail } from "../thumbnail.js";
import { $, action, copyText, formatDate, h, pageUrl, run, showStudio } from "../ui.js";

const UNKNOWN = "—";

const icon = (name) => h("span", { class: "icon", "aria-hidden": "true" }, name);
const inviteUrl = (invite) => pageUrl(`entry.html?invite=${invite.token}`);

function showInvites(invites) {
  $("#no-invites").hidden = invites.length > 0;
  $("#invites").replaceChildren(
    ...invites.map((invite) =>
      h(
        "tr",
        {},
        h("td", {}, h("span", { class: "who" }, invite.client_name), h("span", { class: "code" }, invite.client_email)),
        h("td", {}, h("span", { class: `chip ${invite.accepted_at ? "ok" : ""}` }, invite.accepted_at ? STUDIO.accepted : STUDIO.pending)),
        h("td", {}, h("button", { type: "button", onclick: () => copyText(inviteUrl(invite)) }, COMMON.copyLink)),
      ),
    ),
  );
}

function showMetrics(projects, invites) {
  const totals = studioMetrics(projects, invites);
  const show = (metric, value) => ($(`[data-metric="${metric}"]`).textContent = value);
  show("projects", totals.projects);
  show("clients", totals.clients);
  show("pending-invites", totals.pendingInvites);
  show("new-this-month", totals.thisMonth);
}

// "thumb empty" is a project with no saved version; "thumb pending" is a preview not loaded (yet, or at all).
const thumbPlaceholder = (state, text) => h("div", { class: `thumb ${state}` }, icon("architecture"), text && h("span", { class: "code" }, text));

const fact = (label, cls) => h("div", {}, h("dt", {}, label), h("dd", { class: cls }, UNKNOWN));

function projectCard(project) {
  const titleId = `project-${project.id}`;
  return h(
    "article",
    { class: "card project", "aria-labelledby": titleId },
    thumbPlaceholder("pending"),
    h(
      "div",
      { class: "project-body" },
      h(
        "div",
        { class: "project-meta" },
        h("span", { class: "chip" }, PROJECT_TYPES[project.property_type] ?? project.property_type),
        h("span", { class: "code" }, STUDIO.created(formatDate(project.created_at))),
      ),
      h("h3", { id: titleId }, project.name),
      h("p", { class: "client" }, icon("person"), h("span", {}, project.client_email ?? STUDIO.noClientEmail)),
      h("dl", { class: "facts" }, fact(STUDIO.floorArea, "fact-area"), fact(STUDIO.latestVersion, "fact-version")),
      h("div", {}, h("a", { class: "button primary", href: `editor.html?project=${project.id}` }, icon("architecture"), STUDIO.launchCanvas)),
    ),
  );
}

function showPreview(card, project, version) {
  const plan = version.geometry;
  $(".fact-version", card).textContent = STUDIO.versionFact(version.version_no, ROLES[version.author_role] ?? version.author_role);
  if (!isPlan(plan)) return; // nothing drawable: the neutral tile stays
  $(".thumb", card).replaceWith(planThumbnail(plan, STUDIO.floorPlanOf(project.name)));
  $(".fact-area", card).textContent = STUDIO.areaValue(planArea(plan).toFixed(1));
}

// A project without a saved version answers 404. Any other failure keeps the neutral placeholder:
// a missing preview must never take the dashboard down.
async function loadPreview(project, card) {
  try {
    showPreview(card, project, await api(`/v1/projects/${project.id}/versions/latest`));
  } catch (error) {
    if (error.status !== 404) return;
    $(".thumb", card).replaceWith(thumbPlaceholder("empty", STUDIO.noPlanYet));
    $(".fact-version", card).textContent = STUDIO.none;
  }
}

function applyFilter(projects, cards, query) {
  const shown = projects.map((project) => matchesProject(project, query));
  cards.forEach((card, i) => (card.hidden = !shown[i]));
  $("#no-match").hidden = projects.length === 0 || shown.some(Boolean);
}

function showProjects(projects) {
  const cards = projects.map(projectCard);
  $("#empty").hidden = projects.length > 0;
  $("#project-list").replaceChildren(...cards);
  $("#project-filter").addEventListener("input", (event) => applyFilter(projects, cards, event.target.value));
  loadPreviewsWhenSeen(projects, cards);
}

// A preview costs one request per project, so each is fetched when its card comes near the viewport.
// Cards hidden by the filter never intersect, and load once they are shown.
function loadPreviewsWhenSeen(projects, cards) {
  const observer = new IntersectionObserver(
    (entries) =>
      entries
        .filter((entry) => entry.isIntersecting)
        .forEach((entry) => {
          observer.unobserve(entry.target);
          loadPreview(projects[cards.indexOf(entry.target)], entry.target);
        }),
    { rootMargin: "300px" },
  );
  cards.forEach((card) => observer.observe(card));
}

async function loadActivity(studio) {
  const events = await api(`/v1/studios/${studio.id}/audit`);
  $("#no-activity").hidden = events.length > 0;
  $("#activity").replaceChildren(
    ...events.map((event) =>
      h("li", {}, h("span", {}, activityText(event)), h("time", { class: "code", dateTime: event.created_at }, formatDate(event.created_at))),
    ),
  );
}

function wireInvites(studio, projects, initialInvites) {
  let invites = initialInvites;
  const form = $("#invite-form");
  $("#invite-client").addEventListener("click", () => form.elements.client_name.focus());
  form.addEventListener(
    "submit",
    action(async () => {
      const body = Object.fromEntries(new FormData(form));
      const invite = await api(`/v1/studios/${studio.id}/invites`, { method: "POST", body });
      form.reset();
      invites = [invite, ...invites]; // shown from the response: a failed refresh must not look like a failed invite
      showInvites(invites);
      showMetrics(projects, invites);
      run(() => loadActivity(studio));
      await copyText(inviteUrl(invite));
    }),
  );
}

function showIdentity(studio, email, role) {
  save(KEYS.studio, studio); // "Create new project" from here starts a project in the designer's own studio
  showStudio(studio.name);
  $("#studio-name").textContent = studio.name;
  $("#signed-in").textContent = STUDIO.signedInAs(email);
  document.title = STUDIO.title(studio.name);
  $("#studio-url").value = pageUrl(`entry.html?studio=${studio.slug}`);
  $("#copy-studio-url").addEventListener("click", () => copyText($("#studio-url").value));
  $("#role").textContent = role ?? "";
  $("#role-readout").hidden = !role;
}

async function showDashboard(studio, email, role) {
  showIdentity(studio, email, role);
  const [projects, invites] = await Promise.all([
    api(`/v1/projects?studio_id=${studio.id}`),
    api(`/v1/studios/${studio.id}/invites`),
  ]);
  showInvites(invites);
  showMetrics(projects, invites);
  showProjects(projects);
  wireInvites(studio, projects, invites);
  $("#dashboard").hidden = false;
  run(() => loadActivity(studio)); // its own error path: the dashboard stays usable without the activity list
}

run(async () => {
  await requireSession();
  $("#sign-out").addEventListener("click", signOut);
  const me = await api("/v1/me");
  const membership = me.memberships[0];
  if (membership) return showDashboard(membership.studio, me.email, membership.role);

  const form = $("#create-studio");
  form.hidden = false;
  form.addEventListener(
    "submit",
    action(async () => {
      const created = await api("/v1/studios", { method: "POST", body: { name: new FormData(form).get("name") } });
      form.hidden = true;
      await showDashboard(created, me.email, "owner");
    }),
  );
});
