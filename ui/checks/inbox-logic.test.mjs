import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const source = await readFile(
  new URL("../lib/inbox-logic.ts", import.meta.url),
  "utf8",
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
});
const { openQuestion } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);
test("inbox excludes dependency blocks and answered questions; selects latest unanswered ask", () => {
  const q = { id: "q", type: "question" },
    a = { type: "answer" },
    next = { id: "next", type: "question" };
  assert.equal(openQuestion("blocked", []), undefined);
  assert.equal(openQuestion("doing", [q]), undefined);
  assert.equal(openQuestion("blocked", [q, a]), undefined);
  assert.equal(openQuestion("blocked", [q, a, next]), next);
  assert.equal(openQuestion("blocked", [q, { type: "comment" }]), q);
});
