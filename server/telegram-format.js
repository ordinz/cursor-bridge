/**
 * Convert assistant markdown into Telegram rich-message HTML.
 * Prefers scannable structure: headings, bold, and <pre> for code / file dumps.
 */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** True if a chunk looks like a dense path / git status dump. */
function looksLikeDump(text) {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 3) return false;
  const pathish = lines.filter((l) =>
    /^[\s*-]*`?[A-Za-z0-9_./@+-]+\.[A-Za-z0-9]+`?\s*$/.test(l.trim()) ||
    /^[\s*-]+`[^`]+`\s*$/.test(l.trim()) ||
    /^\s*(modified|untracked|staged|deleted|renamed|new file):/i.test(l) ||
    /^\s*On branch\b/i.test(l),
  ).length;
  return pathish / lines.length >= 0.35 || /On branch\b/i.test(text);
}

/**
 * @param {string} markdown
 * @returns {string} rich HTML
 */
export function markdownToTelegramHtml(markdown) {
  let src = String(markdown ?? "").trim();
  if (!src) return "<i>(empty)</i>";

  // If the whole reply is a status/dump, one clean pre block is most readable.
  if (looksLikeDump(src) && !src.includes("```")) {
    return `<pre>${escapeHtml(src.replace(/\*\*/g, "").replace(/`/g, ""))}</pre>`;
  }

  // Extract fenced code blocks first
  /** @type {string[]} */
  const fences = [];
  src = src.replace(/```[\w+-]*\n?([\s\S]*?)```/g, (_m, code) => {
    const i = fences.length;
    fences.push(`<pre>${escapeHtml(code.replace(/\n$/, ""))}</pre>`);
    return `\n%%FENCE_${i}%%\n`;
  });

  const lines = src.split("\n");
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  let listBuf = [];
  /** @type {string[]} */
  let dumpBuf = [];

  const flushList = () => {
    if (!listBuf.length) return;
    out.push(
      `<ul>${listBuf.map((item) => `<li>${formatInline(item)}</li>`).join("")}</ul>`,
    );
    listBuf = [];
  };

  const flushDump = () => {
    if (!dumpBuf.length) return;
    const plain = dumpBuf
      .join("\n")
      .replace(/\*\*/g, "")
      .replace(/`/g, "");
    out.push(`<pre>${escapeHtml(plain)}</pre>`);
    dumpBuf = [];
  };

  for (const rawLine of lines) {
    const fence = rawLine.match(/^%%FENCE_(\d+)%%$/);
    if (fence) {
      flushList();
      flushDump();
      out.push(fences[Number(fence[1])] ?? "");
      continue;
    }

    const line = rawLine;

    // Collect consecutive path-like bullets into one <pre>
    if (
      /^[\s]*[-*]\s+`[^`]+`\s*$/.test(line) ||
      /^[\s]*[-*]\s+[A-Za-z0-9_./@+-]+\.[A-Za-z0-9]+\s*$/.test(line)
    ) {
      flushList();
      const item = line.replace(/^[\s]*[-*]\s+/, "").replace(/^`|`$/g, "");
      dumpBuf.push(item);
      continue;
    }
    if (dumpBuf.length) flushDump();

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushList();
      const level = Math.min(heading[1].length + 1, 4); // h2–h5
      out.push(`<h${level}>${formatInline(heading[2])}</h${level}>`);
      continue;
    }

    const bullet = line.match(/^[\s]*[-*]\s+(.+)$/);
    if (bullet) {
      listBuf.push(bullet[1]);
      continue;
    }
    flushList();

    if (!line.trim()) {
      continue;
    }

    // Section labels like **Modified:**
    const label = line.match(/^\*\*(.+?)\*\*\s*$/);
    if (label) {
      out.push(`<p><b>${escapeHtml(label[1])}</b></p>`);
      continue;
    }

    out.push(`<p>${formatInline(line)}</p>`);
  }
  flushList();
  flushDump();

  return out.join("\n") || `<pre>${escapeHtml(src)}</pre>`;
}

/** Inline: bold, italic, code — order matters. */
function formatInline(text) {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  s = s.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<i>$1</i>");
  return s;
}

/**
 * Build rich payload for sendRichMessage / draft.
 * @param {string} text
 * @returns {{ html: string, plainFallback: string }}
 */
export function buildTelegramRichContent(text) {
  const plainFallback = String(text ?? "");
  try {
    return {
      html: markdownToTelegramHtml(plainFallback),
      plainFallback,
    };
  } catch {
    return {
      html: `<pre>${escapeHtml(plainFallback)}</pre>`,
      plainFallback,
    };
  }
}
