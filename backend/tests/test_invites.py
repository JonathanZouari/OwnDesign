"""Invite lifecycle against a real Supabase project: only the invited, verified address may enter;
invites expire, can be resent with the same link, and can be cancelled; only invited clients open projects."""

import uuid
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest

from tests.conftest import needs_supabase, unique_email

pytestmark = needs_supabase
PAST = "2000-01-01T00:00:00+00:00"


@pytest.fixture(scope="module")
def world(api, make_user):
    designer, designer_b = make_user("inv-designer"), make_user("inv-designer-b")
    studio = api.post("/v1/studios", json={"name": "Invite Studio"}, headers=designer.headers).json()["data"]
    studio_b = api.post("/v1/studios", json={"name": "Invite Studio B"}, headers=designer_b.headers).json()["data"]
    return SimpleNamespace(designer=designer, designer_b=designer_b, studio=studio, studio_b=studio_b)


@pytest.fixture
def invite(api, world):
    """Sends a fresh invite from the studio and returns it."""

    def send(email: str, name: str = "Client", studio=None, designer=None) -> dict:
        studio, designer = studio or world.studio, designer or world.designer
        response = api.post(f"/v1/studios/{studio['id']}/invites", json={"client_email": email, "client_name": name}, headers=designer.headers)
        assert response.status_code == 201, response.text
        return response.json()["data"]

    return send


def accept(api, token, user):
    return api.post(f"/v1/invites/{token}/accept", headers=user.headers)


def new_project(api, studio, user):
    return api.post("/v1/projects", json={"studio_id": studio["id"], "name": "Flat", "property_type": "existing"}, headers=user.headers)


# Who may enter


def test_only_the_invited_address_can_accept_and_a_forward_does_not_burn_the_link(api, make_user, invite):
    client, forwarded_to = make_user("inv-client"), make_user("inv-forward")
    token = invite(client.email)["token"]

    refused = accept(api, token, forwarded_to)
    assert refused.status_code == 403 and "different email address" in refused.json()["error"]
    assert client.email not in refused.text  # the refusal does not reveal whom the link was for

    assert accept(api, token, client).status_code == 200  # the real client still gets in afterwards
    assert accept(api, token, client).status_code == 200  # idempotent
    assert accept(api, token, forwarded_to).status_code == 409


def test_address_match_ignores_letter_case(api, make_user, invite):
    client = make_user("inv-case")
    token = invite(client.email.upper())["token"]
    assert accept(api, token, client).status_code == 200


def test_an_unconfirmed_address_cannot_accept(api, admin, make_user, monkeypatch, invite):
    # Supabase already refuses sign-in before confirmation; this is the server's own second check.
    from app.routes import studios

    client = make_user("inv-unconfirmed")
    assert studios._verified_email(client.id) == client.email.lower()  # read from Supabase Auth, confirmed

    unconfirmed = admin.auth.admin.create_user({"email": unique_email("inv-pending"), "password": uuid.uuid4().hex + "Aa1!"}).user
    assert studios._verified_email(unconfirmed.id) is None

    monkeypatch.setattr(studios, "_verified_email", lambda user_id: None)
    refused = accept(api, invite(client.email)["token"], client)
    assert refused.status_code == 403 and "Confirm your email" in refused.json()["error"]


def test_accept_needs_a_signed_in_user_and_a_well_formed_token(api, invite):
    token = invite(unique_email("inv-anon"))["token"]
    assert api.post(f"/v1/invites/{token}/accept").status_code == 401
    assert api.get("/v1/invites/short").status_code == 422
    assert api.get("/v1/invites/" + "x" * 32).status_code == 404


# Expiry, resend and cancel


def test_an_expired_invite_stops_working_and_resend_renews_the_same_link(api, admin, make_user, world, invite):
    client = make_user("inv-expired")
    sent = invite(client.email)
    assert sent["expires_at"] > sent["created_at"]
    admin.table("studio_invites").update({"expires_at": PAST}).eq("id", sent["id"]).execute()

    assert api.get(f"/v1/invites/{sent['token']}").status_code == 404
    assert accept(api, sent["token"], client).status_code == 404

    resent = api.post(f"/v1/studios/{world.studio['id']}/invites/{sent['id']}/send", headers=world.designer.headers)
    assert resent.status_code == 200
    assert resent.json()["data"]["token"] == sent["token"] and resent.json()["data"]["expires_at"] > PAST
    assert accept(api, sent["token"], client).status_code == 200
    # An accepted invite stays valid for its client after the expiry date, and cannot be resent.
    admin.table("studio_invites").update({"expires_at": PAST}).eq("id", sent["id"]).execute()
    assert api.get(f"/v1/invites/{sent['token']}").status_code == 200
    assert api.post(f"/v1/studios/{world.studio['id']}/invites/{sent['id']}/send", headers=world.designer.headers).status_code == 409


