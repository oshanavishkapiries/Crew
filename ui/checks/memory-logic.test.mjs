import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const source = await readFile(
  new URL("../lib/memory-logic.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
});
const { memoryScope, canPromote } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`
);
test("memory creation sends only the selected layer scope, requiring role/task selection", () => {
  assert.deepEqual(memoryScope("role", "r", "old-task"), { roleId: "r" });
  assert.deepEqual(memoryScope("task", "old-role", "t"), { taskId: "t" });
  assert.deepEqual(memoryScope("project", "old-role", "old-task"), {});
  assert.throws(() => memoryScope("role", "", ""), /role/);
  assert.throws(() => memoryScope("task", "", ""), /task/);
  assert.throws(() => memoryScope("other", "", ""), /layer/);
});
test("only an unpromoted role learning can be promoted by the human", () => {
  assert.equal(canPromote({ layer: "role", promotedAt: null }), true);
  assert.equal(canPromote({ layer: "role", promotedAt: "now" }), false);
  assert.equal(canPromote({ layer: "task", promotedAt: null }), false);
  assert.equal(canPromote({ layer: "project", promotedAt: null }), false);
});
