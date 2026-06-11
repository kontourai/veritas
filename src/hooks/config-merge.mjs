function mergeHookArrays(existingHooks = [], veritasHooks = []) {
  const veritasCommands = new Set(
    veritasHooks
      .map((hook) => hook?.command)
      .filter((command) => typeof command === 'string'),
  );
  const preservedHooks = existingHooks.filter(
    (hook) => !veritasCommands.has(hook?.command),
  );
  return [...preservedHooks, ...veritasHooks];
}

export function mergeStopHookConfig(existingConfig = {}, suggestedConfig = {}) {
  const mergedHooks = { ...(existingConfig.hooks ?? {}) };
  for (const [hookName, suggestedEntries] of Object.entries(suggestedConfig.hooks ?? {})) {
    const currentEntries = Array.isArray(mergedHooks[hookName])
      ? mergedHooks[hookName]
      : [];
    if (hookName === 'Stop') {
      const suggestedCommand = suggestedEntries[0]?.hooks?.[0]?.command;
      mergedHooks[hookName] = [
        ...currentEntries
          .map((entry) => {
            const hooks = Array.isArray(entry?.hooks) ? entry.hooks : [];
            const remainingHooks = hooks.filter(
              (hook) => hook?.command !== suggestedCommand,
            );
            return remainingHooks.length === 0
              ? null
              : { ...entry, hooks: remainingHooks };
          })
          .filter(Boolean),
        ...suggestedEntries,
      ];
      continue;
    }
    if (hookName === 'stop') {
      mergedHooks[hookName] = mergeHookArrays(currentEntries, suggestedEntries);
      continue;
    }
    mergedHooks[hookName] = suggestedEntries;
  }

  return {
    ...existingConfig,
    hooks: mergedHooks,
  };
}
