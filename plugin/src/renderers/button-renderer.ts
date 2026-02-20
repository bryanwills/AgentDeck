import { ButtonConfig } from '../layout-manager.js';

const SIZE = 144; // Stream Deck+ high DPI

export function renderButton(config: ButtonConfig): string {
  const textOpacity = config.enabled ? '1' : '0.4';
  const lines = wrapText(config.title, 9);
  const lineHeight = 36;
  const startY = lines.length === 1 ? 84 : 84 - ((lines.length - 1) * lineHeight) / 2;

  const textElements = lines
    .map(
      (line, i) =>
        `<text x="72" y="${startY + i * lineHeight}" text-anchor="middle" font-family="Arial,sans-serif" font-size="28" font-weight="bold" fill="${config.textColor}" opacity="${textOpacity}">${escapeXml(line)}</text>`,
    )
    .join('');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">`,
    `<rect width="${SIZE}" height="${SIZE}" rx="12" fill="${config.color}"/>`,
    textElements,
    `</svg>`,
  ].join('');
}

export function svgToDataUrl(svg: string): string {
  // Official SD SDK pattern: data:image/svg+xml,{encodeURIComponent}
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function wrapText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current.length + word.length + (current ? 1 : 0) > maxChars) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
