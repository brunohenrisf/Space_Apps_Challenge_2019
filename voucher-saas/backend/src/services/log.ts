// Log estruturado (JSON por linha) — fácil de coletar/observar em produção.
type Level = 'info' | 'warn' | 'error';

function emit(level: Level, event: string, data: Record<string, unknown>) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...data });
  (level === 'error' ? console.error : console.log)(line);
}

export const log = {
  info: (event: string, data: Record<string, unknown> = {}) => emit('info', event, data),
  warn: (event: string, data: Record<string, unknown> = {}) => emit('warn', event, data),
  error: (event: string, data: Record<string, unknown> = {}) => emit('error', event, data),
};
