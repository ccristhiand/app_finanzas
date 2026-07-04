// server/controllers/detalles.controller.js
const pool = require('../config/db');
const { recalcularMovimiento } = require('../services/movimientos.service');

function getIO(req) {
  return req.app.get('io');
}

async function verificarPropiedadMovimiento(movimiento_id, usuario_id) {
  const [rows] = await pool.query(
    'SELECT id FROM movimientos WHERE id = ? AND usuario_id = ?',
    [movimiento_id, usuario_id]
  );
  return rows.length > 0;
}

async function obtenerDetalleDelUsuario(detalle_id, usuario_id) {
  const [rows] = await pool.query(
    `SELECT d.*, m.usuario_id
     FROM movimiento_detalles d
     JOIN movimientos m ON m.id = d.movimiento_id
     WHERE d.id = ?`,
    [detalle_id]
  );
  if (rows.length === 0 || rows[0].usuario_id !== usuario_id) return null;
  return rows[0];
}

// GET /api/detalles/movimiento/:movimientoId
async function listarPorMovimiento(req, res) {
  try {
    const { movimientoId } = req.params;
    const usuario_id = req.usuario.id;

    const esDelUsuario = await verificarPropiedadMovimiento(movimientoId, usuario_id);
    if (!esDelUsuario) {
      return res.status(404).json({ ok: false, mensaje: 'Movimiento no encontrado' });
    }

    const [rows] = await pool.query(
      `SELECT d.*, cd.nombre AS categoria_detalle_nombre, cd.color AS categoria_detalle_color
       FROM movimiento_detalles d
       LEFT JOIN categorias_detalle cd ON cd.id = d.categoria_detalle_id
       WHERE d.movimiento_id = ?
       ORDER BY d.fecha ASC, d.hora ASC, d.id ASC`,
      [movimientoId]
    );
    return res.json({ ok: true, data: rows });
  } catch (error) {
    console.error('Error al listar detalles:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor' });
  }
}

