// The link back to the Skeletonbelly front door. It is a real DOM anchor,
// shown on the title and game-over screens and hidden during play.

const link = document.getElementById('home') as HTMLAnchorElement | null;

export function showHome(visible: boolean): void {
  if (link) link.hidden = !visible;
}

/** True when the keyboard focus is on the link, so Space or Enter should not also start a run. */
export function homeHasFocus(): boolean {
  return link !== null && document.activeElement === link;
}
