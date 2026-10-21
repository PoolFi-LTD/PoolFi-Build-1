/** Replays the splash, e.g. after signing out. */
export const SPLASH_EVENT = "poolfi:splash";

/** Runs in the page head before anything is drawn: the splash shows each time the app opens, except for people who ask for less motion. */
export const SPLASH_SCRIPT = `try{document.documentElement.dataset.splash=matchMedia("(prefers-reduced-motion: reduce)").matches?"off":"on"}catch(e){document.documentElement.dataset.splash="off"}`;
