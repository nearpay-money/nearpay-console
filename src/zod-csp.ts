/**
 * Must be the first import of the entry. The console's CSP has no 'unsafe-eval'; zod 4 decides at
 * schema construction (when `@nearpay-money/spec` loads) whether to probe `new Function` for its JIT
 * parser, and Chrome reports even the caught probe as a CSP violation. `jitless` skips the probe.
 * zod reads its global config from `globalThis.__zod_globalConfig`, so this needs no zod import.
 */
const g = globalThis as { __zod_globalConfig?: { jitless?: boolean } };
g.__zod_globalConfig ??= {};
g.__zod_globalConfig.jitless = true;

export {};
