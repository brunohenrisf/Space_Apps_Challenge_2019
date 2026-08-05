/**
 * Rate limit em memória, por IP.
 *
 * A URL do QR Code é pública: sem isso, um único cliente pode encher o disco
 * ou brutar a senha do painel. Estado em memória basta — é um servidor só,
 * ligado durante a festa, e reiniciar zera os contadores sem prejuízo.
 */
export function rateLimit({ windowMs, max, message }) {
  const hits = new Map();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, windowMs);
  sweep.unref();

  return function limiter(req, res, next) {
    const now = Date.now();
    const key = req.ip ?? 'desconhecido';
    let entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }

    entry.count += 1;

    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: message, retryAfter });
    }

    return next();
  };
}
