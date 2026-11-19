// Small per-browser state that carries a visitor from the studio link to their first save.
// Storage can be blocked or full, so every access is guarded and the app works without it.

export const KEYS = {
  studio: "od.studio", // { id, name, slug } of the studio whose link the visitor followed
  invite: "od.invite", // invite token to accept after sign-in
  draft: "od.draft", // { name, property_type, studio, plan } not yet saved to an account
  pendingStudio: "od.pendingStudio", // studio name to create once a new designer is signed in
};

export function load(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

export function save(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
