import { api, requireSession, signOut } from "../api.js";
import { KEYS, load, save } from "../store.js";
import { $, action, formatDate, h, run, toast } from "../ui.js";

const TYPE_LABEL = { existing: "Existing home", new_build: "New build" };

run(async () => {
  await requireSession();
  $("#sign-out").addEventListener("click", signOut);
  $("#draft-notice").hidden = !load(KEYS.draft);

  const [me, projects] = await Promise.all([api("/v1/me"), api("/v1/projects")]);
  $("#studio-link").hidden = me.memberships.length === 0;
  const canOpenStudio = me.memberships.length === 0;
  $("#open-studio").hidden = !canOpenStudio;
  $("#empty").hidden = projects.length > 0;
  $("#projects").replaceChildren(
    ...projects.map((project) =>
      h(
        "tr",
        {},
        h("td", {}, project.name),
        h("td", {}, project.studio?.name ?? ""),
        h("td", {}, TYPE_LABEL[project.property_type]),
        h("td", {}, formatDate(project.created_at)),
        h("td", {}, h("a", { class: "button", href: `editor.html?project=${project.id}` }, "Open")),
      ),
    ),
  );

  $("#new-project").addEventListener("click", () => {
    // A returning client keeps working with the studio of their latest project.
    const latest = projects[0];
    if (!load(KEYS.studio) && latest) save(KEYS.studio, { id: latest.studio_id, ...latest.studio });
    if (!load(KEYS.studio)) {
      const hint = canOpenStudio ? ", or open your own studio below" : "";
      return toast(`To start a project, open your designer's link${hint}.`, "error");
    }
    location.assign("wizard.html");
  });

  $("#studio-form").addEventListener(
    "submit",
    action(async (event) => {
      const name = new FormData(event.currentTarget).get("studio").trim();
      if (!name) throw new Error("Enter a studio name.");
      try {
        await api("/v1/studios", { method: "POST", body: { name } });
      } catch (error) {
        if (error.status !== 409) throw error; // 409: they already own a studio
      }
      location.assign("studio.html");
    }),
  );
});
