"""The backend the browser journeys run against: the real app, with OpenAI replaced by a scripted fake.

It is only ever started by tests/test_e2e.py. Nothing here is imported by the application.
The question decides what the fake does, so one server serves every journey:

    Hebrew letters in the question  -> a Hebrew reply
    "[error]" in the question        -> two pieces, then OpenAI fails
    "[flaky]" in the question        -> fails on the first attempt for that exact question, works on the next
    anything else                    -> an English reply
"""

import re

import httpx
import openai

from app.advisor import get_llm
from app.main import app
from tests.fake_llm import ENGLISH_REPLY, HEBREW_REPLY, FakeLlm

DELAY_S = 0.45  # long enough for a browser test to see the typing indicator and a half-written reply
HEBREW_LETTER = re.compile(f"[{chr(0x590)}-{chr(0x5FF)}]")  # the Hebrew Unicode block

_attempts: dict[str, int] = {}


def _failure() -> openai.APIError:
    return openai.APIError("simulated failure", request=httpx.Request("POST", "https://example.invalid"), body=None)


class ScriptedLlm:
    def stream(self, messages):
        question = messages[-1]["content"]
        _attempts[question] = _attempts.get(question, 0) + 1
        if "[error]" in question or ("[flaky]" in question and _attempts[question] == 1):
            return FakeLlm(ENGLISH_REPLY, delay=DELAY_S, fail_at=2, error=_failure()).stream(messages)
        pieces = HEBREW_REPLY if HEBREW_LETTER.search(question) else ENGLISH_REPLY
        return FakeLlm(pieces, delay=DELAY_S).stream(messages)


app.dependency_overrides[get_llm] = lambda: ScriptedLlm()
