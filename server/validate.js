export const PROMPT_MAX_LENGTH = 100_000;
export const MAX_CHAT_IMAGES = 4;
/** ~1.5MB binary; base64 expands ~4/3 so allow headroom under the JSON body limit. */
export const MAX_IMAGE_BASE64_CHARS = 2_000_000;
export const DEFAULT_IMAGE_CHAT_PROMPT =
  "Please look at the attached image and respond helpfully.";

export class InvalidRequestError extends Error {
  constructor(message, code = "INVALID_REQUEST") {
    super(message);
    this.name = "InvalidRequestError";
    this.status = 400;
    this.code = code;
  }
}

export function validatePrompt(prompt, { maxLength = PROMPT_MAX_LENGTH } = {}) {
  if (prompt === undefined || prompt === null) {
    throw new InvalidRequestError("prompt is required");
  }
  if (typeof prompt !== "string") {
    throw new InvalidRequestError("prompt must be a string");
  }
  const trimmed = prompt.trim();
  if (!trimmed) {
    throw new InvalidRequestError("prompt must not be empty");
  }
  if (prompt.length > maxLength) {
    throw new InvalidRequestError(
      `prompt exceeds maximum length of ${maxLength} characters`,
      "PROMPT_TOO_LONG",
    );
  }
  return trimmed;
}

/**
 * Parse chat image attachments for the Cursor SDK (`{ data, mimeType }`).
 * Accepts either base64 `data` + `mimeType`, or a `dataUrl`.
 *
 * @returns {{ data: string, mimeType: string, name?: string }[]}
 */
export function validateChatImages(images) {
  if (images === undefined || images === null) return [];
  if (!Array.isArray(images)) {
    throw new InvalidRequestError("images must be an array");
  }
  if (images.length > MAX_CHAT_IMAGES) {
    throw new InvalidRequestError(
      `at most ${MAX_CHAT_IMAGES} images are allowed`,
      "TOO_MANY_IMAGES",
    );
  }

  return images.map((img, index) => {
    if (!img || typeof img !== "object") {
      throw new InvalidRequestError(`images[${index}] must be an object`);
    }

    let data =
      typeof img.data === "string" ? img.data.replace(/\s+/g, "") : null;
    let mimeType =
      typeof img.mimeType === "string" ? img.mimeType.trim() : null;
    const name =
      typeof img.name === "string" && img.name.trim()
        ? img.name.trim().slice(0, 200)
        : undefined;

    if ((!data || !mimeType) && typeof img.dataUrl === "string") {
      const match = img.dataUrl
        .replace(/\s+/g, "")
        .match(/^data:([^;,]+);base64,(.+)$/i);
      if (!match) {
        throw new InvalidRequestError(
          `images[${index}].dataUrl must be a base64 data URL`,
        );
      }
      mimeType = mimeType || match[1];
      data = data || match[2];
    }

    if (typeof data === "string" && data.startsWith("data:")) {
      const match = data.match(/^data:([^;,]+);base64,(.+)$/i);
      if (!match) {
        throw new InvalidRequestError(
          `images[${index}].data must be raw base64 or a data URL`,
        );
      }
      mimeType = mimeType || match[1];
      data = match[2];
    }

    if (!data || typeof data !== "string") {
      throw new InvalidRequestError(
        `images[${index}].data is required`,
      );
    }
    if (!mimeType || typeof mimeType !== "string") {
      throw new InvalidRequestError(
        `images[${index}].mimeType is required`,
      );
    }
    if (!mimeType.startsWith("image/")) {
      throw new InvalidRequestError(
        `images[${index}].mimeType must be an image/* type`,
      );
    }
    if (data.length > MAX_IMAGE_BASE64_CHARS) {
      throw new InvalidRequestError(
        `images[${index}] exceeds maximum size`,
        "IMAGE_TOO_LARGE",
      );
    }
    // Sample only — avoid scanning multi-MB strings on every request.
    if (!/^[A-Za-z0-9+/=]+$/.test(data.slice(0, Math.min(data.length, 256)))) {
      throw new InvalidRequestError(
        `images[${index}].data must be base64`,
      );
    }

    return name
      ? { data, mimeType, name }
      : { data, mimeType };
  });
}

/**
 * Validate chat text + optional images. Empty text is allowed when images
 * are present (uses DEFAULT_IMAGE_CHAT_PROMPT).
 *
 * @returns {{ text: string, images: { data: string, mimeType: string, name?: string }[] }}
 */
export function validateChatPayload(prompt, images) {
  const parsedImages = validateChatImages(images);
  const hasImages = parsedImages.length > 0;

  if (prompt === undefined || prompt === null) {
    if (!hasImages) {
      throw new InvalidRequestError("prompt is required");
    }
    return { text: DEFAULT_IMAGE_CHAT_PROMPT, images: parsedImages };
  }
  if (typeof prompt !== "string") {
    throw new InvalidRequestError("prompt must be a string");
  }
  if (prompt.length > PROMPT_MAX_LENGTH) {
    throw new InvalidRequestError(
      `prompt exceeds maximum length of ${PROMPT_MAX_LENGTH} characters`,
      "PROMPT_TOO_LONG",
    );
  }
  const trimmed = prompt.trim();
  if (!trimmed && !hasImages) {
    throw new InvalidRequestError("prompt must not be empty");
  }
  return {
    text: trimmed || DEFAULT_IMAGE_CHAT_PROMPT,
    images: parsedImages,
  };
}

/** Markdown data-URL blocks for feed display (not sent to the agent). */
export function buildDisplayPromptWithImages(text, images) {
  if (!images?.length) return text;
  const blocks = images
    .map((img, i) => {
      const name = img.name || `image-${i + 1}`;
      return `![${name}](data:${img.mimeType};base64,${img.data})`;
    })
    .join("\n\n");
  if (!text || text === DEFAULT_IMAGE_CHAT_PROMPT) return blocks;
  return `${text}\n\n${blocks}`;
}

export function validateCombinedPrompt(userPrompt, augmentedPrompt) {
  validatePrompt(userPrompt);
  if (augmentedPrompt.length > PROMPT_MAX_LENGTH) {
    throw new InvalidRequestError(
      `prompt with dev logs exceeds maximum length of ${PROMPT_MAX_LENGTH} characters`,
      "PROMPT_TOO_LONG",
    );
  }
  return augmentedPrompt;
}

export function validateProjectId(project) {
  if (project === undefined || project === null || project === "") {
    throw new InvalidRequestError("project is required");
  }
  if (typeof project !== "string") {
    throw new InvalidRequestError("project must be a string");
  }
  if (project.includes("..") || project.includes("/") || project.includes("\\")) {
    throw new InvalidRequestError(`unknown project: ${project}`, "UNKNOWN_PROJECT");
  }
  return project.trim();
}

export function validateSessionId(sessionId) {
  if (!sessionId || typeof sessionId !== "string") {
    throw new InvalidRequestError("session id is required");
  }
  return sessionId;
}

export function validateTelegramMessage(message) {
  if (message === undefined || message === null) {
    throw new InvalidRequestError("message is required");
  }
  if (typeof message !== "string") {
    throw new InvalidRequestError("message must be a string");
  }
  const trimmed = message.trim();
  if (!trimmed) {
    throw new InvalidRequestError("message must not be empty");
  }
  if (trimmed.length > 4096) {
    throw new InvalidRequestError(
      "message exceeds Telegram maximum length of 4096 characters",
      "MESSAGE_TOO_LONG",
    );
  }
  return trimmed;
}
