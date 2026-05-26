import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { listPlugins, registerPlugin } from './registry.mjs';

function pluginSpecifier(packageName, rootDir) {
  if (packageName.startsWith('.') || packageName.startsWith('/')) {
    return pathToFileURL(resolve(rootDir, packageName)).href;
  }
  return packageName;
}

export async function loadPluginsFromConfig(repoMapConfig, rootDir = process.cwd()) {
  const pluginEntries = Array.isArray(repoMapConfig?.plugins) ? repoMapConfig.plugins : [];
  for (const entry of pluginEntries) {
    if (!entry?.package) continue;
    try {
      const mod = await import(pluginSpecifier(entry.package, rootDir));
      const plugin = mod.default ?? mod;
      registerPlugin({ ...plugin, _inputFile: entry.inputFile ?? null });
    } catch (error) {
      throw new Error(`Failed to load Veritas plugin "${entry.package}": ${error.message}`);
    }
  }
}

export function collectPluginEvidence(claimStore, context) {
  const evidence = [];
  for (const plugin of listPlugins()) {
    const claimTypes = Array.isArray(plugin.claimTypes) ? plugin.claimTypes : [];
    const matchingClaims = claimStore.claims.filter((claim) =>
      claimTypes.some((claimType) => claimType.id === claim.claimType),
    );
    if (matchingClaims.length === 0) continue;

    let rawOutput = '';
    if (plugin._inputFile) {
      const inputPath = resolve(context.rootDir, plugin._inputFile);
      if (existsSync(inputPath)) rawOutput = readFileSync(inputPath, 'utf8');
    }

    const pluginEvidence = plugin.importEvidence(rawOutput, matchingClaims, context) ?? [];
    for (const item of pluginEvidence) {
      evidence.push({
        ...item,
        metadata: {
          ...item.metadata,
          _plugin: {
            name: plugin.name,
            version: plugin.version,
            author: plugin.author,
          },
        },
      });
    }
  }
  return evidence;
}
