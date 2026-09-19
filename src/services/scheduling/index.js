'use strict';
/**
 * COMPONENTE: scheduling-service      <<< AQUI SE DEMUESTRA ACID >>>
 * 
 * Interfaz EXPUESTA : IAgenda (especialidades, medicos, cupos, reservar cita)
 *                     IRelacionClinica (interna, la consume records-service)
 * Interfaces CONSUMIDAS: ninguna
 *
 * El problema real: dos pacientes tocan "reservar" sobre el MISMO cupo en el
 * mismo instante. Sin control, los dos reservan y el medico tiene doble agenda.
 * Solucion: transaccion con SELECT ... FOR UPDATE (bloqueo pesimista de fila).
 */
const { createApp, listen, errorHandler } = require('../../shared/server');
const { query, withTransaction, waitForDb } = require('../../shared/db');
const { requireAuth, requireInternal } = require('../../shared/auth');

const NOMBRE = 'scheduling-service';
const app = createApp(NOMBRE);

// --- HU1: reservar citas segun especialidad, doctor, dia y hora -------------

app.get('/api/scheduling/especialidades', requireAuth(), async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM scheduling.especialidades ORDER BY nombre');
    res.json({ especialidades: rows });
  } catch (err) { next(err); }
});

app.get('/api/scheduling/medicos', requireAuth(), async (req, res, next) => {
  try {
    const { especialidad } = req.query;
    const { rows } = await query(
      `SELECT m.id, m.nombre, e.nombre AS especialidad
       FROM scheduling.medicos m
       JOIN scheduling.especialidades e ON e.id = m.especialidad_id
       WHERE ($1::int IS NULL OR e.id = $1::int)
       ORDER BY m.nombre`,
      [especialidad || null]
    );
    res.json({ medicos: rows });
  } catch (err) { next(err); }
});

/** GET /api/scheduling/slots?medico=<uuid>&fecha=YYYY-MM-DD -> cupos libres */
app.get('/api/scheduling/slots', requireAuth(), async (req, res, next) => {
  try {
    const { medico, fecha } = req.query;
    if (!medico) return res.status(400).json({ error: 'Falta el parametro medico' });

    const { rows } = await query(
      `SELECT id, inicio, estado
       FROM scheduling.agenda_slots
       WHERE medico_id = $1
         AND estado = 'LIBRE'
         AND ($2::date IS NULL OR inicio::date = $2::date)
       ORDER BY inicio
       LIMIT 50`,
      [medico, fecha || null]
    );
    res.json({ cantidad: rows.length, slots: rows });
  } catch (err) { next(err); }
});

/**
 * POST /api/scheduling/citas   body: { slotId, forzarError? }
 * 
 * *** NUCLEO DE LA DEMO ACID ***
 *
 * Paso a paso de lo que garantiza cada propiedad:
 *  1) BEGIN
 *  2) SELECT ... FOR UPDATE  -> AISLAMIENTO. La fila del cupo queda bloqueada.
 *     Si otra transaccion intenta lo mismo, se QUEDA ESPERANDO en esta linea
 *     hasta que la primera haga COMMIT. Cuando despierta, lee el estado ya
 *     actualizado ('RESERVADO') y aborta con 409. Nunca hay doble reserva.
 *  3) UPDATE del cupo + INSERT de la cita -> ATOMICIDAD: si el INSERT falla, el
 *     UPDATE tambien se deshace y el cupo vuelve a quedar LIBRE.
 *  4) COMMIT -> DURABILIDAD.
 *
 * El flag forzarError=true simula una falla despues del UPDATE para mostrar en
 * vivo el ROLLBACK (script 04).
 */
