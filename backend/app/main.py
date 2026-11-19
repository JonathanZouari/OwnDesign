import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.db import settings
from app.responses import fail, ok
from app.routes import projects, studios

log = logging.getLogger(__name__)
MAX_BODY_BYTES = 2_000_000  # a full 1000-item plan is well under this

app = FastAPI(title="OwnDesign API", version="1")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings().allowed_origins.split(",") if origin.strip()],
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)
app.include_router(studios.router)
app.include_router(projects.router)


@app.middleware("http")
async def limit_body_size(request: Request, call_next):
    # shortcut: trusts Content-Length, so chunked uploads are not capped; enforce at the proxy when deployed.
    if int(request.headers.get("content-length") or 0) > MAX_BODY_BYTES:
        return JSONResponse(fail("Request too large"), status_code=413)
    return await call_next(request)


@app.exception_handler(HTTPException)
async def http_error(_: Request, error: HTTPException):
    return JSONResponse(fail(str(error.detail)), status_code=error.status_code)


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, error: RequestValidationError):
    first = error.errors()[0]
    where = ".".join(str(part) for part in first["loc"] if part != "body")
    return JSONResponse(fail(f"Invalid input ({where}): {first['msg']}"), status_code=422)


@app.exception_handler(Exception)
async def unexpected_error(request: Request, error: Exception):
    log.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(fail("Something went wrong. Please try again."), status_code=500)


@app.get("/health")
def health():
    return ok({"status": "ok"})
