import { api, requireSession, signOut } from "../api.js";
import { KEYS, save } from "../store.js";
import { $, action, copyText, formatDate, h, pageUrl, run, showStudio } from "../ui.js";

const TYPE_LABEL = { existing: "Existing home", new_build: "New build" };

function showInvites(invites) {
  $("#invites").replaceChildren(
    ...invites.map((invite) =>
      h(
        "tr",
        {},
        h("td", {}, invite.client_name),
        h("td", {}, invite.client_email),
        h("td", {}, h("span", { class: `chip ${invite.accepted_at ? "ok" : ""}` }, invite.accepted_at ? "Accepted" : "Pending")),
        h(
          "td",
          {},
          h("button", { type: "button", onclick: () => copyText(pageUrl(`entry.html?invite=${invite.token}`)) }, "Copy link"),
        ),
      ),
    ),
  );
}

async function showDashboard(studio) {
  save(KEYS.studio, studio); // "New project" from here starts a project in the designer's own studio
  showStudio(studio.name);
  $("#studio-name").textContent = studio.name;
  document.title = `${studio.name} · Studio`;
  $("#studio-url").value = pageUrl(`entry.html?studio=${studio.slug}`);
  $("#copy-studio-url").addEventListener("click", () => copyText($("#studio-url").value));

  const [projects, invites] = await Promise.all([
    api(`/v1/projects?studio_id=${studio.id}`),
    api(`/v1/studios/${studio.id}/invites`),
  ]);
  showInvites(invites);
  $("#empty").hidden = projects.length > 0;
  $("#projects").replaceChildren(
    ...projects.map((project) =>
      h(
        "tr",
        {},
        h("td", {}, project.name),
        h("td", {}, project.client_email ?? ""),
        h("td", {}, TYPE_LABEL[project.property_type]),
        h("td", {}, formatDate(project.created_at)),
        h("td", {}, h("a", { class: "button", href: `editor.html?project=${project.id}` }, "Open")),
      ),
    ),
  );

  const inviteForm = $("#invite-form");
  inviteForm.addEventListener(
    "submit",
    action(async () => {
      const body = Object.fromEntries(new FormData(inviteForm));
      const invite = await api(`/v1/studios/${studio.id}/invites`, { method: "POST", body });
      inviteForm.reset();
      showInvites(await api(`/v1/studios/${studio.id}/invites`));
      await copyText(pageUrl(`entry.html?invite=${invite.token}`));
    }),
  );
  $("#dashboard").hidden = false;
}

run(async () => {
  await requireSession();
  $("#sign-out").addEventListener("click", signOut);
  const me = await api("/v1/me");
  const studio = me.memberships[0]?.studio;
  if (studio) return showDashboard(studio);

  const form = $("#create-studio");
  form.hidden = false;
  form.addEventListener(
    "submit",
    action(async () => {
      const created = await api("/v1/studios", { method: "POST", body: { name: new FormData(form).get("name") } });
      form.hidden = true;
      await showDashboard(created);
    }),
  );
});
