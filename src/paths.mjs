import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';

export function normalizeRepoPath(filePath, rootDir) {
  return relative(rootDir, resolve(rootDir, filePath)).replaceAll('\\', '/');
}

export function relativeRepoPath(rootDir, candidatePath) {
  return relative(rootDir, resolve(candidatePath)).replaceAll('\\', '/');
}

function realPath(path) {
  return realpathSync.native ? realpathSync.native(path) : realpathSync(path);
}

function canonicalizeBoundaryPath(inputPath) {
  const resolvedPath = resolve(inputPath);

  if (existsSync(resolvedPath)) {
    return realPath(resolvedPath);
  }

  const missingSegments = [];
  let currentPath = resolvedPath;

  while (!existsSync(currentPath)) {
    const parentPath = dirname(currentPath);
    if (parentPath === currentPath) {
      break;
    }
    missingSegments.unshift(basename(currentPath));
    currentPath = parentPath;
  }

  const basePath = existsSync(currentPath) ? realPath(currentPath) : resolve(currentPath);
  return resolve(basePath, ...missingSegments);
}

export function assertWithinDir(candidatePath, allowedDir, errorMessage) {
  const relativePath = relative(
    canonicalizeBoundaryPath(allowedDir),
    canonicalizeBoundaryPath(candidatePath),
  );
  if (relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))) {
    return;
  }

  throw new Error(errorMessage ?? `Path ${candidatePath} escapes ${allowedDir}`);
}
