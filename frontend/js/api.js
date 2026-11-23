import { config } from "./config.js";

// supabase-js is served from frontend/vendor (loaded by a <script> tag before this module), so no
// third-party script runs on the page. It is used for sign-in and session refresh only; all data
// goes through the backend API.
export const supabase = globalThis.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

// Only same-folder pages are accepted, so a crafted link cannot redirect elsewhere after sign-in.
export const safeNext = (next) => (/^[a-z]+\.html(\?[\w=&%.-]*)?$/.test(next ?? "") ? next : null);

export async function requireSession() {
  const session = await getSession();
  if (session) return session;
  const here = location.pathname.split("/").pop() + location.search;
  location.replace(`auth.html?next=${encodeURIComponent(here)}`);
  return new Promise(() => {}); // navigation is under way; stop the page script here
}

export async function signOut() {
  await supabase.auth.signOut();
  location.replace("index.html");
}

export async function api(path, { method = "GET", body } = {}) {
  const session = await getSession();
  const headers = {
    ...(body ? { "Content-Type": "application/json" } : {}),
    ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
  };
  let response;
  try {
    response = await fetch(config.apiUrl + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error("Cannot reach the server. Check your connection and try again.");
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    const error = new Error(payload?.error ?? `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload.data;
}

// Opens a Server-Sent Events request. It is a POST with a bearer token, which EventSource cannot do.
// Failures before the stream starts (not signed in, wrong project, invalid input, quota) arrive as the
// usual JSON error envelope and are thrown like `api` does. The caller reads response.body.
export async function apiStream(path, body, signal) {
  const session = await getSession();
  const headers = { "Content-Type": "application/json", ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) };
  let response;
  try {
    response = await fetch(config.apiUrl + path, { method: "POST", headers, body: JSON.stringify(body), signal });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error("Cannot reach the server. Check your connection and try again.");
  }
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => null);
    const error = new Error(payload?.error ?? `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return response;
}
