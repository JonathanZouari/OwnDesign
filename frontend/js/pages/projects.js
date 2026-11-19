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
        h("td", {}, h("a", { class: "button", href: `editor.html?project=${project.id}` }, COMMON.open)),
      ),
    ),
  );

  $("#new-project").addEventListener("click", () => location.assign("wizard.html"));
});
