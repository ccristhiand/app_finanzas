// server/services/movimientos.service.js
const pool = require('../config/db');

/**
 * Recalcula el monto y el estado del movimiento cabecera a partir de sus
 * detalles. Con la mejora v5, cada detalle tiene su propio tipo_movimiento
 * (ingreso/gasto), por lo que el monto resultante es el NETO:
 *
 *   montoNeto = SUM(detalle.monto WHERE tipo = 'ingreso')
 *             - SUM(detalle.monto WHERE tipo = 'gasto')
 *
 * El tipo_movimiento de la cabecera se ajusta automáticamente según el signo:
 *   - montoNeto >= 0 → 'ingreso', monto = montoNeto
 *   - montoNeto <  0 → 'gasto',   monto = abs(montoNeto)
 *
 * Estado: 'pagado' solo si TODOS los detalles están pagados.
 * Si se eliminó el último detalle, tiene_detalle vuelve a 0 y el movimiento
 * queda editable manualmente (monto/tipo/estado propios).
 */
async function recalcularMovimiento(movimiento_id, usuario_id, io) {
  const [detalles] = await pool.query(
    'SELECT monto, estado, tipo_movimiento FROM movimiento_detalles WHERE movimiento_id = ?',
    [movimiento_id]
  );

  if (detalles.length === 0) {
    // Sin detalles → vuelve a modo manual
    await pool.query(
      'UPDATE movimientos SET tiene_detalle = 0 WHERE id = ?',
      [movimiento_id]
    );
  } else {
    // Calcular monto neto considerando el tipo de cada detalle
    let montoNeto = 0;
    for (const d of detalles) {
      const monto = parseFloat(d.monto);
      montoNeto += d.tipo_movimiento === 'ingreso' ? monto : -monto;
    }

    const todoPagado = detalles.every(d => d.estado === 'pagado');
    const nuevoEstado = todoPagado ? 'pagado' : 'pendiente';
    const nuevoTipo = montoNeto >= 0 ? 'ingreso' : 'gasto';
    const montoAbsoluto = Math.abs(montoNeto).toFixed(2);

    await pool.query(
      `UPDATE movimientos
       SET monto = ?, estado = ?, tipo_movimiento = ?, tiene_detalle = 1
       WHERE id = ?`,
      [montoAbsoluto, nuevoEstado, nuevoTipo, movimiento_id]
    );
  }

  // Devolver el movimiento actualizado con JOIN a categorias y conteo de detalles
  const [rows] = await pool.query(
    `SELECT m.*,
       c.nombre AS categoria_nombre, c.tipo AS categoria_tipo, c.color AS categoria_color,
       (SELECT COUNT(*) FROM movimiento_detalles d WHERE d.movimiento_id = m.id) AS detalles_count
     FROM movimientos m
     LEFT JOIN categorias c ON c.id = m.categoria_id
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