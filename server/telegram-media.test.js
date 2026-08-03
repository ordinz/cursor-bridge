import test from "node:test";
import assert from "node:assert/strict";
import {
  extractTelegramMedia,
  getWhisperConfig,
  guessMimeFromPath,
  pickBestPhoto,
  DEFAULT_IMAGE_PROMPT,
} from "./telegram-media.js";

test("pickBestPhoto chooses largest file_size", () => {
  const best = pickBestPhoto([
    { file_id: "a", width: 90, height: 90, file_size: 100 },
    { file_id: "b", width: 1280, height: 720, file_size: 50_000 },
    { file_id: "c", width: 320, height: 180, file_size: 2_000 },
  ]);
  assert.equal(best.file_id, "b");
});

test("guessMimeFromPath maps common extensions", () => {
  assert.equal(guessMimeFromPath("photos/file_1.jpg"), "image/jpeg");
  assert.equal(guessMimeFromPath("voice/file_2.oga"), "audio/ogg");
  assert.equal(guessMimeFromPath("x.webp"), "image/webp");
});

test("extractTelegramMedia reads photo caption-less messages", () => {
  const media = extractTelegramMedia({
    photo: [
      { file_id: "small", width: 90, height: 90, file_size: 10 },
      { file_id: "big", width: 800, height: 600, file_size: 40_000 },
    ],
  });
  assert.equal(media?.kind, "photo");
  assert.equal(media?.fileId, "big");
  assert.equal(media?.mimeType, "image/jpeg");
});

test("extractTelegramMedia reads voice notes", () => {
  const media = extractTelegramMedia({
    voice: {
      file_id: "voice-1",
      duration: 4,
      mime_type: "audio/ogg",
    },
  });
  assert.equal(media?.kind, "voice");
  assert.equal(media?.fileId, "voice-1");
  assert.equal(media?.duration, 4);
});

test("extractTelegramMedia accepts image documents", () => {
  const media = extractTelegramMedia({
    document: {
      file_id: "doc-1",
      file_name: "shot.PNG",
      mime_type: "image/png",
    },
  });
  assert.equal(media?.kind, "image_document");
  assert.equal(media?.fileId, "doc-1");
});

test("extractTelegramMedia ignores non-image documents", () => {
  assert.equal(
    extractTelegramMedia({
      document: {
        file_id: "doc-2",
        file_name: "notes.pdf",
        mime_type: "application/pdf",
      },
    }),
    null,
  );
});

test("extractTelegramMedia returns null for text-only", () => {
  assert.equal(extractTelegramMedia({ text: "hello" }), null);
});

test("getWhisperConfig reads env keys", () => {
  const prevKey = process.env.OPENAI_API_KEY;
  const prevTg = process.env.TELEGRAM_WHISPER_API_KEY;
  const prevBase = process.env.OPENAI_BASE_URL;
  const prevModel = process.env.TELEGRAM_WHISPER_MODEL;
  delete process.env.OPENAI_API_KEY;
  delete process.env.TELEGRAM_WHISPER_API_KEY;
  delete process.env.OPENAI_BASE_URL;
  delete process.env.TELEGRAM_WHISPER_MODEL;

  assert.equal(getWhisperConfig(), null);

  process.env.OPENAI_API_KEY = "sk-test";
  const cfg = getWhisperConfig();
  assert.equal(cfg?.apiKey, "sk-test");
  assert.equal(cfg?.baseUrl, "https://api.openai.com/v1");
  assert.equal(cfg?.model, "whisper-1");

  process.env.TELEGRAM_WHISPER_API_KEY = "sk-tg";
  process.env.TELEGRAM_WHISPER_MODEL = "whisper-large-v3";
  process.env.OPENAI_BASE_URL = "https://api.groq.com/openai/v1/";
  const cfg2 = getWhisperConfig();
  assert.equal(cfg2?.apiKey, "sk-tg");
  assert.equal(cfg2?.baseUrl, "https://api.groq.com/openai/v1");
  assert.equal(cfg2?.model, "whisper-large-v3");

  if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = prevKey;
  if (prevTg === undefined) delete process.env.TELEGRAM_WHISPER_API_KEY;
  else process.env.TELEGRAM_WHISPER_API_KEY = prevTg;
  if (prevBase === undefined) delete process.env.OPENAI_BASE_URL;
  else process.env.OPENAI_BASE_URL = prevBase;
  if (prevModel === undefined) delete process.env.TELEGRAM_WHISPER_MODEL;
  else process.env.TELEGRAM_WHISPER_MODEL = prevModel;
});

test("DEFAULT_IMAGE_PROMPT is non-empty", () => {
  assert.ok(DEFAULT_IMAGE_PROMPT.length > 10);
});
