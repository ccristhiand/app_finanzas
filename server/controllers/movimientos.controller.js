const pool = require('../config/db');

function getIO(req) {
  return req.app.get('io');
}

// GET /api/movimientos?anio=2026&mes=6
async function listar(req, res) {
  try {
    const { anio, mes, tipo_registro, estado } = req.query;
    let sql = `
      SELECT m.*, c.nombre AS categoria_nombre, c.tipo AS categoria_tipo, c.color AS categoria_color
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
      `SELECT m.*, c.nombre AS categoria_nombre, c.tipo AS categoria_tipo
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
      `SELECT m.*, c.nombre AS categoria_nombre, c.tipo AS categoria_tipo
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
      'SELECT id FROM movimientos WHERE id = ? AND usuario_id = ?',
      [id, usuario_id]
    );
    if (existe.length === 0) {
      return res.status(404).json({ ok: false, mensaje: 'Movimiento no encontrado' });
    }

    await pool.query(
      `UPDATE movimientos SET
        categoria_id = ?, concepto = ?, tipo_movimiento = ?, monto = ?,
        fecha = ?, tipo_registro = ?, estado = ?, descripcion = ?
       WHERE id = ? AND usuario_id = ?`,
      [categoria_id, concepto, tipo_movimiento, monto, fecha, tipo_registro, estado, descripcion || null, id, usuario_id]
    );

    const [rows] = await pool.query(
      `SELECT m.*, c.nombre AS categoria_nombre, c.tipo AS categoria_tipo
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
      'SELECT id FROM movimientos WHERE id = ? AND usuario_id = ?',
      [id, usuario_id]
    );
    if (existe.length === 0) {
      return res.status(404).json({ ok: false, mensaje: 'Movimiento no encontrado' });
    }

    await pool.query(
      'UPDATE movimientos SET estado = ? WHERE id = ? AND usuario_id = ?',
      [estado, id, usuario_id]
    );

    const [rows] = await pool.query(
      `SELECT m.*, c.nombre AS categoria_nombre, c.tipo AS categoria_tipo
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

// DELETE /api/movimientos/:id
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
      `SELECT m.tipo_movimiento, m.tipo_registro, m.estado, m.monto, c.tipo AS categoria_tipo
       FROM movimientos m
       JOIN categorias c ON c.id = m.categoria_id
       WHERE m.usuario_id = ? AND m.anio = ? AND m.mes = ?`,
      [usuario_id, anio, mes]
    );

    let totalIngresos = 0, totalGastos = 0;
    let totalPendiente = 0, totalPagado = 0;
    let totalPlan = 0, totalGenerico = 0;
    let registrosTotales = rows.length;
    let registrosPagados = 0;
    const totalesPorTipo = { Ingreso: 0, Gasto: 0, Deuda: 0, Inversion: 0 };

    for (const r of rows) {
      const monto = parseFloat(r.monto);
      if (r.tipo_movimiento === 'ingreso') totalIngresos += monto;
      if (r.tipo_movimiento === 'gasto') totalGastos += monto;

      if (r.estado === 'pendiente') totalPendiente += monto;
      if (r.estado === 'pagado') {
        totalPagado += monto;
        registrosPagados += 1;
      }

      if (r.tipo_registro === 'plan') totalPlan += monto;
      if (r.tipo_registro === 'generico') totalGenerico += monto;

      if (totalesPorTipo[r.categoria_tipo] !== undefined) {
        totalesPorTipo[r.categoria_tipo] += monto;
      }
    }

    const porcentajeCumplimiento = registrosTotales > 0
      ? Number(((registrosPagados / registrosTotales) * 100).toFixed(2))
      : 0;

    // Efectivo acumulado: flujo neto (ingresos - gastos) de todos los
    // movimientos hasta el periodo seleccionado, inclusive.
    const [acumRows] = await pool.query(
      `SELECT tipo_movimiento, monto FROM movimientos
       WHERE usuario_id = ? AND ((anio < ?) OR (anio = ? AND mes <= ?))`,
      [usuario_id, anio, anio, mes]
    );

    let efectivoAcumulado = 0;
    for (const r of acumRows) {
      const monto = parseFloat(r.monto);
      efectivoAcumulado += r.tipo_movimiento === 'ingreso' ? monto : -monto;
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
          Ingreso: Number(totalesPorTipo.Ingreso.toFixed(2)),
          Gasto: Number(totalesPorTipo.Gasto.toFixed(2)),
          Deuda: Number(totalesPorTipo.Deuda.toFixed(2)),
          Inversion: Number(totalesPorTipo.Inversion.toFixed(2))
        },
        efectivoAcumulado: Number(efectivoAcumulado.toFixed(2))
      }
    });
  } catch (error) {
    console.error('Error al generar resumen:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor' });
  }
}

module.exports = {
  listar, obtener, crear, actualizar, cambiarEstado, eliminar, resumenDashboard
};
