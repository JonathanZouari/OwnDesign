// Pure helpers for the studio dashboard: everything shown is derived from what the API returned.

const sameMonth = (iso, now) => {
  const date = new Date(iso);
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
};

// accepted, expired (the link no longer works; resending renews it) or pending.
export function inviteState(invite, now = new Date()) {
  if (invite.accepted_at) return "accepted";
  return invite.expires_at && new Date(invite.expires_at) <= now ? "expired" : "pending";
}

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
