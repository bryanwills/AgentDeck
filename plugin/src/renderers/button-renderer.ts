/**
 * Data-URL wrapper for the SVG the dials and keys render.
 *
 * The keypad button renderer that used to live here (label abbreviation, font
 * tiering, SVG frame) went with the actions that called it; the surviving
 * surfaces render through `session-slot-renderer` and the per-dial renderers.
 */
export function svgToDataUrl(svg: string): string {
  // Official SD SDK pattern: data:image/svg+xml,{encodeURIComponent}
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
