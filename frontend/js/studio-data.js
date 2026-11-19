// Pure helpers for the studio dashboard: everything shown is derived from what the API returned.

const sameMonth = (iso, now) => {
  const date = new Date(iso);
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
};

export function studioMetrics(projects, invites, now = new Date()) {
  const emails = projects.flatMap((project) => (project.client_email ? [project.client_email.toLowerCase()] : []));
  return {
    projects: projects.length,
    clients: new Set(emails).size,
    pendingInvites: invites.filter((invite) => !invite.accepted_at).length,
    thisMonth: projects.filter((project) => sameMonth(project.created_at, now)).length,
  };
}

const ROLE = { client: "the client", designer: "the designer" };
const SENTENCE = {
  "studio.created": () => "Studio created",
  "invite.created": () => "Invite link created",
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
