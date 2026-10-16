import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

type Position = { left: number; top: number };

// Places a fixed popover under its trigger, right-aligned and kept inside the viewport;
// flips above the trigger when there is no room below. Returns null until measured.
export function usePopoverPosition(open: boolean, trigger: RefObject<HTMLElement | null>, panel: RefObject<HTMLElement | null>): Position | null {
  const [position, setPosition] = useState<Position | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = trigger.current!.getBoundingClientRect();
      const bounds = panel.current!.getBoundingClientRect();
      const left = Math.max(12, Math.min(anchor.right - bounds.width, document.documentElement.clientWidth - bounds.width - 12));
      const below = anchor.bottom + 8;
      const top = below + bounds.height <= window.innerHeight - 12 ? below : Math.max(12, anchor.top - bounds.height - 8);
      setPosition({ left, top });
    };
    place();
    const resize = new ResizeObserver(place);
    resize.observe(panel.current!);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      resize.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true);
      setPosition(null);
    };
  }, [open, trigger, panel]);
  return position;
}

// Closes an open popover on a pointer or focus move outside `inside`, or on Escape.
export function usePopoverDismiss(open: boolean, inside: RefObject<HTMLElement | null>[], onOutside: () => void, onEscape: () => void) {
  const latest = useRef({ inside, onOutside, onEscape });
  latest.current = { inside, onOutside, onEscape };
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node && !latest.current.inside.some(ref => ref.current?.contains(event.target as Node))) latest.current.onOutside();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); latest.current.onEscape(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
}
