// server/services/movimientos.service.js
const pool = require('../config/db');

/**
 * Recalcula el monto y el estado de un movimiento en función de sus
 * detalles:
 *  - Si tiene detalles: monto = SUM(detalle.monto), estado = 'pagado'
 *    solo si TODOS los detalles están pagados, y tiene_detalle = 1.
 *  - Si ya no tiene detalles (se eliminó el último): tiene_detalle = 0
 *    y el movimiento vuelve a ser editable manualmente (se respeta el
 *    monto/estado que ya tenía guardado).
 *
 * Emite 'movimiento:actualizado' por socket para que el dashboard y el
 * checklist se refresquen en tiempo real, igual que ya hace el resto
 * del CRUD de movimientos.
 */
async function recalcularMovimiento(movimiento_id, usuario_id, io) {
  const [detalles] = await pool.query(
    'SELECT monto, estado FROM movimiento_detalles WHERE movimiento_id = ?',
    [movimiento_id]
  );

  if (detalles.length === 0) {
    await pool.query(
      'UPDATE movimientos SET tiene_detalle = 0 WHERE id = ?',
      [movimiento_id]
    );
  } else {
    const montoTotal = detalles.reduce((acc, d) => acc + parseFloat(d.monto), 0);
    const todoPagado = detalles.every(d => d.estado === 'pagado');
    const nuevoEstado = todoPagado ? 'pagado' : 'pendiente';

    await pool.query(
      'UPDATE movimientos SET monto = ?, estado = ?, tiene_detalle = 1 WHERE id = ?',
      [montoTotal.toFixed(2), nuevoEstado, movimiento_id]
    );
  }

  const [rows] = await pool.query(
    `SELECT m.*, c.nombre AS categoria_nombre, c.tipo AS categoria_tipo, c.color AS categoria_color,
      (SELECT COUNT(*) FROM movimiento_detalles d WHERE d.movimiento_id = m.id) AS detalles_count
     FROM movimientos m
     JOIN categorias c ON c.id = m.categoria_id
     WHERE m.id = ?`,
    [movimiento_id]
  );

  const actualizado = rows[0] || null;

  if (io && actualizado) {
    io.to(`usuario_${usuario_id}`).emit('movimiento:actualizado', actualizado);
  }

  return actualizado;
}

module.exports = { recalcularMovimiento };