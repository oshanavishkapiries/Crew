import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const source = await readFile(
  new URL("../lib/gates-logic.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
});
const { validateTickets, hasEdits, submissionGuard, ticketFields } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`
);
const ticket = (id, blockedByIds = []) => ({
  id,
  title: id,
  description: "",
  acceptanceCriteria: "",
  blockedByIds,
});
test("ticket approval rejects unknown and cyclic blockers and the 21st ticket", () => {
  assert.match(
    validateTickets([ticket("a", ["missing"])]).join(" "),
    /Unknown blocker/,
  );
  assert.match(
    validateTickets([ticket("a", ["b"]), ticket("b", ["a"])]).join(" "),
    /cycle/,
  );
  assert.match(
    validateTickets(
      Array.from({ length: 21 }, (_, i) => ticket(String(i))),
    ).join(" "),
    /20/,
  );
  assert.deepEqual(validateTickets([ticket("a"), ticket("b", ["a"])]), []);
  assert.match(
    validateTickets([ticket(""), ticket("")]).join(" "),
    /required|Duplicate/,
  );
});
test("edits compare exact text and structured cards; synchronous guard blocks duplicate submissions", () => {
  assert.equal(hasEdits("draft", "draft\n"), true);
  assert.equal(hasEdits([ticket("a")], [ticket("a")]), false);
  assert.equal(hasEdits([ticket("a")], [ticket("b")]), true);
  const guard = submissionGuard();
  assert.equal(guard.enter(), true);
  assert.equal(guard.enter(), false);
  guard.leave();
  assert.equal(guard.enter(), true);
});

test("merged and earlier-phase blockers remain valid without consuming this phase quota", () => {
  const current = Array.from({ length: 20 }, (_, i) =>
    ticket(`current-${i}`, ["earlier"]),
  );
  assert.deepEqual(
    validateTickets(current, { blockers: [ticket("earlier")] }),
    [],
  );
  assert.deepEqual(
    validateTickets(
      Array.from({ length: 21 }, (_, i) => ticket(String(i))),
      { limit: 25 },
    ),
    [],
  );
  assert.match(
    validateTickets([ticket("a", ["earlier"])], {
      blockers: [ticket("earlier", ["a"])],
    }).join(" "),
    /cycle/,
  );
});

test("ticket saves send persisted editable fields only and replace blockers without duplicates", () => {
  assert.deepEqual(ticketFields({ ...ticket("a", ["b", "b"]), role: "backend", status: "todo", boardId: "hidden" }), {
    title: "a", description: "", acceptanceCriteria: "", role: "backend", assignee: "", blockedByIds: ["b"],
  });
});
