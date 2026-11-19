// The app loads shared/*.js from web/shared/ so it works when bundled into the
// iOS/Android shell (Capacitor copies web/ only). This keeps the copy identical
// to the source. Runs before start/test; `npm run check` fails if they drift.
import { copyFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = ["analysis.js", "grading.js", "outcomes.js", "model.js"];
const check = process.argv.includes("--check");
mkdirSync(join(root, "web", "shared"), { recursive: true });
let drift = [];
for (const f of FILES) {
  const src = join(root, "shared", f), dst = join(root, "web", "shared", f);
  if (check) {
    if (!existsSync(dst) || readFileSync(src, "utf8") !== readFileSync(dst, "utf8")) drift.push(f);
  } else copyFileSync(src, dst);
}
if (check && drift.length) { console.error(`web/shared is out of date: ${drift.join(", ")}. Run npm run sync.`); process.exit(1); }
console.log(check ? "web/shared matches shared/" : `synced ${FILES.length} files → web/shared/`);
