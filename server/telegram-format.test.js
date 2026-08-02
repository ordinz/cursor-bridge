import test from "node:test";
import assert from "node:assert/strict";
import { markdownToTelegramHtml, buildTelegramRichContent } from "./telegram-format.js";

test("markdownToTelegramHtml renders bold and code", () => {
  const html = markdownToTelegramHtml("On branch **main** with `origin/main`");
  assert.match(html, /<b>main<\/b>/);
  assert.match(html, /<code>origin\/main<\/code>/);
});

test("markdownToTelegramHtml wraps git-status style dumps in pre", () => {
  const md = [
    "On branch **main**, up to date with `origin/main`.",
    "",
    "**Modified (unstaged):**",
    "- `.env.example`",
    "- `README.md`",
    "- `bridge.mjs`",
    "- `package.json`",
    "",
    "**Untracked:**",
    "- `server/telegram-draft.js`",
    "- `server/telegram-format.js`",
    "",
    "Nothing staged.",
  ].join("\n");
  const html = markdownToTelegramHtml(md);
  assert.match(html, /<pre>/);
  assert.doesNotMatch(html, /\*\*/);
  assert.match(html, /README\.md/);
});

test("fenced code blocks become pre", () => {
  const html = markdownToTelegramHtml("Intro\n\n```bash\ngit status\n```\n");
  assert.match(html, /<pre>git status<\/pre>/);
});

test("buildTelegramRichContent returns html + plain", () => {
  const { html, plainFallback } = buildTelegramRichContent("**hi**");
  assert.match(html, /<b>hi<\/b>/);
  assert.equal(plainFallback, "**hi**");
});
