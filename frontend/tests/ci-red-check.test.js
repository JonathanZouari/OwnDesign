import { test } from "node:test";
import assert from "node:assert/strict";

test("deliberate failure to prove the pull request check goes red", () => assert.fail("expected"));
