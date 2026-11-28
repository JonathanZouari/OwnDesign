import { config } from "./config.js";
import { API_ERRORS } from "./strings.js";

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

// The user always sees Hebrew text chosen by status; the server's English `error` text is never shown.
export const apiMessage = (status) => API_ERRORS[status] ?? API_ERRORS.generic;

// `signal` (e.g. AbortSignal.timeout) gives up on the request; the error then has `aborted` set. Giving up says
// nothing about what the server did with it.
export async function api(path, { method = "GET", body, signal } = {}) {
  const session = await getSession();
  // A FormData body (file upload) is sent as is: the browser sets the multipart Content-Type and boundary.
  const isForm = body instanceof FormData;
  const headers = {
    ...(body && !isForm ? { "Content-Type": "application/json" } : {}),
    ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
  };
  const noAnswer = () => Object.assign(new Error(API_ERRORS.network), { aborted: Boolean(signal?.aborted) });
  let response;
  try {
    response = await fetch(config.apiUrl + path, { method, headers, signal, body: isForm ? body : body ? JSON.stringify(body) : undefined });
  } catch {
    throw noAnswer();
  }
  const payload = await response.json().catch(() => null);
  if (!payload && signal?.aborted) throw noAnswer(); // given up while the answer was still arriving
  if (!response.ok || !payload?.success) {
    const error = new Error(apiMessage(response.status));
    error.status = response.status;
    throw error;
  }
  return payload.data;
}
