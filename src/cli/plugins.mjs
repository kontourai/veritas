import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadAdapterConfig } from '../load.mjs';
import { loadPluginsFromConfig } from '../plugins/loader.mjs';
import { listPlugins } from '../plugins/registry.mjs';

export async function runPluginCli(argv = process.argv.slice(2), { rootDir = process.cwd() } = {}) {
  const [subcommand] = argv;
  if (subcommand !== 'list') {
    throw new Error(`Unknown plugin subcommand: ${subcommand}. Use: list`);
  }
  const adapterPath = resolve(rootDir, '.veritas/repo.adapter.json');
  const config = existsSync(adapterPath) ? loadAdapterConfig(adapterPath) : {};
  await loadPluginsFromConfig(config, rootDir);
  const plugins = listPlugins();
  if (plugins.length === 0) {
    process.stdout.write('No plugins loaded. Add plugins to .veritas/repo.adapter.json.\n');
    return;
  }
  for (const plugin of plugins) {
    process.stdout.write(`${plugin.name}@${plugin.version}  by ${plugin.author?.name ?? 'unknown'}\n`);
    for (const claimType of plugin.claimTypes ?? []) {
      process.stdout.write(`  claim type: ${claimType.id}  (${claimType.displayName ?? claimType.id})\n`);
    }
  }
}
