import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const pkg = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"),
    "utf8",
  ),
);

export const VERSION = pkg.version;
