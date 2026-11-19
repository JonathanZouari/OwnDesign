import { api, getSession, safeNext, supabase } from "../api.js";
import { KEYS, load, save } from "../store.js";
import { $, action, run, toast } from "../ui.js";

const params = new URLSearchParams(location.search);
const asStudio = params.get("role") === "studio";
const requested = params.get("mode");
let mode = ["signup", "forgot", "reset"].includes(requested) ? requested : "signin";
let recoveryReady = false;

const form = $("#auth-form");
const passwordField = $("#password-field");
// Only in the page while resetting, so it never shares a label with the sign-in password field.
const confirmField = $("#confirm-field");
confirmField.remove();

const TITLES = { signin: "Sign in", signup: "Create your account", forgot: "Reset your password", reset: "Choose a new password" };
const BUTTONS = { signin: "Sign in", signup: "Create account", forgot: "Send reset link", reset: "Update password" };
const FORGOT_NOTICE = "If an account exists for this email, a reset link is on its way. Check your inbox.";

function render() {
  const signup = mode === "signup";
  const forgot = mode === "forgot";
  const reset = mode === "reset";
  $("#title").textContent = signup && asStudio ? "Create your studio" : TITLES[mode];
  $("#subtitle").textContent =
    mode !== "reset" && mode !== "forgot" && load(KEYS.draft) && !asStudio ? "Sign in or create an account to save your plan." : "";
  $("#submit").textContent = BUTTONS[mode];
  $("#switch").textContent = forgot || reset ? "Back to sign in" : signup ? "I already have an account" : "Create an account";
  $("#switch").hidden = reset;
  $("#forgot").hidden = mode !== "signin";
  $("#studio-field").hidden = !(signup && asStudio);
  form.elements.studio.required = signup && asStudio;
  form.elements.email.closest("label").hidden = reset;
  form.elements.email.required = !reset;
  passwordField.hidden = forgot;
  form.elements.password.required = !forgot;
  form.elements.password.autocomplete = signup || reset ? "new-password" : "current-password";
  $("#password-label").textContent = reset ? "New password" : "Password";
  if (reset) passwordField.after(confirmField);
  else confirmField.remove();
  // A reset link that did not produce a recovery session leaves nothing to submit.
  form.hidden = reset && !recoveryReady;
  $("#reset-invalid").hidden = !(reset && !recoveryReady);
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
    const { email, password, studio, confirm } = Object.fromEntries(new FormData(form));
    if (mode === "forgot") {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${location.origin}${location.pathname}?mode=reset`,
      });
      if (error) throw new Error(error.message);
      // The same answer whether or not the address has an account.
      toast(FORGOT_NOTICE);
      return;
    }
    if (mode === "reset") {
      if (password !== confirm) throw new Error("Passwords do not match.");
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw new Error(error.message);
      toast("Password updated");
      return afterSignIn();
    }
    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
      return afterSignIn();
    }
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: location.href },
    });
    if (error) throw new Error(error.message);
    if (asStudio) save(KEYS.pendingStudio, studio.trim());
    if (data.session) return afterSignIn();
    toast("Check your email for a confirmation link, then come back and sign in.");
    mode = "signin";
    render();
  }),
);

$("#switch").addEventListener("click", () => {
  mode = mode === "signin" ? "signup" : "signin";
  render();
});

$("#forgot").addEventListener("click", () => {
  mode = "forgot";
  render();
});

$("#request-new").addEventListener("click", () => {
  mode = "forgot";
  render();
});

render();
run(async () => {
  const session = await getSession(); // waits for supabase-js to read a recovery link from the URL
  if (mode === "reset") {
    recoveryReady = Boolean(session);
    render();
  } else if (session) {
    await afterSignIn();
  }
});
