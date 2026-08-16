"use client";

import { useMap } from "@vis.gl/react-google-maps";
import { useCallback, useEffect, useRef } from "react";

import { isTap, simplifyToLimit, type Pixel } from "@/lib/knock/territory";
import type { LatLng } from "@/lib/types";

/**
 * Draw a territory by dragging a loop around it.
 *
 * This is a transparent sheet laid over the map. While it is live it swallows
 * every pointer event, so the map underneath never sees the drag and never
 * pans — which is the only way a finger can mean "draw" on a surface whose
 * whole job is "move". Turn the sheet off (the Move map toggle in the bar) and
 * the map gets its gesture back, unchanged.
 *
 * The path is collected in screen pixels and converted to coordinates once, at
 * the end. That ordering matters:
 *
 *   Simplifying in pixels removes finger jitter, which is a fixed number of
 *   pixels whatever the map is zoomed to. In degrees the same tolerance would
 *   flatten a street-level shape and leave a county-level one untouched.
 *
 *   Converting once means the shape cannot warp if the map moves mid-drag.
 *
 * The live line is drawn on a plain <canvas> rather than as a google.maps
 * Polyline. A Polyline would be rebuilt from a fresh path on every pointer
 * sample — hundreds of times a second — and the lag is visible as a line that
 * trails behind your finger.
 */
export function FreehandLayer({
  active,
  onDrawn,
  onTap,
}: {
  /** False while the Move map toggle is on, which hands gestures back. */
  active: boolean;
  /** A completed drag, already simplified and converted. */
  onDrawn: (points: LatLng[]) => void;
  /** A tap rather than a drag: one corner, for fine adjustment. */
  onTap: (point: LatLng) => void;
}) {
  const map = useMap();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const path = useRef<Pixel[]>([]);
  // A ref, not state. A pointerdown that set state would not reach the move
  // handler until React had re-rendered, and the samples in between — the first
  // centimetre of the stroke — would be dropped on the floor.
  const dragging = useRef(false);

  // An OverlayView is the supported way to ask Google Maps to convert a
  // container pixel into a coordinate. There is no such method on the map
  // itself, and the arithmetic alternative (bounds plus a Mercator projection)
  // has to be redone by hand every time the camera moves.
  const overlay = useRef<google.maps.OverlayView | null>(null);
  useEffect(() => {
    if (!map) return;
    const view = new google.maps.OverlayView();
    view.onAdd = () => {};
    view.onRemove = () => {};
    view.draw = () => {};
    view.setMap(map);
    overlay.current = view;
    return () => {
      view.setMap(null);
      overlay.current = null;
    };
  }, [map]);

  const toLatLng = useCallback((point: Pixel): LatLng | null => {
    const projection = overlay.current?.getProjection();
    if (!projection) return null;
    const latLng = projection.fromContainerPixelToLatLng(
      new google.maps.Point(point.x, point.y),
    );
    return latLng ? { lat: latLng.lat(), lng: latLng.lng() } : null;
  }, []);

  /** Keeps the canvas the size of the sheet, in device pixels. */
  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    const surface = surfaceRef.current;
    if (!canvas || !surface) return;
    const ratio = window.devicePixelRatio || 1;
    const { width, height } = surface.getBoundingClientRect();
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.getContext("2d")?.setTransform(ratio, 0, 0, ratio, 0, 0);
  }, []);

  useEffect(() => {
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [resize, active]);

  function paint() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const ratio = window.devicePixelRatio || 1;
    context.clearRect(0, 0, canvas.width / ratio, canvas.height / ratio);
    if (path.current.length < 2) return;

    context.beginPath();
    context.moveTo(path.current[0].x, path.current[0].y);
    for (const point of path.current.slice(1)) context.lineTo(point.x, point.y);

    // Closed back to the start and filled while you drag, so what is being
    // enclosed is obvious before you let go — a trailing open line reads as a
    // route rather than an area.
    context.closePath();
    context.fillStyle = "rgba(0, 217, 255, 0.16)";
    context.fill();

    context.strokeStyle = "#00d9ff";
    context.lineWidth = 3;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.stroke();
  }

  function positionIn(event: React.PointerEvent<HTMLDivElement>): Pixel {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  function start(event: React.PointerEvent<HTMLDivElement>) {
    // Capture so a finger that slides off the edge still finishes the shape
    // rather than leaving a half-drawn outline and no pointerup.
    event.currentTarget.setPointerCapture(event.pointerId);
    path.current = [positionIn(event)];
    dragging.current = true;
    paint();
  }

  function move(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    const point = positionIn(event);
    const last = path.current.at(-1);
    // Skip samples that land on the same pixel. They carry no shape and a
    // held-still finger can produce hundreds of them.
    if (last && Math.abs(last.x - point.x) < 1 && Math.abs(last.y - point.y) < 1) {
      return;
    }
    path.current.push(point);
    paint();
  }

  function end(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    dragging.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const raw = path.current;
    path.current = [];
    paint();

    // A tap, not a drag. Adding one corner is the fine adjustment a freehand
    // loop cannot do — nudging a boundary onto the far side of a cul-de-sac.
    if (isTap(raw)) {
      const point = raw[0] ? toLatLng(raw[0]) : null;
      if (point) onTap(point);
      return;
    }

    const points = simplifyToLimit(raw)
      .map(toLatLng)
      .filter((point): point is LatLng => point !== null);
    if (points.length >= 3) onDrawn(points);
  }

  if (!active) return null;

  return (
    <div
      ref={surfaceRef}
      // Above the map, below the draw bar. `touch-none` is what stops the
      // browser treating the drag as a scroll and cancelling the pointer
      // stream halfway through a shape.
      className="absolute inset-0 z-10 touch-none"
      style={{ cursor: "crosshair" }}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <canvas ref={canvasRef} className="pointer-events-none size-full" />
    </div>
  );
}
