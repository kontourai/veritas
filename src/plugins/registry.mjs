const registry = new Map();

export function registerPlugin(plugin) {
  if (!plugin?.name) throw new Error('Plugin must have a name');
  registry.set(plugin.name, plugin);
}

export function getPlugin(name) {
  return registry.get(name);
}

export function listPlugins() {
  return [...registry.values()];
}
