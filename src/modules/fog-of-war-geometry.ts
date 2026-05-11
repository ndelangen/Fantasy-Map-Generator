import polygonClipping from "polygon-clipping";
import type { MultiPolygon, Polygon } from "polygon-clipping";
import { rn } from "../utils/numberUtils";

export type FogOfWarMode = "obscured" | "revealed";

export interface FogOfWarPolygon {
  id: string;
  /** First ring = outer boundary; further rings = holes (optional). */
  rings: [number, number][][];
}

function closeRing(ring: [number, number][]): [number, number][] {
  if (ring.length < 3) return ring;
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (a[0] === b[0] && a[1] === b[1]) return ring;
  return [...ring, a];
}

/** Drop closing duplicate of first vertex if present (common from clipping / GeoJSON). */
function normalizeOpenRing(ring: [number, number][]): [number, number][] {
  if (ring.length < 2) return ring;
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (a[0] === b[0] && a[1] === b[1]) return ring.slice(0, -1) as [number, number][];
  return ring;
}

/** Padded map bounds from mapRectMultiPolygon — keep linear so mask edges stay sharp. */
function isOuterPaddedBoundsRing(
  ring: [number, number][],
  graphWidth: number,
  graphHeight: number,
  padPx: number,
): boolean {
  const pts = normalizeOpenRing(ring);
  if (pts.length !== 4) return false;
  const eps = 1.5;
  const x = -padPx;
  const y = -padPx;
  const w = graphWidth + 2 * padPx;
  const h = graphHeight + 2 * padPx;
  const expected: [number, number][] = [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
  for (const p of pts) {
    if (!expected.some((e) => Math.abs(p[0] - e[0]) < eps && Math.abs(p[1] - e[1]) < eps)) return false;
  }
  for (const e of expected) {
    if (!pts.some((p) => Math.abs(p[0] - e[0]) < eps && Math.abs(p[1] - e[1]) < eps)) return false;
  }
  return true;
}

function ringToLinearPathD(ring: [number, number][]): string {
  if (ring.length < 2) return "";
  const [x0, y0] = ring[0];
  const parts: string[] = [`M${rn(x0, 2)},${rn(y0, 2)}`];
  for (let k = 1; k < ring.length; k++) {
    parts.push(`L${rn(ring[k][0], 2)},${rn(ring[k][1], 2)}`);
  }
  parts.push("Z");
  return parts.join("");
}

/**
 * Closed Catmull–Rom spline as cubic Béziers (uniform parameterization), through each vertex.
 * Used for fog polygon display; clipping still uses linear rings in data.
 */
export function ringToSmoothBezierPathD(ring: [number, number][]): string {
  const pts = normalizeOpenRing(ring);
  const n = pts.length;
  if (n < 2) return "";
  if (n === 2) {
    return `M${rn(pts[0][0], 2)},${rn(pts[0][1], 2)}L${rn(pts[1][0], 2)},${rn(pts[1][1], 2)}Z`;
  }
  const p = (i: number) => pts[(i + n) % n];
  const parts: string[] = [`M${rn(p(0)[0], 2)},${rn(p(0)[1], 2)}`];
  for (let i = 0; i < n; i++) {
    const p0 = p(i - 1);
    const p1 = p(i);
    const p2 = p(i + 1);
    const p3 = p(i + 2);
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    parts.push(
      `C${rn(cp1x, 2)},${rn(cp1y, 2)} ${rn(cp2x, 2)},${rn(cp2y, 2)} ${rn(p2[0], 2)},${rn(p2[1], 2)}`,
    );
  }
  parts.push("Z");
  return parts.join("");
}

export function mapRectMultiPolygon(
  graphWidth: number,
  graphHeight: number,
  padPx: number,
): MultiPolygon {
  const x = -padPx;
  const y = -padPx;
  const w = graphWidth + 2 * padPx;
  const h = graphHeight + 2 * padPx;
  return [
    [
      [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
        [x, y],
      ],
    ],
  ];
}

export function multiPolygonToSvgPathD(
  mp: MultiPolygon,
  graphWidth?: number,
  graphHeight?: number,
  padPx?: number,
): string {
  const useRectGuard =
    Number.isFinite(graphWidth) &&
    Number.isFinite(graphHeight) &&
    Number.isFinite(padPx) &&
    (graphWidth as number) > 0 &&
    (graphHeight as number) > 0 &&
    (padPx as number) >= 0;

  const parts: string[] = [];
  for (const polygon of mp) {
    for (const ring of polygon) {
      if (ring.length < 2) continue;
      const r = ring as [number, number][];
      if (
        useRectGuard &&
        isOuterPaddedBoundsRing(r, graphWidth as number, graphHeight as number, padPx as number)
      ) {
        parts.push(ringToLinearPathD(r));
      } else {
        parts.push(ringToSmoothBezierPathD(r));
      }
    }
  }
  return parts.join("");
}

export function unionFogPolygons(polygons: FogOfWarPolygon[]): MultiPolygon | null {
  if (!polygons?.length) return null;
  let acc: MultiPolygon | null = null;
  try {
    for (const poly of polygons) {
      const rings = poly.rings?.filter((r) => r.length >= 3).map((r) => closeRing(r));
      if (!rings?.length) continue;
      const p: MultiPolygon = [rings];
      acc = acc ? polygonClipping.union(acc, p) : p;
    }
  } catch {
    return null;
  }
  return acc?.length ? acc : null;
}

export function buildFogMatteMultiPolygon(
  mode: FogOfWarMode,
  polygons: FogOfWarPolygon[],
  graphWidth: number,
  graphHeight: number,
  padPx: number,
): MultiPolygon | null {
  const gw = Number(graphWidth);
  const gh = Number(graphHeight);
  if (!Number.isFinite(gw) || !Number.isFinite(gh) || gw <= 0 || gh <= 0) return null;

  const pad = Math.max(0, padPx);
  const rect = mapRectMultiPolygon(gw, gh, pad);
  const uni = unionFogPolygons(polygons);

  try {
    if (mode === "obscured") {
      if (!uni?.length) return null;
      const clipped = polygonClipping.intersection(rect, uni);
      return clipped?.length ? clipped : null;
    }
    // revealed — full map fog minus polygon union
    if (!uni?.length) return rect;
    const diff = polygonClipping.difference(rect, uni);
    return diff?.length ? diff : null;
  } catch {
    return null;
  }
}

export function buildFogMattePathD(
  mode: FogOfWarMode,
  polygons: FogOfWarPolygon[],
  graphWidth: number,
  graphHeight: number,
  padPx: number,
): string {
  const mp = buildFogMatteMultiPolygon(mode, polygons, graphWidth, graphHeight, padPx);
  if (!mp?.length) return "";
  return multiPolygonToSvgPathD(mp, graphWidth, graphHeight, padPx);
}

/** Ray-cast point in ring (closed); holes use same test. */
function pointInRing(x: number, y: number, ring: [number, number][]): boolean {
  if (ring.length < 3) return false;
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i][0],
      yi = ring[i][1];
    const xj = ring[j][0],
      yj = ring[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-30) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygonShape(x: number, y: number, poly: Polygon): boolean {
  const [outer, ...holes] = poly;
  if (!outer?.length) return false;
  if (!pointInRing(x, y, outer)) return false;
  for (const h of holes) {
    if (h?.length && pointInRing(x, y, h)) return false;
  }
  return true;
}

export function pointInMultiPolygon(x: number, y: number, mp: MultiPolygon): boolean {
  for (const poly of mp) {
    if (pointInPolygonShape(x, y, poly)) return true;
  }
  return false;
}

function distPointSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-18) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = x1 + t * dx;
  const qy = y1 + t * dy;
  return Math.hypot(px - qx, py - qy);
}

