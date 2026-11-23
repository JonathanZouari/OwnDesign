import { api, getSession, safeNext, supabase } from "../api.js";
import { AUTH } from "../strings.js";
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

const TITLES = AUTH.titles;
const BUTTONS = AUTH.buttons;
const FORGOT_NOTICE = AUTH.forgotNotice;

// Supabase's English error text is never shown: it is mapped to Hebrew by status, code and message.
function authError(error) {
  const text = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
  const { errors } = AUTH;
  let message = errors.generic;
  if (error.status === 429 || /rate.?limit|too many|security purposes/.test(text)) message = errors.rateLimit;
  else if (/invalid.?login|invalid_credentials/.test(text)) message = errors.invalidLogin;
  else if (/already.*regist|user_already_exists|email_exists/.test(text)) message = errors.alreadyRegistered;
  else if (/weak_password|password should be|at least \d+ char|too short|should contain/.test(text)) message = errors.weakPassword;
  else if (/email_not_confirmed|not confirmed/.test(text)) message = errors.emailNotConfirmed;
  else if (/same_password|different from the old/.test(text)) message = errors.samePassword;
  else if (/validate.?email|email_address_invalid|invalid.*email/.test(text)) message = errors.invalidEmail;
  return new Error(message);
}

function render() {
  const signup = mode === "signup";
  const forgot = mode === "forgot";
  const reset = mode === "reset";
  $("#title").textContent = signup && asStudio ? AUTH.studioTitle : TITLES[mode];
  $("#subtitle").textContent =
    mode !== "reset" && mode !== "forgot" && load(KEYS.draft) && !asStudio ? AUTH.draftSubtitle : "";
  $("#submit").textContent = BUTTONS[mode];
  $("#switch").textContent = forgot || reset ? AUTH.backToSignin : signup ? AUTH.haveAccount : AUTH.createAccount;
  $("#switch").hidden = reset;
  $("#forgot").hidden = mode !== "signin";
  $("#studio-field").hidden = !(signup && asStudio);
  form.elements.studio.required = signup && asStudio;
  form.elements.email.closest("label").hidden = reset;
  form.elements.email.required = !reset;
  passwordField.hidden = forgot;
  form.elements.password.required = !forgot;
  form.elements.password.autocomplete = signup || reset ? "new-password" : "current-password";
  $("#password-label").textContent = reset ? AUTH.newPassword : AUTH.password;
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
      if (error) throw authError(error);
      // The same answer whether or not the address has an account.
      toast(FORGOT_NOTICE);
      return;
    }
    if (mode === "reset") {
      if (password !== confirm) throw new Error(AUTH.mismatch);
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw authError(error);
      toast(AUTH.passwordUpdated);
      return afterSignIn();
    }
    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw authError(error);
      return afterSignIn();
    }
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: location.href },
    });
    if (error) throw authError(error);
    if (asStudio) save(KEYS.pendingStudio, studio.trim());
    if (data.session) return afterSignIn();
    toast(AUTH.confirmEmail);
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
