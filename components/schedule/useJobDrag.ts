"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { impact } from "@/lib/native/shell";

/**
 * Where a dragged job can be dropped. `day` targets change the date and keep
 * the time of day; `slot` targets set both.
 */
export interface DropTarget {
  dayKey: string;
  minutes: number | null;
}

interface DragState {
  jobId: string;
  label: string;
  x: number;
  y: number;
  target: DropTarget | null;
}

/** Hold this long before a press turns into a drag. */
const LONG_PRESS_MS = 320;
/** Moving further than this before the timer fires means the user is scrolling. */
const SCROLL_SLOP_PX = 10;
/** Auto-scroll when the finger gets this close to the edge of the scroller. */
const EDGE_PX = 64;
const EDGE_SPEED_PX = 12;

function targetFromPoint(x: number, y: number): DropTarget | null {
  const element = document.elementFromPoint(x, y);
  const zone = element?.closest<HTMLElement>("[data-drop-day]");
  if (!zone) return null;

  const dayKey = zone.dataset.dropDay;
  if (!dayKey) return null;

  const rawMinutes = zone.dataset.dropMinutes;
  return {
    dayKey,
    minutes: rawMinutes === undefined ? null : Number(rawMinutes),
  };
}

/**
 * Pointer-based drag-and-drop for calendar blocks.
 *
 * HTML5 drag-and-drop is not an option here: it does not fire on touch, and
 * this calendar is used on a phone. Pointer events plus elementFromPoint work
 * identically for finger and mouse, and the long-press threshold keeps a drag
 * from stealing a scroll gesture.
 */
export function useJobDrag(onDrop: (jobId: string, target: DropTarget) => void) {
  const [drag, setDrag] = useState<DragState | null>(null);

  // Mirrors `drag` so the pointerup handler can read the current job id without
  // the listener re-binding on every pointermove.
  const dragDataRef = useRef<DragState | null>(null);
  useEffect(() => {
    dragDataRef.current = drag;
  }, [drag]);

  const pending = useRef<{
    jobId: string;
    label: string;
    x: number;
    y: number;
    pointerId: number;
    element: HTMLElement;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const dragging = useRef(false);
  const scroller = useRef<HTMLElement | null>(null);
  const autoScroll = useRef<number | null>(null);
  /**
   * Releasing a drag still produces a click on the block underneath. Without
   * this, dropping a job would also open its edit sheet — the sheet then sits
   * over the calendar and swallows the next tap.
   */
  const dragEndedAt = useRef(0);

  const clearPending = useCallback(() => {
    if (pending.current) {
      clearTimeout(pending.current.timer);
      pending.current = null;
    }
  }, []);

  const stopAutoScroll = useCallback(() => {
    if (autoScroll.current !== null) {
      cancelAnimationFrame(autoScroll.current);
      autoScroll.current = null;
    }
  }, []);

  const finish = useCallback(() => {
    if (dragging.current) dragEndedAt.current = Date.now();
    dragging.current = false;
    clearPending();
    stopAutoScroll();
    setDrag(null);
  }, [clearPending, stopAutoScroll]);

  /** True for a moment after a drop, so the trailing click can be ignored. */
  const didJustDrag = useCallback(() => Date.now() - dragEndedAt.current < 400, []);

  /**
   * Keeps the calendar moving when the finger sits near an edge.
   *
   * Both axes matter: the day timeline scrolls vertically, and the week view is
   * ~736px wide against a 390px phone, so without horizontal scroll you simply
   * cannot drag a job from Monday to Friday — the target column is off screen.
   */
  const runAutoScroll = useCallback(
    (clientX: number, clientY: number) => {
      stopAutoScroll();
      const container = scroller.current;
      if (!container) return;

      const box = container.getBoundingClientRect();

      let dy = 0;
      if (container.scrollHeight > container.clientHeight) {
        if (clientY < box.top + EDGE_PX) dy = -EDGE_SPEED_PX;
        else if (clientY > box.bottom - EDGE_PX) dy = EDGE_SPEED_PX;
      }

      let dx = 0;
      if (container.scrollWidth > container.clientWidth) {
        if (clientX < box.left + EDGE_PX) dx = -EDGE_SPEED_PX;
        else if (clientX > box.right - EDGE_PX) dx = EDGE_SPEED_PX;
      }

      if (dx === 0 && dy === 0) return;

      const step = () => {
        container.scrollTop += dy;
        container.scrollLeft += dx;
        autoScroll.current = requestAnimationFrame(step);
      };
      autoScroll.current = requestAnimationFrame(step);
    },
    [stopAutoScroll],
  );

  useEffect(() => {
    function onMove(event: PointerEvent) {
      if (!dragging.current) {
        const start = pending.current;
        if (!start || event.pointerId !== start.pointerId) return;
        const moved =
          Math.abs(event.clientX - start.x) + Math.abs(event.clientY - start.y);
        if (moved > SCROLL_SLOP_PX) clearPending();
        return;
      }

      // The drag owns the gesture now; stop the page scrolling underneath it.
      event.preventDefault();
      runAutoScroll(event.clientX, event.clientY);
      const target = targetFromPoint(event.clientX, event.clientY);
      setDrag((current) =>
        current ? { ...current, x: event.clientX, y: event.clientY, target } : current,
      );
    }

    function onUp(event: PointerEvent) {
      if (!dragging.current) {
        clearPending();
        return;
      }
      const target = targetFromPoint(event.clientX, event.clientY);
      const jobId = dragDataRef.current?.jobId ?? null;
      finish();
      if (jobId && target) onDrop(jobId, target);
    }

    function onCancel() {
      finish();
    }

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [clearPending, finish, onDrop, runAutoScroll]);

  useEffect(() => stopAutoScroll, [stopAutoScroll]);

  const startPress = useCallback(
    (event: React.PointerEvent<HTMLElement>, jobId: string, label: string) => {
      // Ignore right-click and multi-touch.
      if (event.button !== 0 && event.pointerType === "mouse") return;

      const element = event.currentTarget;
      const { clientX, clientY, pointerId } = event;

      const timer = setTimeout(() => {
        dragging.current = true;
        try {
          element.setPointerCapture(pointerId);
        } catch {
          // Capture is a nicety; the window listeners still track the pointer.
        }
        // iOS Safari ignores navigator.vibrate entirely; impact() routes to
        // the Haptics plugin on device and falls back to vibrate on the web.
        void impact("light");
        setDrag({
          jobId,
          label,
          x: clientX,
          y: clientY,
          target: targetFromPoint(clientX, clientY),
        });
      }, LONG_PRESS_MS);

      pending.current = { jobId, label, x: clientX, y: clientY, pointerId, element, timer };
    },
    [],
  );

  const registerScroller = useCallback((element: HTMLElement | null) => {
    scroller.current = element;
  }, []);

  return {
    drag,
    isDragging: drag !== null,
    didJustDrag,
    startPress,
    cancelPress: clearPending,
    registerScroller,
  };
}
