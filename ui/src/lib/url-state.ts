import {
  createSerializer,
  parseAsString,
  parseAsStringLiteral,
} from "nuqs";

export const MOBILE_PANELS = ["history", "feed", "instructions"] as const;
export type MobilePanel = (typeof MOBILE_PANELS)[number];

/** Shared URL parsers for the agent console. */
export const consoleUrlParsers = {
  project: parseAsString.withDefault("app"),
  /** Cursor agent / conversation id (omit when starting a fresh chat). */
  agent: parseAsString,
  model: parseAsString,
  tab: parseAsStringLiteral(MOBILE_PANELS).withDefault("feed"),
};

export const serializeConsoleUrl = createSerializer(consoleUrlParsers);
