import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.1/+esm";

import { config } from "./config.js";

// Used for sign-in and session refresh only. All data goes through the backend API.
export const supabase = createClient(config.supabaseUrl, config.supabasePublishableKey);

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
