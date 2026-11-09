import { useEffect, type RefObject } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Keeps `Tab` inside an open dialog and gives focus back to whatever opened it.
 *
 * Every panel in the app is `aria-modal`, but without this the browser happily
 * tabs into the canvas behind the panel, and closing the panel drops the caret on
 * `<body>` – so the next keystroke means nothing. Initial focus stays the dialog's
 * own business: the hub and the risk panel both land on a different element on
 * purpose.
 */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, enabled = true) {
  useEffect(() => {
    const node = ref.current;
    if (!node || !enabled) return;

    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () =>
      Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => element.tabIndex !== -1 && (element.offsetParent !== null || element === document.activeElement),
      );

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const list = focusable();
      if (list.length === 0) {
        event.preventDefault();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const inside = active ? node.contains(active) : false;

      if (event.shiftKey && (!inside || active === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!inside || active === last)) {
        event.preventDefault();
        first.focus();
      }
    };

    node.addEventListener('keydown', onKeyDown);
    return () => {
      node.removeEventListener('keydown', onKeyDown);
      // The trigger may be gone (a row that opened a dialog can be re-rendered
      // away); focusing a detached node is a no-op, not an error.
      previous?.focus();
    };
  }, [ref, enabled]);
}
