import {
  downloadTelegramFile,
  TelegramSendError,
} from "./telegram.js";

const DEFAULT_IMAGE_PROMPT =
  "Please look at the attached image and respond helpfully.";

const IMAGE_MIME_BY_EXT = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
};

/**
 * @param {string|undefined|null} filePath
 * @param {string|undefined|null} fallback
 */
export function guessMimeFromPath(filePath, fallback = "application/octet-stream") {
  if (!filePath || typeof filePath !== "string") return fallback;
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  if (IMAGE_MIME_BY_EXT[ext]) return IMAGE_MIME_BY_EXT[ext];
  if (ext === "ogg" || ext === "oga") return "audio/ogg";
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "m4a") return "audio/mp4";
  if (ext === "wav") return "audio/wav";
  return fallback;
}

/**
 * Pick the highest-resolution Telegram photo size.
 * @param {Array<{ file_id: string, width?: number, height?: number, file_size?: number }>|undefined} photos
 */
export function pickBestPhoto(photos) {
  if (!Array.isArray(photos) || !photos.length) return null;
  return photos.reduce((best, cur) => {
    const bestScore =
      (best.file_size ?? 0) || (best.width ?? 0) * (best.height ?? 0);
    const curScore =
      (cur.file_size ?? 0) || (cur.width ?? 0) * (cur.height ?? 0);
    return curScore >= bestScore ? cur : best;
  });
}

/**
 * Describe inbound media on a Telegram message (does not download).
 * @param {object} message
 * @returns {{
 *   kind: "photo"|"voice"|"audio"|"image_document",
 *   fileId: string,
 *   mimeType: string|null,
 *   fileName: string|null,
 *   duration: number|null,
 *   width: number|null,
 *   height: number|null,
 * }|null}
 */
export function extractTelegramMedia(message) {
  if (!message || typeof message !== "object") return null;

  const photo = pickBestPhoto(message.photo);
  if (photo?.file_id) {
    return {
      kind: "photo",
      fileId: String(photo.file_id),
      mimeType: "image/jpeg",
      fileName: null,
      duration: null,
      width: typeof photo.width === "number" ? photo.width : null,
      height: typeof photo.height === "number" ? photo.height : null,
    };
  }

  if (message.voice?.file_id) {
    return {
      kind: "voice",
      fileId: String(message.voice.file_id),
      mimeType: message.voice.mime_type || "audio/ogg",
      fileName: "voice.ogg",
      duration:
        typeof message.voice.duration === "number"
          ? message.voice.duration
          : null,
      width: null,
      height: null,
    };
  }

  if (message.audio?.file_id) {
    return {
      kind: "audio",
      fileId: String(message.audio.file_id),
      mimeType: message.audio.mime_type || "audio/mpeg",
      fileName: message.audio.file_name || "audio",
      duration:
        typeof message.audio.duration === "number"
          ? message.audio.duration
          : null,
      width: null,
      height: null,
    };
  }

  const doc = message.document;
  if (doc?.file_id) {
    const mime =
      typeof doc.mime_type === "string" ? doc.mime_type : "";
    const name =
      typeof doc.file_name === "string" ? doc.file_name : "";
    const looksImage =
      mime.startsWith("image/") ||
      /\.(jpe?g|png|gif|webp|bmp|tiff?)$/i.test(name);
    if (looksImage) {
      return {
        kind: "image_document",
        fileId: String(doc.file_id),
        mimeType: mime || null,
        fileName: name || null,
        duration: null,
        width: null,
        height: null,
      };
    }
  }

  return null;
}

/**
 * @returns {{ apiKey: string, baseUrl: string, model: string }|null}
 */
export function getWhisperConfig() {
  const apiKey =
    process.env.TELEGRAM_WHISPER_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    "";
  if (!apiKey) return null;
  const baseUrl = (
    process.env.TELEGRAM_WHISPER_BASE_URL?.trim() ||
    process.env.OPENAI_BASE_URL?.trim() ||
    "https://api.openai.com/v1"
  ).replace(/\/$/, "");
  const model =
    process.env.TELEGRAM_WHISPER_MODEL?.trim() || "whisper-1";
  return { apiKey, baseUrl, model };
}

/**
 * Transcribe a voice/audio buffer with an OpenAI-compatible Whisper API.
 * @param {{ buffer: Buffer, mimeType?: string|null, fileName?: string|null }} opts
 * @returns {Promise<string>}
 */
export async function transcribeAudio(opts) {
  const cfg = getWhisperConfig();
  if (!cfg) {
    throw new TelegramSendError(
      "Voice notes need OPENAI_API_KEY (or TELEGRAM_WHISPER_API_KEY) for Whisper transcription",
    );
  }

  const mimeType = opts.mimeType || "audio/ogg";
  const fileName = opts.fileName || "voice.ogg";
  const form = new FormData();
  form.append(
    "file",
    new Blob([opts.buffer], { type: mimeType }),
    fileName,
  );
  form.append("model", cfg.model);

  const res = await fetch(`${cfg.baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
    body: form,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail =
      typeof data.error?.message === "string"
        ? data.error.message
        : typeof data.message === "string"
          ? data.message
          : `HTTP ${res.status}`;
    throw new TelegramSendError(`Whisper transcription failed: ${detail}`);
  }

  const text = typeof data.text === "string" ? data.text.trim() : "";
  if (!text) {
    throw new TelegramSendError("Whisper returned empty transcription");
  }
  return text;
}

/**
 * Download inbound Telegram media and build an agent prompt payload.
 *
 * @param {object} message Telegram message
 * @param {string} captionOrText Caption / text already extracted (may be empty)
 * @returns {Promise<{
 *   text: string,
 *   images?: { data: string, mimeType: string, dimension?: { width: number, height: number } }[],
 *   mediaKind: string|null,
 *   transcription?: string,
 * }>}
 */
export async function resolveTelegramInboundContent(message, captionOrText = "") {
  const caption =
    typeof captionOrText === "string" ? captionOrText.trim() : "";
  const media = extractTelegramMedia(message);

  if (!media) {
    return { text: caption, images: undefined, mediaKind: null };
  }

  const downloaded = await downloadTelegramFile(media.fileId);
  const mimeType =
    media.mimeType ||
    guessMimeFromPath(downloaded.filePath, "application/octet-stream");

  if (media.kind === "photo" || media.kind === "image_document") {
    const images = [
      {
        data: downloaded.buffer.toString("base64"),
        mimeType: mimeType.startsWith("image/") ? mimeType : "image/jpeg",
        ...(media.width && media.height
          ? { dimension: { width: media.width, height: media.height } }
          : {}),
      },
    ];
    return {
      text: caption || DEFAULT_IMAGE_PROMPT,
      images,
      mediaKind: media.kind,
    };
  }

  if (media.kind === "voice" || media.kind === "audio") {
    const transcription = await transcribeAudio({
      buffer: downloaded.buffer,
      mimeType,
      fileName: media.fileName || guessFileName(downloaded.filePath, "voice.ogg"),
    });
    const text = caption
      ? `${caption}\n\n(voice transcript): ${transcription}`
      : transcription;
    return {
      text,
      images: undefined,
      mediaKind: media.kind,
      transcription,
    };
  }

  return { text: caption, images: undefined, mediaKind: media.kind };
}

function guessFileName(filePath, fallback) {
  if (!filePath) return fallback;
  const base = filePath.split("/").pop();
  return base || fallback;
}

export { DEFAULT_IMAGE_PROMPT };
