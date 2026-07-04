const pool = require('../config/db');
const { recalcularMovimiento } = require('../services/movimientos.service');

function getIO(req) {
  return req.app.get('io');
}

// GET /api/movimientos?anio=2026&mes=6
async function listar(req, res) {
  try {
    const { anio, mes, tipo_registro, estado } = req.query;
    let sql = `
      SELECT m.*, c.nombre AS categoria_nombre, c.tipo AS categoria_tipo, c.color AS categoria_color,
        (SELECT COUNT(*) FROM movimiento_detalles d WHERE d.movimiento_id = m.id) AS detalles_count
      FROM movimientos m
      JOIN categorias c ON c.id = m.categoria_id
      WHERE m.usuario_id = ?
    `;
    const params = [req.usuario.id];

    if (anio) {
      sql += ' AND m.anio = ?';
      params.push(anio);
    }
    if (mes) {
      sql += ' AND m.mes = ?';
      params.push(mes);
    }
    if (tipo_registro) {
      sql += ' AND m.tipo_registro = ?';
      params.push(tipo_registro);
    }
    if (estado) {
      sql += ' AND m.estado = ?';
      params.push(estado);
    }

    sql += ' ORDER BY m.anio DESC, m.mes DESC, m.fecha DESC, m.id DESC';

    const [rows] = await pool.query(sql, params);
    return res.json({ ok: true, data: rows });
  } catch (error) {
    console.error('Error al listar movimientos:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor' });
  }
}

// GET /api/movimientos/:id
async function obtener(req, res) {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT m.*, c.nombre AS categoria_nombre, c.tipo AS categoria_tipo,
        (SELECT COUNT(*) FROM movimiento_detalles d WHERE d.movimiento_id = m.id) AS detalles_count
       FROM movimientos m JOIN categorias c ON c.id = m.categoria_id
       WHERE m.id = ? AND m.usuario_id = ?`,
      [id, req.usuario.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, mensaje: 'Movimiento no encontrado' });
    }
    return res.json({ ok: true, data: rows[0] });
  } catch (error) {
    console.error('Error al obtener movimiento:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor' });
  }
}

// POST /api/movimientos
async function crear(req, res) {
  try {
    const {
      categoria_id, concepto, tipo_movimiento, monto,
      fecha, tipo_registro, estado, descripcion
    } = req.body;

    if (!categoria_id || !concepto || !tipo_movimiento || !monto || !fecha) {
      return res.status(400).json({ ok: false, mensaje: 'Faltan campos obligatorios' });
    }

    const usuario_id = req.usuario.id;

    const [result] = await pool.query(
      `INSERT INTO movimientos
        (usuario_id, categoria_id, concepto, tipo_movimiento, monto, fecha, tipo_registro, estado, descripcion)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        usuario_id, categoria_id, concepto, tipo_movimiento, monto, fecha,
        tipo_registro || 'generico', estado || 'pendiente', descripcion || null
      ]
    );

    const [rows] = await pool.query(
      `SELECT m.*, c.nombre AS categoria_nombre, c.tipo AS categoria_tipo,
        (SELECT COUNT(*) FROM movimiento_detalles d WHERE d.movimiento_id = m.id) AS detalles_count
       FROM movimientos m JOIN categorias c ON c.id = m.categoria_id WHERE m.id = ? AND m.usuario_id = ?`,
      [result.insertId, usuario_id]
    );

    const nuevoMovimiento = rows[0];
    getIO(req).to(`usuario_${usuario_id}`).emit('movimiento:creado', nuevoMovimiento);

    return res.status(201).json({ ok: true, data: nuevoMovimiento });
  } catch (error) {
    console.error('Error al crear movimiento:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor' });
  }
}

