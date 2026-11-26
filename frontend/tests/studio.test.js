import assert from "node:assert/strict";
import { test } from "node:test";
import { activityText, inviteForProject, inviteHistoryStatus, inviteState, isOpenInvite, matchesProject, studioMetrics } from "../js/studio-data.js";

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

test("an invite is accepted, expired at its expiry instant, or pending", () => {
  const at = (days) => new Date(NOW.getTime() + days * 86400000).toISOString();
  assert.equal(inviteState({ accepted_at: at(-1), expires_at: at(-5) }, NOW), "accepted"); // acceptance outlives expiry
  assert.equal(inviteState({ accepted_at: null, expires_at: at(1) }, NOW), "pending");
  assert.equal(inviteState({ accepted_at: null, expires_at: NOW.toISOString() }, NOW), "expired");
  assert.equal(inviteState({ accepted_at: null, expires_at: at(-1) }, NOW), "expired");
  assert.equal(inviteState({ accepted_at: null }, NOW), "pending"); // older rows without an expiry
});

test("expired invites are not counted as pending", () => {
  const invites = [{ accepted_at: null, expires_at: "2099-01-01T00:00:00Z" }, { accepted_at: null, expires_at: "2000-01-01T00:00:00Z" }];
  assert.equal(studioMetrics([], invites, NOW).pendingInvites, 1);
});

test("history status shows only what the system can verify", () => {
  const open = { accepted_at: null, revoked_at: null, expires_at: "2099-01-01T00:00:00Z" };
  const status = (invite, projects = []) => inviteHistoryStatus({ ...open, ...invite }, projects, NOW)[0];
  assert.equal(status({}), "Not sent yet");
  assert.equal(status({ last_send_at: "2026-11-19T10:00:00Z" }), "Sending…");
  assert.equal(status({ last_send_status: "sent" }), "Sent");
  assert.equal(status({ last_send_status: "failed" }), "Sending failed");
  assert.equal(status({ last_send_status: "not_configured" }), "Not sent: email is off");
  assert.equal(status({ last_send_status: "daily_limit" }), "Not sent: daily email limit");
  assert.equal(status({ last_send_status: "sent", expires_at: "2000-01-01T00:00:00Z" }), "Expired");
  assert.equal(status({ revoked_at: "2026-11-19T10:00:00Z" }), "Cancelled");
  assert.equal(status({ revoked_at: "2026-11-19T10:00:00Z", replaced_by: "new-id" }), "Replaced: address corrected");
  // Accepting proves a verified sign-in; "entered the project" needs a project of that same account.
  const accepted = { accepted_at: "2026-11-19T10:00:00Z", accepted_by: "user-1", last_send_status: "sent" };
  assert.equal(status(accepted), "Client signed in, no project yet");
  assert.equal(status(accepted, [{ client_user_id: "someone-else" }]), "Client signed in, no project yet");
  assert.equal(status(accepted, [{ client_user_id: "user-1" }]), "Client entered the project");
  // A cancelled invite stays cancelled even if its row also says sent.
  assert.equal(status({ revoked_at: "2026-11-19T10:00:00Z", last_send_status: "sent" }), "Cancelled");
});

test("only open invites offer actions, and cancelled ones are not pending", () => {
  const base = { accepted_at: null, revoked_at: null, expires_at: "2099-01-01T00:00:00Z" };
  assert.ok(isOpenInvite(base, NOW));
  assert.ok(isOpenInvite({ ...base, expires_at: "2000-01-01T00:00:00Z" }, NOW)); // expired: resend or correct
  assert.ok(!isOpenInvite({ ...base, revoked_at: "2026-11-19T10:00:00Z" }, NOW));
  assert.ok(!isOpenInvite({ ...base, accepted_at: "2026-11-19T10:00:00Z" }, NOW));
  assert.equal(inviteState({ ...base, revoked_at: "x", accepted_at: "y" }, NOW), "cancelled");
  assert.equal(studioMetrics([], [base, { ...base, revoked_at: "2026-11-19T10:00:00Z" }], NOW).pendingInvites, 1);
});

test("a project card finds the invite its client accepted", () => {
  const invites = [
    { id: "a", accepted_by: null },
    { id: "b", accepted_by: "user-1" },
  ];
  assert.equal(inviteForProject({ client_user_id: "user-1" }, invites).id, "b");
  assert.equal(inviteForProject({ client_user_id: "user-2" }, invites), null);
  assert.equal(inviteForProject({ client_user_id: null }, [{ accepted_by: null }]), null); // never matches on missing ids
  assert.equal(inviteForProject({ client_user_id: "user-1" }, []), null);
});

test("correction activity reads as a sentence", () => {
  assert.equal(activityText({ action: "invite.corrected", metadata: {}, project: null }), "Invite address corrected and sent again");
});
