import test from "node:test";
import assert from "node:assert/strict";
import { useTempBridgeDb } from "./test-db.js";

useTempBridgeDb();

const {
  mainControlKeyboard,
  modelPickerKeyboard,
  openUiKeyboard,
  parseCallbackData,
  postRunKeyboard,
  settingsKeyboard,
} = await import("./telegram-keyboards.js");
const { _setTelegramModelsForTests } = await import("./telegram-models.js");
const {
  _resetTelegramPrefsForTests,
  getTelegramPrefs,
  updateTelegramPrefs,
} = await import("./telegram-prefs.js");

test("parseCallbackData covers control ops", () => {
  assert.deepEqual(parseCallbackData("c:phone"), { op: "phone" });
  assert.deepEqual(parseCallbackData("c:mode:plan"), {
    op: "mode",
    arg: "plan",
  });
  assert.deepEqual(parseCallbackData("c:mdl:3"), { op: "mdl", arg: "3" });
  assert.equal(parseCallbackData("c:mdl:abc"), null);
  assert.equal(parseCallbackData("nope"), null);
});

test("keyboards stay within Telegram callback_data limit", () => {
  const main = mainControlKeyboard({ phoneOn: true });
  const settings = settingsKeyboard({
    mode: "plan",
    model: "composer-2.5",
    includeDevLogs: true,
  });
  const models = modelPickerKeyboard(
    [
      { id: "default", displayName: "Auto" },
      { id: "composer-2.5", displayName: "Composer 2.5" },
    ],
    "composer-2.5",
  );
  const post = postRunKeyboard({ busy: true });

  for (const kb of [main, settings, models, post]) {
    for (const row of kb.inline_keyboard) {
      for (const button of row) {
        if (button.callback_data) {
          assert.ok(button.callback_data.length <= 64, button.callback_data);
        }
        assert.ok(button.text.length > 0);
      }
    }
  }

  assert.match(main.inline_keyboard[0][0].text, /Phone ON/);
  assert.match(settings.inline_keyboard[0][1].text, /● plan/);
  assert.match(settings.inline_keyboard[2][0].text, /☑ Dev logs/);
});

test("postRunKeyboard adds Open in UI url button when agent known", () => {
  const prev = process.env.BRIDGE_UI_ORIGIN;
  process.env.BRIDGE_UI_ORIGIN = "https://ordins-cursor-bridge.kairose.com";
  const kb = postRunKeyboard({
    busy: false,
    project: "app",
    agentId: "agent-1",
  });
  const open = kb.inline_keyboard.flat().find((b) => b.text === "Open in UI");
  assert.ok(open);
  assert.equal(
    open.url,
    "https://ordins-cursor-bridge.kairose.com/?project=app&agent=agent-1&tab=feed",
  );
  assert.equal(open.callback_data, undefined);
  if (prev === undefined) delete process.env.BRIDGE_UI_ORIGIN;
  else process.env.BRIDGE_UI_ORIGIN = prev;
});

test("openUiKeyboard is url-only", () => {
  const kb = openUiKeyboard({
    project: "www",
    agentId: "agent-2",
    uiUrl: "https://example.com/?project=www&agent=agent-2",
  });
  assert.equal(kb.inline_keyboard.length, 1);
  assert.equal(kb.inline_keyboard[0][0].text, "Open in UI");
  assert.match(kb.inline_keyboard[0][0].url, /example\.com/);
});

test("telegram prefs update model/mode/logs", () => {
  _resetTelegramPrefsForTests({
    model: "default",
    mode: "agent",
    includeDevLogs: false,
  });
  updateTelegramPrefs({ mode: "plan", model: "composer-2", includeDevLogs: true });
  const prefs = getTelegramPrefs();
  assert.equal(prefs.mode, "plan");
  assert.equal(prefs.model, "composer-2");
  assert.equal(prefs.includeDevLogs, true);
  updateTelegramPrefs({ mode: "ask" });
  assert.equal(getTelegramPrefs().mode, "agent");
  _resetTelegramPrefsForTests(null);
});

test("model cache helper accepts test overrides", () => {
  _setTelegramModelsForTests([{ id: "x", displayName: "X Model" }]);
  const kb = modelPickerKeyboard(
    [{ id: "x", displayName: "X Model" }],
    "x",
  );
  assert.match(kb.inline_keyboard[0][0].text, /● X Model/);
});
