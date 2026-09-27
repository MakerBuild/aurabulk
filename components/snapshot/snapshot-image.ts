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
const FOOTER = 30;

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/**
 * The picked cards as one PNG: stacked in page order on the theme's own
 * background, each centred, with a small credit line along the bottom so a
 * shared image says where it came from. Drawn at 2× for sharp text.
 */
export async function buildSnapshotPng(elements: HTMLElement[]): Promise<Blob> {
  if (!elements.length) throw new Error("nothing picked");
  const bg = cssVar("--t-base", "#0b0b0c");
  // The page's own faces, embedded once and shared by every card, so the
  // image is set in Familjen and Overpass rather than a system fallback.
  const fontEmbedCSS = await getFontEmbedCSS(elements[0]).catch(() => undefined);

  const shots: HTMLCanvasElement[] = [];
  for (const el of elements) {
    const restore = resolveSvgVars(el);
    try {
      shots.push(
        await toCanvas(el, {
          pixelRatio: RATIO,
          cacheBust: true,
          fontEmbedCSS,
          skipFonts: fontEmbedCSS == null,
        }),
      );
    } finally {
      restore();
    }
  }

  const pad = PAD * RATIO;
  const gap = GAP * RATIO;
  const footer = FOOTER * RATIO;
  const width = Math.max(...shots.map((c) => c.width)) + pad * 2;
  const height = pad + shots.reduce((sum, c) => sum + c.height, 0) + gap * (shots.length - 1) + footer + pad / 2;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  let y = pad;
  for (const shot of shots) {
    ctx.drawImage(shot, Math.round((width - shot.width) / 2), y);
    y += shot.height + gap;
  }

  // Credit line: the product on the left, where and when on the right.
  const family = cssVar("--font-familjen", "system-ui");
  const mono = cssVar("--font-overpass-mono", "ui-monospace");
  const baseline = height - pad / 2 - footer / 2 + 4 * RATIO;
  ctx.textBaseline = "middle";
  ctx.font = `600 ${11 * RATIO}px ${family}`;
  ctx.fillStyle = cssVar("--t-accent", "#ffb547");
  ctx.textAlign = "left";
  ctx.fillText("BULK INTELLIGENCE", pad, baseline);
  const stamp = new Date().toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
  ctx.font = `400 ${11 * RATIO}px ${mono}`;
  ctx.fillStyle = cssVar("--t-text-muted", "#8b8580");
  ctx.textAlign = "right";
  ctx.fillText(`aurabulk.xyz · ${stamp} UTC`, width - pad, baseline);

  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("encode failed"))), "image/png"),
  );
}
