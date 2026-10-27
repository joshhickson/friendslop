const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export function createLogger(level = 'info', prefix = '') {
  const min = LEVELS[level] ?? LEVELS.info;
  const stamp = () => new Date().toISOString().slice(11, 19);
  const make = (name, fn) => (...args) => {
    if (LEVELS[name] >= min) fn(`${stamp()} ${name.toUpperCase().padEnd(5)}${prefix ? ` [${prefix}]` : ''}`, ...args);
  };
  return {
    level,
    debug: make('debug', console.log),
    info: make('info', console.log),
    warn: make('warn', console.warn),
    error: make('error', console.error),
    child: (p) => createLogger(level, prefix ? `${prefix}:${p}` : p),
  };
}
