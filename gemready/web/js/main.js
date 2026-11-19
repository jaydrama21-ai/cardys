// Boot: routes, first-launch gate, theme, service worker.

import { route, render, setGuard } from "./router.js";
import { settings, PRIVACY_NOTICE_VERSION } from "./state.js";
import { applyTheme } from "./theme.js";
import { scanScreen, resumeScreen, checkScreen, analyzeScreen, fixScreen } from "./screens/scan.js";
import { estimateScreen, accuracyScreen, gradeKeyScreen } from "./screens/estimate.js";
import { outcomesScreen, costsScreen, compareScreen } from "./screens/outcomes.js";
import { collectionScreen, cardScreen, slabScreen, submissionsScreen, submitScreen, planScreen } from "./screens/collection.js";
import { settingsScreen, deleteScreen, feedbackScreen } from "./screens/settings.js";
import { ageScreen, privacyScreen, tipsScreen, helpTrainScreen } from "./screens/onboarding.js";

route("age", ageScreen);
route("privacy", privacyScreen);
route("tips", tipsScreen);
route("help-train", helpTrainScreen);
route("scan", scanScreen, ["id"]);
route("resume", resumeScreen, ["id"]);
route("check", checkScreen, ["id"]);
route("analyze", analyzeScreen, ["id"]);
route("fix", fixScreen, ["id"]);
route("estimate", estimateScreen, ["id"]);
route("outcomes", outcomesScreen, ["id"]);
route("costs", costsScreen, ["id"]);
route("compare", compareScreen, ["id"]);
route("collection", collectionScreen);
route("card", cardScreen, ["id"]);
route("slab", (p) => slabScreen({ id: p.id?.split("?")[0] }), ["id"]);
route("submissions", submissionsScreen);
route("submit", submitScreen, ["id"]);
route("plan", planScreen);
route("accuracy", accuracyScreen);
route("gradekey", gradeKeyScreen);
route("settings", settingsScreen);
route("delete", deleteScreen);
route("feedback", feedbackScreen, ["from"]);

// First launch order (canvas notes): Age Check → Privacy → tips → scan.
setGuard((name) => {
  const s = settings();
  if (!s.ageChecked && name !== "age") return "#/age";
  if (s.ageChecked && s.privacySeen < PRIVACY_NOTICE_VERSION && !["age", "privacy"].includes(name)) return "#/privacy";
  return null;
});

applyTheme();
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", applyTheme);
if (!location.hash) location.hash = "#/scan";
render();

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
