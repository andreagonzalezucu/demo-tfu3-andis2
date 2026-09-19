'use strict';
/**
 * COMPONENTE: notifications-service       (HU3)
 * 
 * Interfaz EXPUESTA : INotificaciones (bandeja del paciente)
 * Interfaz CONSUMIDA: canal pub/sub de Redis
 *
 * Es un SUSCRIPTOR: queue-service publica "acercate al mostrador" sin saber
 * quien escucha. Manana se agrega un componente que manda SMS suscribiendose al
 * mismo canal, sin tocar una linea de queue-service.
 * FACILIDAD DE MODIFICACION por bajo acoplamiento.
 */
const { createApp, listen, errorHandler } = require('../../shared/server');
const { requireAuth } = require('../../shared/auth');
const { getRedis, makeRedis, KEYS } = require('../../shared/redisClient');

const NOMBRE = 'notifications-service';
const app = createApp(NOMBRE);

/** GET /api/notifications/mias -> la app del paciente hace polling aca. */
app.get('/api/notifications/mias', requireAuth(['paciente']), async (req, res, next) => {
  try {
    const redis = await getRedis();
    const items = await redis.lRange(KEYS.notificaciones(req.usuario.id), 0, 19);
    res.json({ cantidad: items.length, notificaciones: items.map((i) => JSON.parse(i)) });
  } catch (err) { next(err); }
});

/** Suscripcion al canal donde queue-service publica los avisos. */
async function arrancarSuscriptor() {
  // En Redis, una conexion en modo suscripcion no puede ejecutar otros
  // comandos: por eso usamos dos clientes distintos.
  const suscriptor = await makeRedis('suscriptor');
  const escritor = await getRedis();

  await suscriptor.subscribe(KEYS.canalNotificaciones, async (mensaje) => {
    try {
      const n = JSON.parse(mensaje);
      // lPush + lTrim: guardamos las ultimas 20 notificaciones por paciente.
      // Estado blando (soft state), tipico de BASE: no necesita durabilidad.
      await escritor.lPush(KEYS.notificaciones(n.pacienteId), JSON.stringify(n));
      await escritor.lTrim(KEYS.notificaciones(n.pacienteId), 0, 19);
      console.log(`[${NOMBRE}] notificacion para ${n.pacienteId}: ${n.titulo}`);
    } catch (err) {
      console.error(`[${NOMBRE}] mensaje invalido:`, err.message);
    }
  });

  console.log(`[${NOMBRE}] suscrito a ${KEYS.canalNotificaciones}`);
}

app.use(errorHandler(NOMBRE));

(async () => {
  listen(app, NOMBRE);
  arrancarSuscriptor().catch((err) => console.error(`[${NOMBRE}] suscriptor caido:`, err));
})();