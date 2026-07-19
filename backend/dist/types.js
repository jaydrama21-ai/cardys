// Entity schema — mirrors design_handoff_data_layer/RipDataService.interface.ts.
// Every screen in RipReport expects exactly these shapes.
// ---- prototype pricing constants (replace math with real comps in live mode) ----
export const GRADE_BASE = { 10: 5, 9.5: 3.4, 9: 2, 8: 1.3 };
export const COMPANY_FACTOR = { PSA: 1.0, BGS: 1.15, CGC: 0.92, SGC: 0.9, TAG: 0.85 };
export const LANG_MULT = { EN: 1.0, JP: 0.9, KR: 0.75, ZH: 0.7 };
export function tierForRaw(raw) {
    if (raw >= 30)
        return "A";
    if (raw >= 8)
        return "B";
    if (raw >= 2)
        return "C";
    return "D";
}
