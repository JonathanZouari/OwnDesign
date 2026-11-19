import { api } from "../api.js";
import { KEYS, save } from "../store.js";
import { $, run, showStudio } from "../ui.js";

const params = new URLSearchParams(location.search);

run(async () => {
  const invite = params.get("invite");
  const slug = params.get("studio");
  let studio = null;
  let greeting = "";
  try {
    if (invite) {
      const found = await api(`/v1/invites/${encodeURIComponent(invite)}`);
      studio = found.studio;
      greeting = `Hi ${found.client_name}, `;
      save(KEYS.invite, invite);
    } else if (slug) {
      studio = await api(`/v1/studios/by-slug/${encodeURIComponent(slug)}`);
    }
  } catch (error) {
    if (![404, 422].includes(error.status)) throw error;
  }
  if (!studio) {
    $("#missing").hidden = false;
    return;
  }
  save(KEYS.studio, studio);
  showStudio(studio.name);
  document.title = `Start designing · ${studio.name}`;
  $("#headline").textContent = `${greeting}${greeting ? "plan" : "Plan"} your home with ${studio.name}.`;
  $("#welcome").hidden = false;
});