// PUT /api/movimientos/:id
async function actualizar(req, res) {
  try {
    const { id } = req.params;
    const usuario_id = req.usuario.id;
    const {
      categoria_id, concepto, tipo_movimiento, monto,
      fecha, tipo_registro, estado, descripcion
    } = req.body;

    const [existe] = await pool.query(
      'SELECT * FROM movimientos WHERE id = ? AND usuario_id = ?',
      [id, usuario_id]
    );
    if (existe.length === 0) {
      return res.status(404).json({ ok: false, mensaje: 'Movimiento no encontrado' });
    }

    const actual = existe[0];

    // Si el movimiento tiene detalles, el monto y el estado se calculan
    // automáticamente y no se pueden editar manualmente desde aquí.
    const montoFinal = actual.tiene_detalle ? actual.monto : monto;
    const estadoFinal = actual.tiene_detalle ? actual.estado : estado;

    await pool.query(
      `UPDATE movimientos SET
        categoria_id = ?, concepto = ?, tipo_movimiento = ?, monto = ?,
        fecha = ?, tipo_registro = ?, estado = ?, descripcion = ?
       WHERE id = ? AND usuario_id = ?`,
      [categoria_id, concepto, tipo_movimiento, montoFinal, fecha, tipo_registro, estadoFinal, descripcion || null, id, usuario_id]
    );

    const [rows] = await pool.query(
      `SELECT m.*, c.nombre AS categoria_nombre, c.tipo AS categoria_tipo,
        (SELECT COUNT(*) FROM movimiento_detalles d WHERE d.movimiento_id = m.id) AS detalles_count
       FROM movimientos m JOIN categorias c ON c.id = m.categoria_id WHERE m.id = ? AND m.usuario_id = ?`,
      [id, usuario_id]
    );

    const actualizado = rows[0];
    getIO(req).to(`usuario_${usuario_id}`).emit('movimiento:actualizado', actualizado);

    return res.json({ ok: true, data: actualizado });
  } catch (error) {
    console.error('Error al actualizar movimiento:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor' });
  }
}

// PATCH /api/movimientos/:id/estado  { estado: 'pagado' | 'pendiente' }
async function cambiarEstado(req, res) {
  try {
    const { id } = req.params;
    const { estado } = req.body;
    const usuario_id = req.usuario.id;

    if (!['pendiente', 'pagado'].includes(estado)) {
      return res.status(400).json({ ok: false, mensaje: 'Estado inválido' });
    }

    const [existe] = await pool.query(
      'SELECT id, tiene_detalle FROM movimientos WHERE id = ? AND usuario_id = ?',
      [id, usuario_id]
    );
    if (existe.length === 0) {
      return res.status(404).json({ ok: false, mensaje: 'Movimiento no encontrado' });
    }

    if (existe[0].tiene_detalle) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Este movimiento tiene detalles; marca cada detalle como pagado desde el desglose.'
      });
    }

    await pool.query(
      'UPDATE movimientos SET estado = ? WHERE id = ? AND usuario_id = ?',
      [estado, id, usuario_id]
    );

    const [rows] = await pool.query(
      `SELECT m.*, c.nombre AS categoria_nombre, c.tipo AS categoria_tipo,
        (SELECT COUNT(*) FROM movimiento_detalles d WHERE d.movimiento_id = m.id) AS detalles_count
       FROM movimientos m JOIN categorias c ON c.id = m.categoria_id WHERE m.id = ? AND m.usuario_id = ?`,
      [id, usuario_id]
    );

    const actualizado = rows[0];
    getIO(req).to(`usuario_${usuario_id}`).emit('movimiento:estado-cambiado', actualizado);

    return res.json({ ok: true, data: actualizado });
  } catch (error) {
    console.error('Error al cambiar estado:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor' });
  }
}

// PATCH /api/movimientos/:id/mover-a/:destinoId
// Convierte un movimiento completo en detalle de otro movimiento (drag & drop).
// - Si el movimiento origen ya tenía sus propios detalles, esos detalles se
//   re-asignan (re-parentan) al movimiento destino.
// - Si no tenía detalles, se crea un único detalle en el destino a partir de
//   los datos del movimiento origen (concepto, monto, fecha, estado).
// En ambos casos, el movimiento origen se elimina al final.
async function moverComoDetalle(req, res) {
  try {
    const { id, destinoId } = req.params;
    const usuario_id = req.usuario.id;

    if (String(id) === String(destinoId)) {
      return res.status(400).json({ ok: false, mensaje: 'El movimiento de origen y destino no pueden ser el mismo' });
    }

    const [origenRows] = await pool.query(
      'SELECT * FROM movimientos WHERE id = ? AND usuario_id = ?',
      [id, usuario_id]
    );
    const [destinoRows] = await pool.query(
      'SELECT id FROM movimientos WHERE id = ? AND usuario_id = ?',
      [destinoId, usuario_id]
    );

    if (origenRows.length === 0 || destinoRows.length === 0) {
      return res.status(404).json({ ok: false, mensaje: 'Movimiento no encontrado' });
    }

    const movOrigen = origenRows[0];

    const [detallesOrigen] = await pool.query(
      'SELECT id FROM movimiento_detalles WHERE movimiento_id = ?',
      [id]
    );

    if (detallesOrigen.length > 0) {
      // Re-parenta todos los detalles existentes hacia el destino
      await pool.query(
        'UPDATE movimiento_detalles SET movimiento_id = ? WHERE movimiento_id = ?',
        [destinoId, id]
      );
    } else {
      // El movimiento origen no tenía detalles: se convierte él mismo en uno
      await pool.query(
        `INSERT INTO movimiento_detalles (movimiento_id, concepto, monto, fecha, hora, estado)
         VALUES (?, ?, ?, ?, NULL, ?)`,
        [destinoId, movOrigen.concepto, movOrigen.monto, movOrigen.fecha, movOrigen.estado]
      );
    }

    // El movimiento origen queda vacío (o ya convertido): se elimina
    await pool.query('DELETE FROM movimientos WHERE id = ? AND usuario_id = ?', [id, usuario_id]);

    const movimientoDestino = await recalcularMovimiento(destinoId, usuario_id, getIO(req));
    getIO(req).to(`usuario_${usuario_id}`).emit('movimiento:eliminado', { id: Number(id) });

    return res.json({
      ok: true,
      mensaje: 'Movimiento movido como detalle correctamente',
      movimiento: movimientoDestino
    });
  } catch (error) {
    console.error('Error al mover movimiento como detalle:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor' });
  }
}

