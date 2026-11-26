import { api, requireSession, signOut } from "../api.js";
import { isPlan, planArea } from "../plan.js";
import { KEYS, save } from "../store.js";
import { activityText, inviteForProject, inviteHistoryStatus, inviteState, isOpenInvite, matchesProject, studioMetrics } from "../studio-data.js";
import { planThumbnail } from "../thumbnail.js";
import { $, action, copyText, formatDate, h, pageUrl, run, showStudio, toast } from "../ui.js";

const TYPE_LABEL = { existing: "Existing home", new_build: "New build" };
const UNKNOWN = "—";

const icon = (name) => h("span", { class: "icon", "aria-hidden": "true" }, name);
const inviteUrl = (invite) => pageUrl(`entry.html?invite=${invite.token}`);

// The invite history, newest first (the API orders it). resend, correct and cancel are wrapped in action(), so
// each button is disabled while its request runs.
function showInvites(invites, projects, { resend, correct, cancel }) {
  $("#no-invites").hidden = invites.length > 0;
  $("#invites").replaceChildren(
    ...invites.map((invite) => {
      const [statusText, tone] = inviteHistoryStatus(invite, projects);
      const open = isOpenInvite(invite);
      const label = (text) => ({ type: "button", "aria-label": `${text} ${invite.client_email}` });
      const buttons = open
        ? [
            inviteState(invite) === "pending" &&
              h("button", { ...label("Copy invite link for"), onclick: () => copyText(inviteUrl(invite)) }, "Copy link"),
            h("button", { ...label("Resend email to"), onclick: action(() => resend(invite)) }, "Resend"),
            h("button", { ...label("Correct address of"), onclick: () => correct(invite) }, "Correct address"),
            h("button", { ...label("Cancel invite for"), onclick: action(() => cancel(invite)) }, "Cancel"),
          ].filter(Boolean)
        : [];
      return h(
        "li",
        { class: open ? "" : "closed" },
        h("span", { class: "who" }, invite.client_name),
        h("span", { class: "code" }, invite.client_email),
        h(
          "div",
          { class: "meta" },
          h("span", { class: `chip ${tone}` }, statusText),
          invite.last_send_at
            ? h("span", { class: "sent-at" }, "Last email ", h("time", { dateTime: invite.last_send_at }, formatDate(invite.last_send_at)))
            : h("span", { class: "sent-at" }, "No email sent"),
        ),
        buttons.length ? h("div", { class: "row-actions" }, ...buttons) : null,
      );
    }),
  );
}

// Two steps, so the designer sees both addresses before the old link is cancelled.
function openCorrectDialog(invite, submit) {
  const dialog = $("#correct-dialog");
  const form = $("#correct-form");
  const review = $("#correct-review");
  const button = $("#correct-submit");
  const step = (reviewing) => {
    $("#correct-edit").hidden = reviewing;
    review.hidden = !reviewing;
    button.textContent = reviewing ? "Cancel old link and send" : "Review";
    $("#correct-back").textContent = reviewing ? "Back" : "Cancel";
  };
  form.reset();
  step(false);
  $("#correct-original").textContent = invite.client_email;
  form.elements.client_name.value = invite.client_name;
  form.onsubmit = action(async () => {
    const body = Object.fromEntries(new FormData(form));
    if (review.hidden) {
      if (body.client_email.trim().toLowerCase() === invite.client_email) throw new Error("The corrected address is the same as the original.");
      $("#review-original").textContent = invite.client_email;
      $("#review-corrected").textContent = body.client_email.trim();
      return step(true);
    }
    await submit(invite, body);
    dialog.close();
  });
  $("#correct-back").onclick = () => (review.hidden ? dialog.close() : step(false));
  dialog.showModal();
}

// After an invite was created or resent: tell the designer whether the client got an email or the link must be sent by hand.
async function reportDelivery(invite) {
  if (invite.emailed) return toast(`Invite emailed to ${invite.client_email}`);
  toast("The email could not be sent. The link is copied: send it to the client yourself.", "error");
  await copyText(inviteUrl(invite));
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
        h("span", { class: "chip" }, TYPE_LABEL[project.property_type] ?? project.property_type),
        h("span", { class: "code" }, `Created ${formatDate(project.created_at)}`),
      ),
      h("h3", { id: titleId }, project.name),
      h("p", { class: "client" }, icon("person"), h("span", {}, project.client_email ?? "No client email")),
      h("p", { class: "invited-by" }),
      h("dl", { class: "facts" }, fact("Floor area", "fact-area"), fact("Latest version", "fact-version")),
      h("div", {}, h("a", { class: "button primary", href: `editor.html?project=${project.id}` }, icon("architecture"), "Launch 2D canvas")),
    ),
  );
}

