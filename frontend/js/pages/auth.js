import { api, getSession, safeNext, supabase } from "../api.js";
import { KEYS, load, save } from "../store.js";
import { $, action, run, toast } from "../ui.js";

const params = new URLSearchParams(location.search);
const asStudio = params.get("role") === "studio";
let mode = params.get("mode") === "signup" ? "signup" : "signin";

const form = $("#auth-form");

function render() {
  const signup = mode === "signup";
  $("#title").textContent = signup ? (asStudio ? "Create your studio" : "Create your account") : "Sign in";
  $("#subtitle").textContent = load(KEYS.draft) && !asStudio ? "Sign in or create an account to save your plan." : "";
  $("#submit").textContent = signup ? "Create account" : "Sign in";
  $("#switch").textContent = signup ? "I already have an account" : "Create an account";
  $("#studio-field").hidden = !(signup && asStudio);
  form.elements.studio.required = signup && asStudio;
  form.elements.password.autocomplete = signup ? "new-password" : "current-password";
}

// Finishes whatever the visitor started before they had an account, then sends them on.
async function afterSignIn() {
  const pendingStudio = load(KEYS.pendingStudio);
  if (pendingStudio) {
    await api("/v1/studios", { method: "POST", body: { name: pendingStudio } }).catch((error) => {
      if (error.status !== 409) throw error; // 409: they already own a studio
    });
    save(KEYS.pendingStudio, null);
  }
  const invite = load(KEYS.invite);
  if (invite) {
    await api(`/v1/invites/${encodeURIComponent(invite)}/accept`, { method: "POST" }).catch((error) => {
      if (![404, 409, 422].includes(error.status)) throw error; // a stale invite must not block sign-in
    });
    save(KEYS.invite, null);
  }
  const next = safeNext(params.get("next"));
  if (next) return location.replace(next);
  if (load(KEYS.draft)) return location.replace("editor.html");
  const me = await api("/v1/me");
  location.replace(me.memberships.length ? "studio.html" : "projects.html");
}

form.addEventListener(
  "submit",
  action(async () => {
    const { email, password, studio } = Object.fromEntries(new FormData(form));
    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
      return afterSignIn();
    }
    if (asStudio) save(KEYS.pendingStudio, studio.trim());
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: location.href },
    });
    if (error) throw new Error(error.message);
    if (data.session) return afterSignIn();
    toast("Check your email for a confirmation link, then come back and sign in.");
    mode = "signin";
    render();
  }),
);

$("#switch").addEventListener("click", () => {
  mode = mode === "signup" ? "signin" : "signup";
  render();
});

render();
run(async () => {
  if (await getSession()) await afterSignIn();
});
