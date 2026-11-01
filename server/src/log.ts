const level = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
const quiet = level === 'silent';
const debug = level === 'debug';
const ts = () => new Date().toISOString().slice(11, 19);

export const log = {
  info: (...a: unknown[]) => !quiet && console.log(ts(), ...a),
  warn: (...a: unknown[]) => !quiet && console.warn(ts(), 'WARN', ...a),
  error: (...a: unknown[]) => console.error(ts(), 'ERROR', ...a),
  debug: (...a: unknown[]) => debug && console.log(ts(), 'DEBUG', ...a),
};
