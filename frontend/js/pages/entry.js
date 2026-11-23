import { api } from "../api.js";
import { emptyPlan } from "../plan.js";
import { ENTRY } from "../strings.js";
import { KEYS, load, save } from "../store.js";
import { $, action, run, showStudio } from "../ui.js";

const params = new URLSearchParams(location.search);

// Who the link belongs to: { studio, clientName } or null when the link is missing or no longer valid.
async function resolveLink(invite, slug) {
  try {
    if (invite) {
      const found = await api(`/v1/invites/${encodeURIComponent(invite)}`);
      return { studio: found.studio, clientName: found.client_name };
    }
    if (slug) return { studio: await api(`/v1/studios/by-slug/${encodeURIComponent(slug)}`), clientName: "" };
  } catch (error) {
    if (![404, 422].includes(error.status)) throw error;
  }
  return null;
}

// Same draft the wizard's "Skip to 2D canvas" stores, so the editor opens on an empty plan.
function startBlankCanvas(studio) {
  // Checked at click time: a draft may have been started in another tab since this page loaded.
  if (load(KEYS.draft) && !confirm(ENTRY.replaceDraft)) return;
  const draft = { name: ENTRY.defaultProject, property_type: "existing", studio, plan: emptyPlan() };
  if (!save(KEYS.draft, draft)) throw new Error(ENTRY.storageBlocked);
  location.assign("editor.html");
}

run(async () => {
  const invite = params.get("invite");
  const link = await resolveLink(invite, params.get("studio"));
  if (!link) {
    $("#missing").hidden = false;
    return;
  }
  const { studio, clientName } = link;
  if (invite) save(KEYS.invite, invite);
  save(KEYS.studio, studio);
  showStudio(studio.name);
  document.title = `${ENTRY.title} · ${studio.name}`;
  $("#headline").textContent = ENTRY.headline(studio.name, clientName);
  $("#portal-studio").textContent = studio.name;
  $("#entry-kind").textContent = invite ? ENTRY.kindInvite : ENTRY.kindStudio;
  $("#privacy").textContent = ENTRY.privacy(studio.name);
  $("#draft-notice").hidden = !load(KEYS.draft);
  $("#blank-canvas").addEventListener("click", action(async () => startBlankCanvas(studio)));
  $("#welcome").hidden = false;
});