def test_inviting_the_same_address_again_reuses_one_open_invite(api, world, invite):
    email = unique_email("inv-again")
    first = invite(email, "First name")
    again = invite(email.upper(), "Corrected name")
    assert (again["id"], again["token"]) == (first["id"], first["token"])
    assert again["client_name"] == "Corrected name"

    with ThreadPoolExecutor(5) as pool:  # a double click, or several tabs at once
        email2 = unique_email("inv-race")
        ids = set(pool.map(lambda _: invite(email2)["id"], range(5)))
    assert len(ids) == 1
    listed = api.get(f"/v1/studios/{world.studio['id']}/invites", headers=world.designer.headers).json()["data"]
    assert sum(row["client_email"] == email2 for row in listed) == 1


def test_cancel_kills_the_link_and_hides_it(api, make_user, world, invite):
    client = make_user("inv-cancel")
    sent = invite(client.email)
    url = f"/v1/studios/{world.studio['id']}/invites/{sent['id']}"

    assert api.delete(url, headers=world.designer_b.headers).status_code == 403  # another studio's designer
    other_studio_path = f"/v1/studios/{world.studio_b['id']}/invites/{sent['id']}"
    assert api.delete(other_studio_path, headers=world.designer_b.headers).status_code == 404  # wrong studio in the path
    assert api.delete(url, headers=client.headers).status_code == 403  # the client
    assert api.delete(url).status_code == 401

    assert api.delete(url, headers=world.designer.headers).status_code == 200
    assert api.delete(url, headers=world.designer.headers).status_code == 404  # already cancelled
    assert api.get(f"/v1/invites/{sent['token']}").status_code == 404
    assert accept(api, sent["token"], client).status_code == 404
    assert api.post(f"{url}/send", headers=world.designer.headers).status_code == 404
    listed = api.get(f"/v1/studios/{world.studio['id']}/invites", headers=world.designer.headers).json()["data"]
    assert sent["id"] not in [row["id"] for row in listed]

    fresh = invite(client.email)  # a cancelled invite does not block inviting the client again
    assert fresh["token"] != sent["token"]


def test_an_accepted_invite_cannot_be_cancelled(api, make_user, world, invite):
    client = make_user("inv-accepted")
    sent = invite(client.email)
    assert accept(api, sent["token"], client).status_code == 200
    assert api.delete(f"/v1/studios/{world.studio['id']}/invites/{sent['id']}", headers=world.designer.headers).status_code == 409


def test_resend_and_cancel_reject_malformed_ids(api, world):
    base = f"/v1/studios/{world.studio['id']}/invites"
    assert api.post(f"{base}/not-a-uuid/send", headers=world.designer.headers).status_code == 422
    assert api.delete(f"{base}/{uuid.uuid4()}", headers=world.designer.headers).status_code == 404


def test_a_double_click_sends_one_email(api, monkeypatch, world, invite):
    from app import mailer

    sent = []
    monkeypatch.setattr(mailer, "enabled", lambda: True)
    monkeypatch.setattr(mailer, "send_invite", lambda *args: sent.append(args) or True)
    email = unique_email("inv-double")
    first, second = invite(email), invite(email)
    assert first["emailed"] and second["emailed"] and len(sent) == 1
    resent = api.post(f"/v1/studios/{world.studio['id']}/invites/{first['id']}/send", headers=world.designer.headers)
    assert resent.json()["data"]["emailed"] and len(sent) == 1  # within a minute of the first email


# Only invited clients open projects


def test_only_invited_clients_and_members_can_open_a_project(api, make_user, world, invite):
    stranger, client = make_user("inv-stranger"), make_user("inv-member-client")
    refused = new_project(api, world.studio, stranger)
    assert refused.status_code == 403 and "invitation" in refused.json()["error"]

    token = invite(client.email)["token"]
    assert new_project(api, world.studio, client).status_code == 403  # invited, but not accepted yet
    assert accept(api, token, client).status_code == 200
    assert new_project(api, world.studio, client).status_code == 201
    assert new_project(api, world.studio_b, client).status_code == 403  # the invite is for one studio only

    assert new_project(api, world.studio, world.designer).status_code == 201  # the studio's own designer
