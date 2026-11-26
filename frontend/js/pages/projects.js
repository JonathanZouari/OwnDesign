import { api, requireSession, signOut } from "../api.js";
import { KEYS, load, save } from "../store.js";
import { $, formatDate, h, run, toast } from "../ui.js";

const TYPE_LABEL = { existing: "Existing home", new_build: "New build" };

run(async () => {
  await requireSession();
  $("#sign-out").addEventListener("click", signOut);
  $("#draft-notice").hidden = !load(KEYS.draft);

  const [me, projects] = await Promise.all([api("/v1/me"), api("/v1/projects")]);
  $("#studio-link").hidden = me.memberships.length === 0;
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
        h(
          "td",
          {},
          h(
            "div",
            { class: "project-links" },
            h("a", { class: "button", href: `editor.html?project=${project.id}`, "aria-label": `Open the plan of ${project.name}` }, "Open"),
            h("a", { class: "button", href: `design.html?project=${project.id}`, "aria-label": `Brief and materials of ${project.name}` }, "Brief & materials"),
            h("a", { class: "button", href: `consultant.html?project=${project.id}`, "aria-label": `Design consultant for ${project.name}` }, "Consultant"),
            h("a", { class: "button", href: `budget.html?project=${project.id}`, "aria-label": `Budget of ${project.name}` }, "Budget"),
          ),
        ),
      ),
    ),
  );

  $("#new-project").addEventListener("click", () => {
    // A returning client keeps working with the studio of their latest project.
    const latest = projects[0];
    if (!load(KEYS.studio) && latest) save(KEYS.studio, { id: latest.studio_id, ...latest.studio });
    if (!load(KEYS.studio)) return toast("Open your designer's link to start a project with their studio.", "error");
    location.assign("wizard.html");
  });
});
