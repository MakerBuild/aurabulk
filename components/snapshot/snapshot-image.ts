import { getFontEmbedCSS, toCanvas } from "html-to-image";

export interface SnapshotBlock {
  id: string;
  el: HTMLElement;
  label: string;
}

/** Every card on the page is a candidate: the site draws them all with
 *  PanelCard, whose root carries `panel-gold-hover`. Cards inside cards are
 *  left to their parent, so a pick is always a whole block. */
export function findSnapshotBlocks(): SnapshotBlock[] {
  const cards = [...document.querySelectorAll<HTMLElement>("main .panel-gold-hover")];
  return cards
    .filter((el) => !el.parentElement?.closest(".panel-gold-hover"))
    .filter((el) => el.offsetWidth > 0 && el.offsetHeight > 0)
    .map((el, i) => ({ id: `snap-${i}`, el, label: labelOf(el) }));
}

function labelOf(el: HTMLElement): string {
  const heading = el.querySelector("h1")?.textContent?.trim();
  if (heading) return heading;
  // The first eyebrow that is a single piece of text — not a table's heading
  // row, whose cells would run together into one word.
  const label = [...el.querySelectorAll(".font-label")]
    .find((n) => n.childElementCount === 0 && n.textContent?.trim())
    ?.textContent?.trim();
  return label || "card";
}

/** SVG attributes the site's charts set through CSS variables. */
const SVG_VAR_ATTRS = ["font-family", "fill", "stroke", "stop-color"] as const;

/**
 * Charts name their fonts and colours with CSS variables straight in SVG
 * attributes (fontFamily="var(--font-mono)"). The cloned SVG in the image
 * has no root to resolve those against, so the axis labels fell back to a
 * serif. For the length of the capture, each such attribute is swapped for
 * the value the browser resolved it to; the returned function puts the
 * originals back.
 */
function resolveSvgVars(root: HTMLElement): () => void {
  const undo: (() => void)[] = [];
  for (const node of root.querySelectorAll<SVGElement>("svg *")) {
    for (const attr of SVG_VAR_ATTRS) {
      const raw = node.getAttribute(attr);
      if (!raw || !raw.includes("var(")) continue;
      const resolved = getComputedStyle(node).getPropertyValue(attr).trim();
      if (!resolved) continue;
      node.setAttribute(attr, resolved);
      undo.push(() => node.setAttribute(attr, raw));
    }
  }
  return () => undo.forEach((fn) => fn());
}

const RATIO = 2;
const PAD = 24;
const GAP = 16;
/**
 * How far a card may be redrawn narrower or wider than it sits on the page,
 * as a factor of its page width. A card that is mostly one chart (an SVG
 * across most of it) redraws to fill any width. Anything else, a donut
 * beside its table or a KPI tile, has a fixed arrangement inside, and
 * widening it much only opens a hole in the middle.
 */
const FLUID_RANGE: [number, number] = [0.7, 3];
const FIXED_RANGE: [number, number] = [0.95, 1.4];
/** Picture shapes, width over height, that cost nothing: a landscape
 *  picture, not a ribbon and not a tower. */
const ASPECT_MIN = 1;
const ASPECT_MAX = 2.8;
/** What giving up one of the page's own rows costs, so the page's
 *  arrangement wins whenever it already makes a good picture. */
const FOLD_COST = 0.3;
/** A card redrawn at a new width is captured once its markup has sat still
 *  this long: its charts re-measure, re-render and replay their draw-in. */
const SETTLE_QUIET_MS = 250;
const SETTLE_MIN_MS = 350;
const SETTLE_MAX_MS = 2500;

/** Resolves once nothing inside `el` has changed for SETTLE_QUIET_MS (and at
 *  least SETTLE_MIN_MS have passed), or after SETTLE_MAX_MS regardless. */
function settled(el: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();
    let last = start;
    const observer = new MutationObserver(() => {
      last = performance.now();
    });
    observer.observe(el, { subtree: true, childList: true, attributes: true, characterData: true });
    const check = () => {
      const now = performance.now();
      const quiet = now - last >= SETTLE_QUIET_MS && now - start >= SETTLE_MIN_MS;
      if (quiet || now - start >= SETTLE_MAX_MS) {
        observer.disconnect();
        resolve();
      } else {
        window.setTimeout(check, 50);
      }
    };
    window.setTimeout(check, 50);
  });
}

/** Safari on any device, and every iOS browser, which all run on WebKit. */
function isWebKit(): boolean {
  const ua = navigator.userAgent;
  const iOS = /iP(hone|ad|od)/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return iOS || (/Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg|Android/.test(ua));
}

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