// POST /api/detalles/movimiento/:movimientoId
async function crear(req, res) {
  try {
    const { movimientoId } = req.params;
    const usuario_id = req.usuario.id;
    const { concepto, monto, fecha, hora, estado, categoria_detalle_id } = req.body;

    if (!concepto || monto === undefined || monto === null || monto === '' || !fecha) {
      return res.status(400).json({ ok: false, mensaje: 'Faltan campos obligatorios' });
    }

    const esDelUsuario = await verificarPropiedadMovimiento(movimientoId, usuario_id);
    if (!esDelUsuario) {
      return res.status(404).json({ ok: false, mensaje: 'Movimiento no encontrado' });
    }

    const [result] = await pool.query(
      `INSERT INTO movimiento_detalles (movimiento_id, concepto, monto, fecha, hora, estado, categoria_detalle_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [movimientoId, concepto, monto, fecha, hora || null, estado || 'pendiente', categoria_detalle_id || null]
    );

    const [rows] = await pool.query(
      `SELECT d.*, cd.nombre AS categoria_detalle_nombre, cd.color AS categoria_detalle_color
       FROM movimiento_detalles d LEFT JOIN categorias_detalle cd ON cd.id = d.categoria_detalle_id
       WHERE d.id = ?`,
      [result.insertId]
    );
    const nuevoDetalle = rows[0];

    const movimientoActualizado = await recalcularMovimiento(movimientoId, usuario_id, getIO(req));
    getIO(req).to(`usuario_${usuario_id}`).emit('detalle:creado', {
      detalle: nuevoDetalle,
      movimiento: movimientoActualizado
    });

    return res.status(201).json({ ok: true, data: nuevoDetalle, movimiento: movimientoActualizado });
  } catch (error) {
    console.error('Error al crear detalle:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor' });
  }
}

// PUT /api/detalles/:id
async function actualizar(req, res) {
  try {
    const { id } = req.params;
    const usuario_id = req.usuario.id;
    const { concepto, monto, fecha, hora, estado, categoria_detalle_id } = req.body;

    const detalleActual = await obtenerDetalleDelUsuario(id, usuario_id);
    if (!detalleActual) {
      return res.status(404).json({ ok: false, mensaje: 'Detalle no encontrado' });
    }

    if (!concepto || monto === undefined || monto === null || monto === '' || !fecha) {
      return res.status(400).json({ ok: false, mensaje: 'Faltan campos obligatorios' });
    }

    await pool.query(
      `UPDATE movimiento_detalles SET concepto = ?, monto = ?, fecha = ?, hora = ?, estado = ?, categoria_detalle_id = ?
       WHERE id = ?`,
      [concepto, monto, fecha, hora || null, estado || 'pendiente', categoria_detalle_id || null, id]
    );

    const [rows] = await pool.query(
      `SELECT d.*, cd.nombre AS categoria_detalle_nombre, cd.color AS categoria_detalle_color
       FROM movimiento_detalles d LEFT JOIN categorias_detalle cd ON cd.id = d.categoria_detalle_id
       WHERE d.id = ?`,
      [id]
    );
    const detalleActualizado = rows[0];

    const movimientoActualizado = await recalcularMovimiento(
      detalleActual.movimiento_id, usuario_id, getIO(req)
    );
    getIO(req).to(`usuario_${usuario_id}`).emit('detalle:actualizado', {
      detalle: detalleActualizado,
      movimiento: movimientoActualizado
    });

    return res.json({ ok: true, data: detalleActualizado, movimiento: movimientoActualizado });
  } catch (error) {
    console.error('Error al actualizar detalle:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor' });
  }
}

// PATCH /api/detalles/:id/estado  { estado: 'pagado' | 'pendiente' }
async function cambiarEstado(req, res) {
  try {
    const { id } = req.params;
    const { estado } = req.body;
    const usuario_id = req.usuario.id;

    if (!['pendiente', 'pagado'].includes(estado)) {
      return res.status(400).json({ ok: false, mensaje: 'Estado inválido' });
    }

    const detalleActual = await obtenerDetalleDelUsuario(id, usuario_id);
    if (!detalleActual) {
      return res.status(404).json({ ok: false, mensaje: 'Detalle no encontrado' });
    }

    await pool.query('UPDATE movimiento_detalles SET estado = ? WHERE id = ?', [estado, id]);

    const [rows] = await pool.query(
      `SELECT d.*, cd.nombre AS categoria_detalle_nombre, cd.color AS categoria_detalle_color
       FROM movimiento_detalles d LEFT JOIN categorias_detalle cd ON cd.id = d.categoria_detalle_id
       WHERE d.id = ?`,
      [id]
    );
    const detalleActualizado = rows[0];

    const movimientoActualizado = await recalcularMovimiento(
      detalleActual.movimiento_id, usuario_id, getIO(req)
    );
    getIO(req).to(`usuario_${usuario_id}`).emit('detalle:actualizado', {
      detalle: detalleActualizado,
      movimiento: movimientoActualizado
    });

    return res.json({ ok: true, data: detalleActualizado, movimiento: movimientoActualizado });
  } catch (error) {
    console.error('Error al cambiar estado de detalle:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor' });
  }
}

// PATCH /api/detalles/:id/mover  { movimiento_id: <destinoId> }
// Mueve un detalle de un movimiento a otro (drag & drop desde el checklist).
async function mover(req, res) {
  try {
    const { id } = req.params;
    const { movimiento_id: nuevoMovimientoId } = req.body;
    const usuario_id = req.usuario.id;

    if (!nuevoMovimientoId) {
      return res.status(400).json({ ok: false, mensaje: 'Falta el movimiento destino' });
    }

    const detalleActual = await obtenerDetalleDelUsuario(id, usuario_id);
    if (!detalleActual) {
      return res.status(404).json({ ok: false, mensaje: 'Detalle no encontrado' });
    }

    const destinoEsDelUsuario = await verificarPropiedadMovimiento(nuevoMovimientoId, usuario_id);
    if (!destinoEsDelUsuario) {
      return res.status(404).json({ ok: false, mensaje: 'Movimiento destino no encontrado' });
    }

    if (String(detalleActual.movimiento_id) === String(nuevoMovimientoId)) {
      return res.status(400).json({ ok: false, mensaje: 'El detalle ya pertenece a ese movimiento' });
    }

    const movimientoOrigenId = detalleActual.movimiento_id;
    await pool.query('UPDATE movimiento_detalles SET movimiento_id = ? WHERE id = ?', [nuevoMovimientoId, id]);

    const [movimientoOrigen, movimientoDestino] = await Promise.all([
      recalcularMovimiento(movimientoOrigenId, usuario_id, getIO(req)),
      recalcularMovimiento(nuevoMovimientoId, usuario_id, getIO(req))
    ]);

    const [rows] = await pool.query(
      `SELECT d.*, cd.nombre AS categoria_detalle_nombre, cd.color AS categoria_detalle_color
       FROM movimiento_detalles d LEFT JOIN categorias_detalle cd ON cd.id = d.categoria_detalle_id
       WHERE d.id = ?`,
      [id]
    );
    const detalleActualizado = rows[0];

    getIO(req).to(`usuario_${usuario_id}`).emit('detalle:movido', {
      detalle: detalleActualizado,
      movimiento_origen_id: movimientoOrigenId,
      movimiento_destino_id: Number(nuevoMovimientoId),
      movimientoOrigen,
      movimientoDestino
    });

    return res.json({
      ok: true,
      data: detalleActualizado,
      movimientoOrigen,
      movimientoDestino
    });
  } catch (error) {
    console.error('Error al mover detalle:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor' });
  }
}

// DELETE /api/detalles/:id
async function eliminar(req, res) {
  try {
    const { id } = req.params;
    const usuario_id = req.usuario.id;

    const detalleActual = await obtenerDetalleDelUsuario(id, usuario_id);
    if (!detalleActual) {
      return res.status(404).json({ ok: false, mensaje: 'Detalle no encontrado' });
    }

    const movimiento_id = detalleActual.movimiento_id;
    await pool.query('DELETE FROM movimiento_detalles WHERE id = ?', [id]);

    const movimientoActualizado = await recalcularMovimiento(movimiento_id, usuario_id, getIO(req));
    getIO(req).to(`usuario_${usuario_id}`).emit('detalle:eliminado', {
      id: Number(id),
      movimiento_id,
      movimiento: movimientoActualizado
    });

    return res.json({ ok: true, mensaje: 'Detalle eliminado correctamente', movimiento: movimientoActualizado });
  } catch (error) {
    console.error('Error al eliminar detalle:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor' });
  }
}

module.exports = { listarPorMovimiento, crear, actualizar, cambiarEstado, mover, eliminar };