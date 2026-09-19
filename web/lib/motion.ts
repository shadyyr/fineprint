// The CSS reduced-motion rule in globals.css only covers CSS scrolling;
// JavaScript scrollTo/scrollIntoView with behavior "smooth" ignores it.
// Read the setting at call time so a change in system settings applies at once.
export function scrollBehavior(): ScrollBehavior {
  if (typeof window === "undefined") return "auto";
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}
