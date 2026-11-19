import { settings } from "./state.js";

export function applyTheme() {
  const a = settings().appearance;
  const root = document.documentElement;
  if (a === "light" || a === "dark") root.dataset.theme = a;
  else delete root.dataset.theme;
  const dark = a === "dark" || (a === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0D0F14" : "#F6F5F0");
}
