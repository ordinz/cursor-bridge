import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNamingPrompt,
  nameFromPrompt,
  sanitizeGeneratedName,
} from "./agent-names.js";

test("nameFromPrompt uses first non-empty line", () => {
  assert.equal(nameFromPrompt("\n\nFix login bug\nmore text"), "Fix login bug");
});

test("nameFromPrompt truncates long lines", () => {
  const long = "a".repeat(100);
  const name = nameFromPrompt(long);
  assert.ok(name.endsWith("…"));
  assert.ok(name.length <= 72);
});

test("sanitizeGeneratedName strips quotes and title prefix", () => {
  assert.equal(sanitizeGeneratedName('"Fix Login Bug"'), "Fix Login Bug");
  assert.equal(sanitizeGeneratedName("Title: Dark mode toggle"), "Dark mode toggle");
  assert.equal(sanitizeGeneratedName("**Auth refactor**"), "Auth refactor");
});

test("sanitizeGeneratedName returns null for empty output", () => {
  assert.equal(sanitizeGeneratedName("   \n  "), null);
});

test("buildNamingPrompt includes task and optional excerpt", () => {
  const prompt = buildNamingPrompt({
    prompt: "Add dark mode",
    assistantSnippet: "Updated header.tsx",
  });
  assert.match(prompt, /Add dark mode/);
  assert.match(prompt, /Updated header\.tsx/);
  assert.match(prompt, /3–6 words/);
});
