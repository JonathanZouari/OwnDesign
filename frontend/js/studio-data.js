// Pure helpers for the studio dashboard: everything shown is derived from what the API returned.

const sameMonth = (iso, now) => {
  const date = new Date(iso);
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
};

// cancelled (also when replaced by a corrected address), accepted, expired (resending renews it) or pending.
export function inviteState(invite, now = new Date()) {
  if (invite.revoked_at) return "cancelled";
  if (invite.accepted_at) return "accepted";
  return invite.expires_at && new Date(invite.expires_at) <= now ? "expired" : "pending";
}

// Only an open invite can be resent, corrected or cancelled.
export const isOpenInvite = (invite, now = new Date()) => ["pending", "expired"].includes(inviteState(invite, now));

const SEND_STATUS = {
  sent: ["Sent", "ok"],
  failed: ["Sending failed", "error"],
  not_configured: ["Not sent: email is off", "caution"],
  daily_limit: ["Not sent: daily email limit", "caution"],
};

// The history row's status, using only what the system can verify. "Client entered the project" needs a project
// opened by the account that accepted this very invite; accepting alone only proves the verified sign-in.
export function inviteHistoryStatus(invite, projects = [], now = new Date()) {
  const state = inviteState(invite, now);
  if (state === "cancelled") return invite.replaced_by ? ["Replaced: address corrected", ""] : ["Cancelled", ""];
  if (state === "accepted") {
    const entered = projects.some((project) => project.client_user_id === invite.accepted_by);
    return entered ? ["Client entered the project", "ok"] : ["Client signed in, no project yet", "ok"];
  }
  if (state === "expired") return ["Expired", "caution"];
  if (invite.last_send_status) return SEND_STATUS[invite.last_send_status] ?? [invite.last_send_status, ""];
  return invite.last_send_at ? ["Sending…", ""] : ["Not sent yet", ""];
}

// The invite that brought this project's client into the studio, if the system can tell.
export const inviteForProject = (project, invites) =>
  invites.find((invite) => invite.accepted_by && invite.accepted_by === project.client_user_id) ?? null;

export function studioMetrics(projects, invites, now = new Date()) {
  const emails = projects.flatMap((project) => (project.client_email ? [project.client_email.toLowerCase()] : []));
  return {
    projects: projects.length,
    clients: new Set(emails).size,
    pendingInvites: invites.filter((invite) => inviteState(invite, now) === "pending").length,
    thisMonth: projects.filter((project) => sameMonth(project.created_at, now)).length,
  };
}

const ROLE = { client: "the client", designer: "the designer" };
const SENTENCE = {
  "studio.created": () => "Studio created",
  "invite.created": () => "Invite link created",
  "invite.emailed": () => "Invite emailed to the client",
  "invite.revoked": () => "Invite cancelled",
  "invite.corrected": () => "Invite address corrected and sent again",
  "invite.accepted": () => "Invite accepted by the client",
  "project.created": () => "Project created",
  "plan_version.created": (metadata) =>
    `Version ${metadata.version_no ?? "?"} saved by ${ROLE[metadata.author_role] ?? "a studio member"}`,
};

// One audit row as a sentence, e.g. "Version 2 saved by the designer · Flat A".
export function activityText({ action, metadata, project }) {
  const sentence = SENTENCE[action]?.(metadata ?? {}) ?? action;
  return project?.name ? `${sentence} · ${project.name}` : sentence;
}

export function matchesProject(project, query) {
  const needle = query.trim().toLowerCase();
  return `${project.name} ${project.client_email ?? ""}`.toLowerCase().includes(needle);
}
