// Shiny portfolio export loader — uploads/ShinyExport.csv is the real ID map:
// every single carries a tcgplayer_id + pricecharting_id and a current
// value_per_unit. The pricing job polls PriceCharting by those ids, and the
// values double as smoke-test fixtures.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export interface ShinyRow {
  name: string;        // product_name
  set: string;         // set_name
  rarity: string;
  quantity: number;
  valuePerUnit: number; // current market value, USD
  paidPerUnit: number;
  tcgId: string | null;
  pcId: string | null;  // pricecharting_id
  gradeType: string;    // 'Ungraded' | 'PSA' | ...
  gradeSubtype: string; // 'Near Mint' | '10' | ...
  sealed: boolean;
}

/** Minimal quote-aware CSV line parser. */
function parseLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function defaultCsvPath(): string | null {
  if (process.env.SHINY_CSV && existsSync(process.env.SHINY_CSV)) return process.env.SHINY_CSV;
  const here = dirname(fileURLToPath(import.meta.url));
  for (const p of [
    join(here, "..", "..", "uploads", "ShinyExport.csv"), // repo root, from backend/src
    join(process.cwd(), "uploads", "ShinyExport.csv"),
    join(process.cwd(), "..", "uploads", "ShinyExport.csv"),
  ]) {
    if (existsSync(p)) return p;
  }
  return null;
}

export function loadShinyRows(csvPath?: string): ShinyRow[] {
  const path = csvPath ?? defaultCsvPath();
  if (!path) return [];
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = parseLine(lines[0]);
  const col = (name: string) => header.indexOf(name);
  const iName = col("product_name"), iSet = col("set_name"), iRarity = col("rarity"),
    iQty = col("quantity"), iVal = col("value_per_unit"), iPaid = col("paid_per_unit"),
    iTcg = col("tcgplayer_id"), iPc = col("pricecharting_id"),
    iGt = col("grade_type"), iGs = col("grade_subtype");
  const rows: ShinyRow[] = [];
  for (const line of lines.slice(1)) {
    const f = parseLine(line);
    if (f.length < header.length - 1) continue;
    const idOf = (i: number) => (f[i] && f[i] !== "null" ? f[i] : null);
    rows.push({
      name: f[iName] ?? "",
      set: f[iSet] ?? "",
      rarity: f[iRarity] ?? "",
      quantity: Number(f[iQty]) || 0,
      valuePerUnit: Number(f[iVal]) || 0,
      paidPerUnit: Number(f[iPaid]) || 0,
      tcgId: idOf(iTcg),
      pcId: idOf(iPc),
      gradeType: f[iGt] ?? "Ungraded",
      gradeSubtype: f[iGs] ?? "",
      sealed: (f[iRarity] ?? "") === "Sealed",
    });
  }
  return rows;
}

/** Singles with a PriceCharting id — the pricing job's poll list. */
export function shinyPricingTargets(csvPath?: string): ShinyRow[] {
  return loadShinyRows(csvPath).filter((r) => !r.sealed && r.pcId);
}
