"""The backend the browser journeys run against: the real app, with Groq replaced by a scripted fake
and upstream's OpenAI consultant switched off (503).

It is only ever started by tests/test_e2e.py. Nothing here is imported by the application.
The question decides what the fake does, so one server serves every journey:

    Hebrew letters in the question  -> a Hebrew reply
    "[error]" in the question        -> two pieces, then Groq fails
    "[flaky]" in the question        -> fails on the first attempt for that exact question, works on the next
    "[busy]" in the question         -> Groq's rate limit (429) before any text on the first attempt, works on the next
    "[busy-late]" in the question    -> two pieces, then the rate limit on the first attempt, works on the next
                                        (simulated: the real SDK reports a limit inside an open stream as a plain APIError)
    anything else                    -> an English reply
"""

import re

import httpx
import httpx2
import openai

from app.advisor import get_llm
from app.main import app
from app.routes.consultant import get_openai
from tests.fake_llm import ENGLISH_REPLY, HEBREW_REPLY, FakeLlm

DELAY_S = 0.45  # long enough for a browser test to see the typing indicator and a half-written reply
HEBREW_LETTER = re.compile(f"[{chr(0x590)}-{chr(0x5FF)}]")  # the Hebrew Unicode block

_attempts: dict[str, int] = {}


def _failure() -> openai.APIError:
    return openai.APIError("simulated failure", request=httpx.Request("POST", "https://example.invalid"), body=None)


def _rate_limited() -> openai.RateLimitError:
    request = httpx2.Request("POST", "https://example.invalid")
    return openai.RateLimitError("simulated rate limit", response=httpx2.Response(429, request=request), body=None)


class ScriptedLlm:
    def stream(self, messages):
        question = messages[-1]["content"]
        _attempts[question] = _attempts.get(question, 0) + 1
        first_attempt = _attempts[question] == 1
        pieces = HEBREW_REPLY if HEBREW_LETTER.search(question) else ENGLISH_REPLY
        if "[busy-late]" in question and first_attempt:
            return FakeLlm(pieces, delay=DELAY_S, fail_at=2, error=_rate_limited()).stream(messages)
        if "[busy]" in question and first_attempt:
            return FakeLlm(pieces, delay=DELAY_S, fail_at=0, error=_rate_limited()).stream(messages)
        if "[error]" in question or ("[flaky]" in question and first_attempt):
            return FakeLlm(ENGLISH_REPLY, delay=DELAY_S, fail_at=2, error=_failure()).stream(messages)
        return FakeLlm(pieces, delay=DELAY_S).stream(messages)


app.dependency_overrides[get_llm] = lambda: ScriptedLlm()
# Upstream's consultant calls OpenAI (paid). Here it is switched off, so no browser journey can reach it
# even if backend/.env holds a key: its endpoint answers 503.
app.dependency_overrides[get_openai] = lambda: None
