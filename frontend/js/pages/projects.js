import { api, requireSession, signOut } from "../api.js";
import { COMMON, PROJECT_TYPES } from "../strings.js";
import { KEYS, load } from "../store.js";
import { $, formatDate, h, run } from "../ui.js";

run(async () => {
  await requireSession();
  $("#sign-out").addEventListener("click", signOut);
  $("#draft-notice").hidden = !load(KEYS.draft);

  const projects = await api("/v1/projects");
  $("#empty").hidden = projects.length > 0;
  $("#projects").replaceChildren(
    ...projects.map((project) =>
      h(
        "tr",
        {},
        h("td", {}, project.name),
        h("td", {}, PROJECT_TYPES[project.property_type]),
        h("td", {}, formatDate(project.created_at)),
        h(
          "td",
          {},
          h(
            "div",
            { class: "project-links" },
            h("a", { class: "button", href: `editor.html?project=${project.id}`, "aria-label": `פתיחת התוכנית של ${project.name}` }, COMMON.open),
            h("a", { class: "button", href: `design.html?project=${project.id}`, "aria-label": `בריף וחומרים של ${project.name}` }, "בריף וחומרים"),
            h("a", { class: "button", href: `consultant.html?project=${project.id}`, "aria-label": `יועץ העיצוב של ${project.name}` }, "יועץ AI"),
          ),
        ),
      ),
    ),
  );

  $("#new-project").addEventListener("click", () => location.assign("wizard.html"));
});