// Read-only: which invite brought this project's client in. The full history and its actions are in "Clients & invites".
function showInvitedBy(projects, invites) {
  for (const project of projects) {
    const line = document.getElementById(`project-${project.id}`)?.closest("article")?.querySelector(".invited-by");
    if (!line) continue;
    const invite = inviteForProject(project, invites);
    line.textContent = invite
      ? `Joined through the invite to ${invite.client_email} · ${formatDate(invite.accepted_at)}`
      : "No invite on record for this client";
  }
}

function showPreview(card, project, version) {
  const plan = version.geometry;
  $(".fact-version", card).textContent = `v${version.version_no} · ${version.author_role}`;
  if (!isPlan(plan)) return; // nothing drawable: the neutral tile stays
  $(".thumb", card).replaceWith(planThumbnail(plan, `Floor plan of ${project.name}`));
  $(".fact-area", card).textContent = `${planArea(plan).toFixed(1)} m²`;
}

// A project without a saved version answers 404. Any other failure keeps the neutral placeholder:
// a missing preview must never take the dashboard down.
async function loadPreview(project, card) {
  try {
    showPreview(card, project, await api(`/v1/projects/${project.id}/versions/latest`));
  } catch (error) {
    if (error.status !== 404) return;
    $(".thumb", card).replaceWith(thumbPlaceholder("empty", "No plan saved yet"));
    $(".fact-version", card).textContent = "None yet";
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
  const base = `/v1/studios/${studio.id}/invites`;
  const render = () => {
    invites.sort((a, b) => (a.created_at < b.created_at ? 1 : -1)); // newest first, as the API returns them
    showInvites(invites, projects, handlers);
    showMetrics(projects, invites);
    showInvitedBy(projects, invites);
  };
  // Shown from each response: a failed list refresh must not look like a failed invite.
  const update = (...changed) => {
    const ids = new Set(changed.map((invite) => invite.id)); // inviting the same client again returns the same invite
    invites = [...changed, ...invites.filter((invite) => !ids.has(invite.id))];
    render();
    run(() => loadActivity(studio));
  };
  const now = () => new Date().toISOString();
  const handlers = {
    async resend(invite) {
      const sent = await api(`${base}/${invite.id}/send`, { method: "POST" });
      update(sent);
      await reportDelivery(sent);
    },
    async cancel(invite) {
      await api(`${base}/${invite.id}`, { method: "DELETE" });
      update({ ...invite, revoked_at: now() });
      toast(`Invite for ${invite.client_email} cancelled. The link no longer works.`);
    },
    correct(invite) {
      openCorrectDialog(invite, async (original, body) => {
        const replacement = await api(`${base}/${original.id}/correct`, { method: "POST", body });
        // Both stay in the history: the original as replaced, the new invite on top.
        update(replacement, { ...original, revoked_at: original.revoked_at ?? now(), replaced_by: replacement.id });
        await reportDelivery(replacement);
      });
    },
  };
  render();

  const form = $("#invite-form");
  $("#invite-client").addEventListener("click", () => form.elements.client_name.focus());
  form.addEventListener(
    "submit",
    action(async () => {
      const invite = await api(base, { method: "POST", body: Object.fromEntries(new FormData(form)) });
      form.reset();
      update(invite);
      await reportDelivery(invite);
    }),
  );
}

function showIdentity(studio, email, role) {
  save(KEYS.studio, studio); // "Create new project" from here starts a project in the designer's own studio
  showStudio(studio.name);
  $("#studio-name").textContent = studio.name;
  $("#signed-in").textContent = `Signed in as ${email}`;
  document.title = `${studio.name} · Studio`;
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
  showProjects(projects);
  wireInvites(studio, projects, invites); // also fills the metrics and each card's invite line
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
