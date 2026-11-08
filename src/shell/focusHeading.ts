/** Where reading starts on a screen. A heading is not a tab stop, so it is made focusable here. */
export function focusHeading(): void {
  const heading = document.querySelector<HTMLElement>("main h1");
  if (heading === null) return;
  heading.tabIndex = -1;
  heading.focus();
}