app.post('/api/scheduling/citas', requireAuth(['paciente']), async (req, res, next) => {
  const { slotId, forzarError } = req.body || {};
  if (!slotId) return res.status(400).json({ error: 'Falta slotId' });

  try {
    const cita = await withTransaction(async (client) => {
      // (2) BLOQUEO PESIMISTA de la fila del cupo.
      const { rows } = await client.query(
        `SELECT id, medico_id, inicio, estado
         FROM scheduling.agenda_slots
         WHERE id = $1
         FOR UPDATE`,
        [slotId]
      );

      const slot = rows[0];
      if (!slot) {
        const e = new Error('El cupo no existe'); e.status = 404; throw e;
      }
      // Quien llega segundo ve el estado ya actualizado por el primero.
      if (slot.estado !== 'LIBRE') {
        const e = new Error('El cupo ya fue reservado por otro paciente'); e.status = 409; throw e;
      }

      // (3a) Marcamos el cupo como ocupado.
      await client.query(
        `UPDATE scheduling.agenda_slots SET estado='RESERVADO' WHERE id=$1`, [slotId]
      );

      // Simulacion de falla para demostrar el ROLLBACK.
      if (forzarError) {
        throw new Error('FALLA SIMULADA despues del UPDATE: el cupo debe volver a LIBRE');
      }

      // (3b) Creamos la cita. Si esto explota, el UPDATE de arriba se revierte.
      const ins = await client.query(
        `INSERT INTO scheduling.citas (slot_id, paciente_id, medico_id)
         VALUES ($1,$2,$3)
         RETURNING id, slot_id, paciente_id, medico_id, estado, creada_en`,
        [slotId, req.usuario.id, slot.medico_id]
      );

      return { ...ins.rows[0], inicio: slot.inicio };
    });

    res.status(201).json({ mensaje: 'Cita reservada', cita });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    // 23505 = violacion de UNIQUE: la red de seguridad del motor actuo.
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Cupo ya reservado (constraint UNIQUE)' });
    }
    next(err);
  }
});

app.get('/api/scheduling/citas/mias', requireAuth(['paciente']), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.id, c.estado, s.inicio, m.nombre AS medico
       FROM scheduling.citas c
       JOIN scheduling.agenda_slots s ON s.id = c.slot_id
       JOIN scheduling.medicos m      ON m.id = c.medico_id
       WHERE c.paciente_id = $1
       ORDER BY s.inicio`,
      [req.usuario.id]
    );
    res.json({ citas: rows });
  } catch (err) { next(err); }
});

/** Agenda del medico logueado (HU5: saber a quien esta atendiendo). */
app.get('/api/scheduling/citas/agenda', requireAuth(['medico']), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.id, c.paciente_id, c.estado, s.inicio
       FROM scheduling.citas c
       JOIN scheduling.agenda_slots s ON s.id = c.slot_id
       WHERE c.medico_id = $1 AND c.estado IN ('AGENDADA','EN_CURSO')
       ORDER BY s.inicio`,
      [req.usuario.id]
    );
    res.json({ citas: rows });
  } catch (err) { next(err); }
});

/**
 * POST /api/scheduling/citas/:id/iniciar
 * Marca la consulta como EN_CURSO. Esto es lo que HABILITA al medico a leer la
 * historia clinica: sin consulta en curso, records-service le niega el acceso.
 */
app.post('/api/scheduling/citas/:id/iniciar', requireAuth(['medico']), async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE scheduling.citas SET estado='EN_CURSO'
       WHERE id=$1 AND medico_id=$2 AND estado='AGENDADA'
       RETURNING id, paciente_id, estado`,
      [req.params.id, req.usuario.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Cita no encontrada o no agendada' });
    res.json({ mensaje: 'Consulta iniciada', cita: rows[0] });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// INTERFAZ INTERNA: IRelacionClinica  (la consume records-service)
// No pasa por el gateway: solo se puede invocar desde la red interna con token.
// ---------------------------------------------------------------------------
app.get('/api/scheduling/internal/relacion', requireInternal, async (req, res, next) => {
  try {
    const { medicoId, pacienteId } = req.query;
    const { rows } = await query(
      `SELECT 1 FROM scheduling.citas
       WHERE medico_id=$1 AND paciente_id=$2 AND estado='EN_CURSO' LIMIT 1`,
      [medicoId, pacienteId]
    );
    // Contrato simple y explicito: el que decide el permiso final es records.
    res.json({ consultaEnCurso: rows.length > 0 });
  } catch (err) { next(err); }
});

app.use(errorHandler(NOMBRE));

(async () => { await waitForDb(); listen(app, NOMBRE); })();