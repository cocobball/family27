// src/kiosk/oskFocusFix.js
// Ensures taps focus inputs early (pointerdown capture) so kiosk OSK opens reliably.

export function installKioskOskFocusFix() {
  // already installed?
  if (window.__oskFocusFixInstalled) return;
  window.__oskFocusFixInstalled = true;

  const focusTarget = (t) => {
    if (!t) return null;
    // If you tap inside a wrapper, climb to the actual input
    const el = t.closest?.('input, textarea, [contenteditable="true"], [contenteditable=""], [role="textbox"]');
    if (!el) return null;
    if (el.disabled) return null;
    if (el.getAttribute?.("data-no-osk-focus") === "1") return null;
    return el;
  };

  const handler = (e) => {
    const el = focusTarget(e.target);
    if (!el) return;

    // Don’t steal focus from already-focused element
    if (document.activeElement === el) return;

    try {
      el.focus({ preventScroll: true });
    } catch {
      try { el.focus(); } catch {}
    }

    // Some kiosk builds steal focus back on pointerup/click; refocus next frame
    requestAnimationFrame(() => {
      if (document.activeElement !== el) {
        try {
          el.focus({ preventScroll: true });
        } catch {
          try { el.focus(); } catch {}
        }
      }
    });
  };

  // Capture phase is the key
  document.addEventListener("pointerdown", handler, true);

  // Fallbacks for older/non-pointer environments
  document.addEventListener("mousedown", handler, true);
  document.addEventListener("touchstart", handler, true);

  // Optional: if click is stealing focus, uncomment:
  // document.addEventListener("click", handler, true);

  // Expose uninstall if you ever need it
  window.__oskFocusFixUninstall = () => {
    document.removeEventListener("pointerdown", handler, true);
    document.removeEventListener("mousedown", handler, true);
    document.removeEventListener("touchstart", handler, true);
    // document.removeEventListener("click", handler, true);
    window.__oskFocusFixInstalled = false;
  };
}
