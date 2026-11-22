import { STUDIO } from "./strings.js";

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

const T = STUDIO.activity;
const SENTENCE = {
  "studio.created": () => T.studioCreated,
  "invite.created": () => T.inviteCreated,
  "invite.accepted": () => T.inviteAccepted,
  "project.created": () => T.projectCreated,
  "plan_version.created": (metadata) => T.versionSaved(metadata.version_no ?? "?", T.roles[metadata.author_role] ?? T.roles.other),
};

// One audit row as a sentence, e.g. "גרסה 2 נשמרה על ידי המעצב · Flat A".
export function activityText({ action, metadata, project }) {
  const sentence = SENTENCE[action]?.(metadata ?? {}) ?? action;
  return project?.name ? `${sentence} · ${project.name}` : sentence;
}

export function matchesProject(project, query) {
  const needle = query.trim().toLowerCase();
  return `${project.name} ${project.client_email ?? ""}`.toLowerCase().includes(needle);
}
