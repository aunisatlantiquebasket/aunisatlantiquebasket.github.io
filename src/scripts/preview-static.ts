// Prévisualise le site statique (dossier site/) comme le ferait GitHub Pages : npm run preview:static
// /equipes → /equipes/ → equipes/index.html ; adresse inconnue → 404.html
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve("site");
const PORT = Number(process.env.PORT ?? 4000);
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp",
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  let file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    if ((await stat(file)).isDirectory()) {
      if (!url.pathname.endsWith("/")) { res.writeHead(301, { Location: url.pathname + "/" + url.search }).end(); return; }
      file = path.join(file, "index.html");
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" }).end(await readFile(file));
  } catch {
    res.writeHead(404, { "Content-Type": TYPES[".html"] }).end(await readFile(path.join(ROOT, "404.html")).catch(() => "404"));
  }
}).listen(PORT, () => console.log(`Site statique : http://localhost:${PORT}`));
