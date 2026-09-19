'use strict';
/**
 * CLIENTE HTTP PARA INTERFACES CONSUMIDAS
 * 
 * En el diagrama UML, cuando un componente dibuja un "socket" (interfaz
 * requerida) hacia otro, en el codigo eso es esta funcion. Incluye:
 *  - token interno (la interfaz no es publica),
 *  - propagacion del correlation-id (trazabilidad end-to-end),
 *  - TIMEOUT: si la dependencia se cuelga, yo no me cuelgo. Fallo rapido en vez
 *    de agotar mis conexiones y arrastrar a todo el sistema.
 */
const config = require('./config');

async function callInternal(url, { method = 'GET', body, correlationId, timeoutMs = 3000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': config.internalToken,
        'X-Correlation-Id': correlationId || 'sin-cid'
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    const texto = await res.text();
    let datos = null;
    try { datos = texto ? JSON.parse(texto) : null; } catch (_) { datos = { raw: texto }; }
    return { ok: res.ok, status: res.status, datos };
  } catch (err) {
    // Degradacion controlada: el llamador decide que hacer si la dependencia falla.
    return { ok: false, status: 503, datos: { error: `Dependencia no disponible: ${err.message}` } };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { callInternal };