interface Box {
  el: HTMLElement;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The narrowest and widest this card may be drawn, as factors of w. */
  range: [number, number];
}

function stretchRange(el: HTMLElement, width: number): [number, number] {
  const fluid = [...el.querySelectorAll("svg")].some((svg) => svg.getBoundingClientRect().width >= width * 0.75);
  return fluid ? FLUID_RANGE : FIXED_RANGE;
}

/** Splits boxes into runs whose spans along one axis overlap, in order. */
function runs(boxes: Box[], axis: "x" | "y"): Box[][] {
  const size = axis === "x" ? "w" : "h";
  const sorted = [...boxes].sort((a, b) => a[axis] - b[axis]);
  const out: Box[][] = [];
  let end = -Infinity;
  for (const b of sorted) {
    // A pixel of slack: neighbours that only touch are not overlapping.
    if (out.length && b[axis] < end - 1) {
      out[out.length - 1].push(b);
      end = Math.max(end, b[axis] + b[size]);
    } else {
      out.push([b]);
      end = b[axis] + b[size];
    }
  }
  return out;
}

const cardsWidth = (row: Box[]) => row.reduce((s, b) => s + b.w, 0);
const rowWidth = (row: Box[]) => cardsWidth(row) + GAP * (row.length - 1);
const rowHeight = (row: Box[]) => Math.max(...row.map((b) => b.h));

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

interface Layout {
  rows: Box[][];
  /** The picture's width, which every row is drawn to fill. */
  width: number;
  cost: number;
}

/**
 * Prices one way of dealing the cards into rows. Every row is drawn to the
 * same width, its cards scaled together, so the width has to suit every row:
 * none may take a card outside its range. The widths tried are the rows' own
 * page widths (pulled into that range), so a picture is never widened for
 * its own sake. Null when no width suits every row.
 */
function price(rows: Box[][], folds: number): Layout | null {
  let lo = 0;
  let hi = Infinity;
  for (const row of rows) {
    const min = Math.max(...row.map((b) => b.range[0]));
    const max = Math.min(...row.map((b) => b.range[1]));
    if (min > max) return null;
    const gaps = GAP * (row.length - 1);
    lo = Math.max(lo, min * cardsWidth(row) + gaps);
    hi = Math.min(hi, max * cardsWidth(row) + gaps);
  }
  if (lo > hi + 0.5) return null;

  const height = rows.reduce((s, r) => s + rowHeight(r), 0) + GAP * (rows.length - 1);
  let best: Layout | null = null;
  for (const natural of rows.map(rowWidth)) {
    const width = Math.min(hi, Math.max(lo, natural));
    let cost = folds * FOLD_COST;
    for (const row of rows) {
      const scale = (width - GAP * (row.length - 1)) / cardsWidth(row);
      cost += row.length * Math.abs(Math.log(scale));
    }
    const aspect = width / height;
    cost += Math.max(0, Math.log(aspect / ASPECT_MAX)) + Math.max(0, Math.log(ASPECT_MIN / aspect));
    if (!best || cost < best.cost) best = { rows, width, cost };
  }
  return best;
}

/**
 * Deals the picked cards into rows. It starts from the page's own rows,
 * three KPI tiles over a chart staying three across with the chart beneath,
 * and also tries folding any row into fewer per row, down to one under the
 * other. Each arrangement is priced (see `price`) on how far it has to
 * redraw cards and how far the picture strays from a landscape shape, and
 * the cheapest wins. So three tiles alone stack instead of making a ribbon,
 * and a donut is never pulled wide to match a row of tiles.
 */
function planLayout(boxes: Box[]): Layout {
  const pageRows = runs(boxes, "y").flatMap((band) => {
    const across = [...band].sort((a, b) => a.x - b.x);
    // Cards stacked inside a band (a column of two beside a tall one) cannot
    // share one row; they each get their own, top to bottom.
    const overlap = across.some((b, i) => i > 0 && b.x < across[i - 1].x + across[i - 1].w - 1);
    return overlap ? [...band].sort((a, b) => a.y - b.y).map((b) => [b]) : [across];
  });

  // Each row as it is, or dealt k to a row for every smaller k. Past a few
  // thousand combinations, only all as on the page or all one per row.
  const options = pageRows.map((row) => row.map((_, i) => chunk(row, row.length - i)));
  const combos = options.reduce((n, o) => n * o.length, 1);
  const plans: { rows: Box[][]; folds: number }[] = [];
  if (combos <= 4000) {
    const walk = (r: number, rows: Box[][], folds: number) => {
      if (r === options.length) {
        plans.push({ rows, folds });
        return;
      }
      options[r].forEach((dealt, i) => walk(r + 1, [...rows, ...dealt], folds + (i > 0 ? 1 : 0)));
    };
    walk(0, [], 0);
  } else {
    plans.push({ rows: pageRows, folds: 0 });
    plans.push({ rows: boxes.map((b) => [b]), folds: pageRows.filter((r) => r.length > 1).length });
  }

  let best: Layout | null = null;
  for (const plan of plans) {
    const layout = price(plan.rows, plan.folds);
    if (layout && (!best || layout.cost < best.cost)) best = layout;
  }
  // Nothing suits every card's range: one per row at the widest card's width.
  return best ?? { rows: boxes.map((b) => [b]), width: Math.max(...boxes.map((b) => b.w)), cost: 0 };
}

