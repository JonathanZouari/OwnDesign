"""A stand-in for Groq. No test and no browser journey calls the real API."""

import asyncio

# Replies the browser journeys script and then look for on the page.
ENGLISH_REPLY = ["A warm oak floor ", "pairs well with ", "a linen sofa in ", "the living room."]
HEBREW_REPLY = ["שלום! ", "ספה בצבע אפור ", "תתאים לסלון של 3.5 מ' ", "(Kvadrat 2.4)."]


class FakeLlm:
    """Streams `pieces`, optionally slowly, failing, or hanging. Records what it was asked and whether it was closed."""

    def __init__(self, pieces=(), *, delay=0.0, fail_at=None, error=None, hang_at=None, finish_reason=None):
        self.pieces = list(pieces)
        self.delay = delay
        self.fail_at = fail_at  # raise `error` before yielding the piece at this index
        self.error = error
        self.hang_at = hang_at  # never produce the piece at this index
        self.finish_reason = finish_reason  # sent with the last piece
        self.calls: list[list[dict]] = []
        self.closed = 0

    def stream(self, messages):
        self.calls.append(messages)
        return self._run()

    async def _run(self):
        try:
            for index, text in enumerate(self.pieces):
                if index == self.fail_at:
                    raise self.error
                if index == self.hang_at:
                    await asyncio.sleep(3600)
                if self.delay:
                    await asyncio.sleep(self.delay)
                last = index == len(self.pieces) - 1
                yield text, (self.finish_reason if last else None)
            if self.fail_at == len(self.pieces):
                raise self.error
        finally:
            self.closed += 1
