export type ParsedMessageImage = {
  name: string;
  dataUrl: string;
};

export type ParsedMessageContent = {
  text: string;
  images: ParsedMessageImage[];
};

const MD_IMAGE_RE =
  /!\[([^\]]*)\]\((data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+)\)/g;
/** Fallback when markdown syntax is broken but a data URL remains. */
const BARE_DATA_IMAGE_RE =
  /(data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]{80,})/g;
const ATTACHED_NOTE_RE = /^\(Attached image:\s*(.+)\)\s*$/gm;
const ORPHAN_BANG_BRACKET_RE = /^!\s*$/gm;

/**
 * Split prompt text that may contain markdown data-URL images into
 * display text + image attachments (so the feed never dumps base64).
 */
export function parseMessageAttachments(raw: string): ParsedMessageContent {
  const images: ParsedMessageImage[] = [];

  let text = raw.replace(
    MD_IMAGE_RE,
    (_match, alt: string, dataUrl: string) => {
      const cleaned = dataUrl.replace(/\s+/g, "");
      images.push({
        name: (alt || "image").trim() || "image",
        dataUrl: cleaned,
      });
      return "";
    },
  );

  text = text.replace(BARE_DATA_IMAGE_RE, (dataUrl) => {
    const cleaned = dataUrl.replace(/\s+/g, "");
    if (!images.some((img) => img.dataUrl === cleaned)) {
      images.push({ name: "image", dataUrl: cleaned });
    }
    return "";
  });

  text = text
    .replace(ATTACHED_NOTE_RE, "")
    .replace(ORPHAN_BANG_BRACKET_RE, "")
    .replace(/^\[[^\]]+\.jpe?g\]\s*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { text, images };
}