// DELETE /api/movimientos/:id
// Nota: ON DELETE CASCADE en movimiento_detalles elimina sus detalles automáticamente.
async function eliminar(req, res) {
  try {
    const { id } = req.params;
    const usuario_id = req.usuario.id;

    const [existe] = await pool.query(
      'SELECT id FROM movimientos WHERE id = ? AND usuario_id = ?',
      [id, usuario_id]
    );
    if (existe.length === 0) {
      return res.status(404).json({ ok: false, mensaje: 'Movimiento no encontrado' });
    }

    await pool.query('DELETE FROM movimientos WHERE id = ? AND usuario_id = ?', [id, usuario_id]);

    getIO(req).to(`usuario_${usuario_id}`).emit('movimiento:eliminado', { id: Number(id) });

    return res.json({ ok: true, mensaje: 'Movimiento eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar movimiento:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor' });
  }
}

// GET /api/movimientos/resumen/dashboard?anio=2026&mes=6
async function resumenDashboard(req, res) {
  try {
    const anio = req.query.anio || new Date().getFullYear();
    const mes = req.query.mes || (new Date().getMonth() + 1);
    const usuario_id = req.usuario.id;

    const [rows] = await pool.query(
      `SELECT m.id, m.tiene_detalle, m.tipo_movimiento, m.tipo_registro, m.estado, m.monto, c.tipo AS categoria_tipo
       FROM movimientos m
       JOIN categorias c ON c.id = m.categoria_id
       WHERE m.usuario_id = ? AND m.anio = ? AND m.mes = ?`,
      [usuario_id, anio, mes]
    );

    // Monto ya pagado a nivel de DETALLE, para los movimientos que tienen
    // desglose. Esto permite que el % de cumplimiento cuente pagos
    // parciales (ej. 2 de 3 detalles pagados) en vez de exigir que el
    // movimiento completo esté 100% pagado.
    const [detalleRows] = await pool.query(
      `SELECT d.movimiento_id, SUM(CASE WHEN d.estado = 'pagado' THEN d.monto ELSE 0 END) AS pagado
       FROM movimiento_detalles d
       JOIN movimientos m ON m.id = d.movimiento_id
       WHERE m.usuario_id = ? AND m.anio = ? AND m.mes = ?
       GROUP BY d.movimiento_id`,
      [usuario_id, anio, mes]
    );
    const pagadoDetalleMap = {};
    detalleRows.forEach(d => { pagadoDetalleMap[d.movimiento_id] = parseFloat(d.pagado); });

    let totalIngresos = 0, totalGastos = 0;
    let totalPendiente = 0, totalPagado = 0;
    let totalPlan = 0, totalGenerico = 0;
    let registrosTotales = rows.length;
    let registrosPagados = 0;
    let montoTotalPeriodo = 0;
    let montoCumplidoPeriodo = 0;
    const totalesPorTipo = { Ingreso: 0, Gasto: 0, Deuda: 0, Inversion: 0 };

    // Pendiente y pagado desglosados por tipo de categoría
    const pendientePorTipo = { Ingreso: 0, Gasto: 0, Deuda: 0, Inversion: 0 };
    const pagadoPorTipo   = { Ingreso: 0, Gasto: 0, Deuda: 0, Inversion: 0 };

    for (const r of rows) {
      const monto = parseFloat(r.monto);
      montoTotalPeriodo += monto;

      if (r.tipo_movimiento === 'ingreso') totalIngresos += monto;
      if (r.tipo_movimiento === 'gasto') totalGastos += monto;

      // Monto realmente "cumplido" (pagado) para este movimiento:
      // - Si tiene detalle: lo pagado según sus detalles (puede ser parcial).
      // - Si no tiene detalle: el monto completo, solo si está marcado pagado.
      const pagadoReal = r.tiene_detalle
        ? (pagadoDetalleMap[r.id] || 0)
        : (r.estado === 'pagado' ? monto : 0);
      montoCumplidoPeriodo += pagadoReal;

      if (r.estado === 'pendiente') {
        totalPendiente += monto;
        if (pendientePorTipo[r.categoria_tipo] !== undefined) pendientePorTipo[r.categoria_tipo] += monto;
      }
      if (r.estado === 'pagado') {
        totalPagado += monto;
        registrosPagados += 1;
        if (pagadoPorTipo[r.categoria_tipo] !== undefined) pagadoPorTipo[r.categoria_tipo] += monto;
      }

      if (r.tipo_registro === 'plan') totalPlan += monto;
      if (r.tipo_registro === 'generico') totalGenerico += monto;

      if (totalesPorTipo[r.categoria_tipo] !== undefined) {
        totalesPorTipo[r.categoria_tipo] += monto;
      }
    }

    const porcentajeCumplimiento = montoTotalPeriodo > 0
      ? Number(((montoCumplidoPeriodo / montoTotalPeriodo) * 100).toFixed(2))
      : 0;

    // Efectivo acumulado: flujo neto hasta el periodo seleccionado
    const [acumRows] = await pool.query(
      `SELECT m.tipo_movimiento, m.monto, c.tipo AS categoria_tipo
       FROM movimientos m
       JOIN categorias c ON c.id = m.categoria_id
       WHERE m.usuario_id = ? AND ((m.anio < ?) OR (m.anio = ? AND m.mes <= ?))`,
      [usuario_id, anio, anio, mes]
    );

    let efectivoAcumulado = 0;
    const acumPorTipo = { Gasto: 0, Deuda: 0, Inversion: 0 };

    for (const r of acumRows) {
      const monto = parseFloat(r.monto);
      efectivoAcumulado += r.tipo_movimiento === 'ingreso' ? monto : -monto;
      if (acumPorTipo[r.categoria_tipo] !== undefined) {
        acumPorTipo[r.categoria_tipo] += monto;
      }
    }

    return res.json({
      ok: true,
      data: {
        anio: Number(anio),
        mes: Number(mes),
        totalIngresos: Number(totalIngresos.toFixed(2)),
        totalGastos: Number(totalGastos.toFixed(2)),
        balance: Number((totalIngresos - totalGastos).toFixed(2)),
        totalPendiente: Number(totalPendiente.toFixed(2)),
        totalPagado: Number(totalPagado.toFixed(2)),
        totalPlan: Number(totalPlan.toFixed(2)),
        totalGenerico: Number(totalGenerico.toFixed(2)),
        registrosTotales,
        registrosPagados,
        porcentajeCumplimiento,
        totalesPorTipo: {
          Ingreso:   Number(totalesPorTipo.Ingreso.toFixed(2)),
          Gasto:     Number(totalesPorTipo.Gasto.toFixed(2)),
          Deuda:     Number(totalesPorTipo.Deuda.toFixed(2)),
          Inversion: Number(totalesPorTipo.Inversion.toFixed(2))
        },
        pendientePorTipo: {
          Ingreso:   Number(pendientePorTipo.Ingreso.toFixed(2)),
          Gasto:     Number(pendientePorTipo.Gasto.toFixed(2)),
          Deuda:     Number(pendientePorTipo.Deuda.toFixed(2)),
          Inversion: Number(pendientePorTipo.Inversion.toFixed(2))
        },
        pagadoPorTipo: {
          Ingreso:   Number(pagadoPorTipo.Ingreso.toFixed(2)),
          Gasto:     Number(pagadoPorTipo.Gasto.toFixed(2)),
          Deuda:     Number(pagadoPorTipo.Deuda.toFixed(2)),
          Inversion: Number(pagadoPorTipo.Inversion.toFixed(2))
        },
        efectivoAcumulado: Number(efectivoAcumulado.toFixed(2)),
        acumuladoPorTipo: {
          Gasto:     Number(acumPorTipo.Gasto.toFixed(2)),
          Deuda:     Number(acumPorTipo.Deuda.toFixed(2)),
          Inversion: Number(acumPorTipo.Inversion.toFixed(2))
        }
      }
    });
  } catch (error) {
    console.error('Error al generar resumen:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor' });
  }
}

module.exports = {
  listar, obtener, crear, actualizar, cambiarEstado, moverComoDetalle, eliminar, resumenDashboard
};