/**
 * Captures a card at a width of the image's choosing. A card that has to
 * come out wider or narrower than it sits on the page is given that width
 * for the moment of the capture, so its charts redraw to fill it rather
 * than being stretched as a picture, then handed its own width back.
 */
async function captureAt(
  el: HTMLElement,
  width: number,
  options: Parameters<typeof toCanvas>[1],
): Promise<HTMLCanvasElement> {
  if (Math.abs(width - el.getBoundingClientRect().width) < 1) return toCanvas(el, options);
  const { style } = el;
  const saved = { width: style.width, maxWidth: style.maxWidth, minWidth: style.minWidth, flex: style.flex };
  style.width = `${width}px`;
  style.maxWidth = "none";
  style.minWidth = "0";
  style.flex = "none";
  try {
    await settled(el);
    return await toCanvas(el, options);
  } finally {
    Object.assign(style, saved);
  }
}

/**
 * The picked cards as one PNG on the theme's background with an even margin
 * all round. Every row runs the full width of the picture (see
 * `planLayout`): each card is redrawn at the width its row needs (see
 * `captureAt`), in proportion to its neighbours, so no row stops short and
 * leaves a hole. Drawn at 2× for sharp text.
 */
export async function buildSnapshotPng(elements: HTMLElement[]): Promise<Blob> {
  if (!elements.length) throw new Error("nothing picked");
  const bg = cssVar("--t-base", "#0b0b0c");
  // The page's own faces, embedded once and shared by every card, so the
  // image is set in Familjen and Overpass rather than a system fallback.
  // Collected from the whole page, not the first card, so a face only a
  // later card uses is embedded too.
  const fontRoot = document.querySelector<HTMLElement>("main") ?? elements[0];
  const fontEmbedCSS = await getFontEmbedCSS(fontRoot).catch(() => undefined);
  const options = { pixelRatio: RATIO, cacheBust: true, fontEmbedCSS, skipFonts: fontEmbedCSS == null };

  // WebKit (Safari, and every browser on an iPhone) loads the fonts embedded
  // in a capture only as it draws it, so the first capture came out in the
  // system face: heavier figures, labels wrapping. Throwaway draws first,
  // small and quick, get the faces loaded before any card that counts; one
  // is not always enough there, so two.
  if (isWebKit()) {
    for (let i = 0; i < 2; i++) {
      await toCanvas(elements[0], { ...options, pixelRatio: 1 }).catch(() => undefined);
    }
  }

  const { rows, width } = planLayout(
    elements.map((el) => {
      const r = el.getBoundingClientRect();
      return { el, x: r.left, y: r.top, w: r.width, h: r.height, range: stretchRange(el, r.width) };
    }),
  );

  const shots: HTMLCanvasElement[][] = [];
  for (const row of rows) {
    const scale = (width - GAP * (row.length - 1)) / row.reduce((s, b) => s + b.w, 0);
    const shotsInRow: HTMLCanvasElement[] = [];
    for (const box of row) {
      const restore = resolveSvgVars(box.el);
      try {
        shotsInRow.push(await captureAt(box.el, Math.round(box.w * scale), options));
      } finally {
        restore();
      }
    }
    shots.push(shotsInRow);
  }

  const pad = PAD * RATIO;
  const gap = GAP * RATIO;
  const heights = shots.map((row) => Math.max(...row.map((c) => c.height)));
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * RATIO) + pad * 2;
  canvas.height = heights.reduce((s, h) => s + h, 0) + gap * (heights.length - 1) + pad * 2;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  let y = pad;
  shots.forEach((row, r) => {
    let x = pad;
    for (const shot of row) {
      ctx.drawImage(shot, x, y);
      x += shot.width + gap;
    }
    y += heights[r] + gap;
  });

  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("encode failed"))), "image/png"),
  );
}
