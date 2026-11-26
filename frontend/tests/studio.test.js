import assert from "node:assert/strict";
import { test } from "node:test";
import { activityText, matchesProject, studioMetrics } from "../js/studio-data.js";

const NOW = new Date(2026, 10, 19, 12);
const inMonth = new Date(2026, 10, 2).toISOString();
const before = new Date(2026, 9, 30).toISOString();

test("metrics count projects, distinct clients, pending invites and this month's projects", () => {
  const projects = [
    { client_email: "a@x.test", created_at: inMonth },
    { client_email: "A@x.test", created_at: before },
    { client_email: "b@x.test", created_at: inMonth },
    { client_email: null, created_at: before },
  ];
  const invites = [{ accepted_at: null }, { accepted_at: inMonth }, { accepted_at: null }];
  assert.deepEqual(studioMetrics(projects, invites, NOW), { projects: 4, clients: 2, pendingInvites: 2, thisMonth: 2 });
  assert.deepEqual(studioMetrics([], [], NOW), { projects: 0, clients: 0, pendingInvites: 0, thisMonth: 0 });
});

test("the same month of another year is not this month", () => {
  const lastYear = new Date(2025, 10, 19).toISOString();
  assert.equal(studioMetrics([{ client_email: null, created_at: lastYear }], [], NOW).thisMonth, 0);
});

test("activity rows read as sentences", () => {
  const version = { action: "plan_version.created", metadata: { version_no: 2, author_role: "designer" }, project: { name: "Flat A" } };
  assert.equal(activityText(version), "Version 2 saved by the designer · Flat A");
  assert.equal(activityText({ ...version, metadata: { version_no: 1, author_role: "client" }, project: null }), "Version 1 saved by the client");
  assert.equal(activityText({ action: "project.created", metadata: {}, project: { name: "Flat A" } }), "Project created · Flat A");
  assert.equal(activityText({ action: "invite.accepted", metadata: null, project: null }), "Invite accepted by the client");
  assert.equal(activityText({ action: "invite.emailed", metadata: {}, project: null }), "Invite emailed to the client");
  assert.equal(activityText({ action: "something.new", metadata: {}, project: null }), "something.new");
});

test("projects are filtered by name or client email, ignoring case and outer spaces", () => {
  const project = { name: "Dana's Flat", client_email: "dana@x.test" };
  assert.ok(matchesProject(project, ""));
  assert.ok(matchesProject(project, "  FLAT "));
  assert.ok(matchesProject(project, "dana@"));
  assert.ok(!matchesProject(project, "villa"));
  assert.ok(matchesProject({ name: "Loft", client_email: null }, "lof"));
});
