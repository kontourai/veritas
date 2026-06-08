import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const host = "127.0.0.1";
const port = Number(process.env.PORT || 4185);
const basePath = "/veritas";
const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const siteRoot = resolve(repoRoot, ".site-dist");

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
]);

if (!existsSync(siteRoot)) {
  throw new Error(`Rendered site directory is missing: ${siteRoot}`);
}

const server = createServer((request, response) => {
  const requestUrl = new URL(request.url || "/", `http://${host}:${port}`);
  if (requestUrl.pathname === "/") {
    response.writeHead(302, { Location: `${basePath}/index.html` });
    response.end();
    return;
  }

  if (!requestUrl.pathname.startsWith(`${basePath}/`)) {
    respondNotFound(response);
    return;
  }

  const relativePath = decodeURIComponent(requestUrl.pathname.slice(basePath.length + 1));
  const resolvedPath = resolve(siteRoot, normalize(relativePath));
  if (!resolvedPath.startsWith(`${siteRoot}${sep}`) && resolvedPath !== siteRoot) {
    respondNotFound(response);
    return;
  }

  let filePath = resolvedPath;
  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, "index.html");
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    respondNotFound(response);
    return;
  }

  response.writeHead(200, {
    "Content-Type": contentTypes.get(extname(filePath)) || "application/octet-stream",
  });
  createReadStream(filePath).pipe(response);
});

server.listen(port, host, () => {
  console.log(`Serving ${siteRoot} at http://${host}:${port}${basePath}/`);
});

function respondNotFound(response) {
  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Not found");
}
