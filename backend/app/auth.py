import logging
from dataclasses import dataclass

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from supabase import Client

from app.db import service, user_client

log = logging.getLogger(__name__)
bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class CurrentUser:
    id: str
    email: str | None
    db: Client  # RLS-scoped: sees only what this user may see

    def role_in(self, studio_id: str) -> str | None:
        rows = self.db.table("studio_memberships").select("role").eq("studio_id", studio_id).execute().data
        return rows[0]["role"] if rows else None


def current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)) -> CurrentUser:
    if credentials is None:
        raise HTTPException(401, "Sign in required")
    try:
        # Verifies signature and expiry against Supabase Auth (JWKS, or the Auth server for HS256).
        response = service().auth.get_claims(jwt=credentials.credentials)
    except Exception as error:
        log.info("Rejected access token: %s", type(error).__name__)
        raise HTTPException(401, "Invalid or expired session") from None
    claims = response["claims"] if response else {}
    if not claims.get("sub") or claims.get("role") != "authenticated" or claims.get("is_anonymous"):
        raise HTTPException(401, "Invalid or expired session")
    return CurrentUser(id=claims["sub"], email=claims.get("email"), db=user_client(credentials.credentials))
