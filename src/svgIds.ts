/** Transform opening tags only, so text content cannot be mistaken for SVG attributes. */
export function drawingTags(markup: string, replace: (tag: string) => string): string {
  return markup.replace(/<(?:[^"'<>]|"[^"]*"|'[^']*')*>/g, replace);
}

/** Scope IDs and every local paint/clip/filter/use reference with the same prefix. */
export function prefixSvgIds(markup: string, prefix: string): string {
  const scope = `p-${Array.from(prefix).map(c => /[A-Za-z0-9-]/.test(c) ? c : `_${c.codePointAt(0)!.toString(16)}_`).join('')}-`;
  return drawingTags(markup, tag => tag
    .replace(/\sid\s*=\s*(["'])([^"']+)\1/g, (_m, q: string, id: string) => ` id=${q}${scope}${id}${q}`)
    .replace(/\s((?:xlink:)?href)\s*=\s*(["'])#([^"']+)\2/gi, (_m, attr: string, q: string, id: string) => ` ${attr}=${q}#${scope}${id}${q}`)
    .replace(/url\(\s*(["']?)#([^\s)'"\(]+)\1\s*\)/gi, (_m, _q: string, id: string) => `url(#${scope}${id})`));
}