function minDistToRing(x: number, y: number, ring: [number, number][]): number {
  if (ring.length < 2) return Infinity;
  let d = Infinity;
  const n = ring.length;
  const lim = ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1] ? n - 1 : n;
  for (let i = 0; i < lim; i++) {
    const j = (i + 1) % n;
    const dd = distPointSegment(x, y, ring[i][0], ring[i][1], ring[j][0], ring[j][1]);
    if (dd < d) d = dd;
  }
  return d;
}

function minDistToPolygonShape(x: number, y: number, poly: Polygon): number {
  const [outer, ...holes] = poly;
  if (!outer?.length) return Infinity;
  let d = minDistToRing(x, y, outer);
  for (const h of holes) {
    if (h?.length) {
      const dh = minDistToRing(x, y, h);
      if (dh < d) d = dh;
    }
  }
  return d;
}

function minDistToMultiPolygon(x: number, y: number, mp: MultiPolygon): number {
  let d = Infinity;
  for (const poly of mp) {
    const dd = minDistToPolygonShape(x, y, poly);
    if (dd < d) d = dd;
  }
  return d;
}

export function fogBlocksInteraction(
  x: number,
  y: number,
  mode: FogOfWarMode,
  polygons: FogOfWarPolygon[],
  graphWidth: number,
  graphHeight: number,
  featherWorld: number,
): boolean {
  const gw = Number(graphWidth);
  const gh = Number(graphHeight);
  if (!Number.isFinite(gw) || !Number.isFinite(gh)) return false;
  if (x < 0 || y < 0 || x > gw || y > gh) return false;

  const uni = unionFogPolygons(polygons);
  const feather = Math.max(0, featherWorld);

  if (mode === "obscured") {
    if (!uni?.length) return false;
    const clipped = polygonClipping.intersection(mapRectMultiPolygon(gw, gh, 0), uni);
    if (!clipped?.length) return false;
    const inside = pointInMultiPolygon(x, y, clipped);
    if (inside) return true;
    if (feather <= 0) return false;
    const dist = minDistToMultiPolygon(x, y, clipped);
    return dist < feather;
  }

  // revealed
  if (!uni?.length) return true;
  const clippedU = polygonClipping.intersection(mapRectMultiPolygon(gw, gh, 0), uni);
  if (!clippedU?.length) return true;

  const insideWindow = pointInMultiPolygon(x, y, clippedU);
  if (!insideWindow) return true;
  if (feather <= 0) return false;
  const dist = minDistToMultiPolygon(x, y, clippedU);
  return dist < feather;
}

declare global {
  interface Window {
    buildFogMattePathD: typeof buildFogMattePathD;
    fogBlocksInteraction: typeof fogBlocksInteraction;
    pointInMultiPolygon: typeof pointInMultiPolygon;
    ringToSmoothBezierPathD: typeof ringToSmoothBezierPathD;
  }
}

window.buildFogMattePathD = buildFogMattePathD;
window.fogBlocksInteraction = fogBlocksInteraction;
window.pointInMultiPolygon = pointInMultiPolygon;
window.ringToSmoothBezierPathD = ringToSmoothBezierPathD;
