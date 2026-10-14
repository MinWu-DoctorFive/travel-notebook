/** Resolve files in public/ when the site is hosted below a GitHub Pages base path. */
export function resolveAssetPath(path: string, base: string): string {
  path = path.replace(/\/hebei-(cover|day)\.png$/, '/hebei-$1.webp');
  const inline = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(path);
  if (inline) {
    const encoded = inline[2];
    const bytes = encoded.length / 4 * 3 - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
    if (encoded.length % 4 === 0 && bytes > 0 && bytes <= 3 * 1024 * 1024) return path;
  }
  if (path.startsWith("data:")) throw new Error("图片格式无效或超过 3 MiB。");
  if (!/^\/[A-Za-z0-9_./-]+$/.test(path) || path.includes("..")) {
    throw new Error("图片路径无效。");
  }
  if (base === "./" || base === ".") return `./${path.slice(1)}`;
  const prefix = `/${base.replace(/^\/+|\/+$/g, "")}/`.replace(/^\/\/$/, "/");
  if (prefix !== "/" && path.startsWith(prefix)) return path;
  return `${prefix}${path.slice(1)}`;
}

export function assetUrl(path: string): string {
  return resolveAssetPath(path, (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL || "/");
}
