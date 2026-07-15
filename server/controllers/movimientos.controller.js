const pool = require('../config/db');
const { recalcularMovimiento } = require('../services/movimientos.service');

function getIO(req) {
  return req.app.get('io');
}

const SELECT_MOVIMIENTO = `
  SELECT m.*,
    c.nombre AS categoria_nombre, c.tipo AS categoria_tipo, c.color AS categoria_color,
    cu.nombre AS cuenta_nombre, cu.color AS cuenta_color,
    cuo.nombre AS cuenta_origen_nombre, cuo.color AS cuenta_origen_color,
    cud.nombre AS cuenta_destino_nombre, cud.color AS cuenta_destino_color,
    (SELECT COUNT(*) FROM movimiento_detalles d WHERE d.movimiento_id = m.id) AS detalles_count
  FROM movimientos m
  LEFT JOIN categorias c ON c.id = m.categoria_id
  LEFT JOIN cuentas cu ON cu.id = m.cuenta_id
  LEFT JOIN cuentas cuo ON cuo.id = m.cuenta_origen_id
  LEFT JOIN cuentas cud ON cud.id = m.cuenta_destino_id
`;

async function cuentasSonDelUsuario(ids, usuario_id) {
  const idsFiltrados = ids.filter(Boolean);
  if (idsFiltrados.length === 0) return true;
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total FROM cuentas WHERE usuario_id = ? AND id IN (${idsFiltrados.map(() => '?').join(',')})`,
    [usuario_id, ...idsFiltrados]
  );
  return rows[0].total === idsFiltrados.length;
}

// Valida y normaliza los campos según el tipo de movimiento.
// Devuelve { error } si algo no cuadra, o los valores ya listos para
// insertar/actualizar si todo está bien.
async function validarYNormalizar(body, usuario_id) {
  const { categoria_id, tipo_movimiento, cuenta_id, cuenta_origen_id, cuenta_destino_id } = body;

  if (tipo_movimiento === 'transferencia') {
    if (!cuenta_origen_id || !cuenta_destino_id) {
      return { error: 'Selecciona cuenta de origen y cuenta de destino' };
    }
    if (String(cuenta_origen_id) === String(cuenta_destino_id)) {
      return { error: 'La cuenta de origen y destino no pueden ser la misma' };
    }
    const cuentasValidas = await cuentasSonDelUsuario([cuenta_origen_id, cuenta_destino_id], usuario_id);
    if (!cuentasValidas) return { error: 'Cuenta no encontrada' };

    return {
      categoria_id: null,
      cuenta_id: null,
      cuenta_origen_id,
      cuenta_destino_id
    };
  }

  // ingreso / gasto
  if (!categoria_id) {
    return { error: 'Selecciona una categoría' };
  }
  if (cuenta_id) {
    const cuentaValida = await cuentasSonDelUsuario([cuenta_id], usuario_id);
    if (!cuentaValida) return { error: 'Cuenta no encontrada' };
  }

  return {
    categoria_id,
    cuenta_id: cuenta_id || null,
    cuenta_origen_id: null,
    cuenta_destino_id: null
  };
}

// GET /api/movimientos?anio=2026&mes=6
async function listar(req, res) {
  try {
    const { anio, mes, tipo_registro, estado } = req.query;
    let sql = `${SELECT_MOVIMIENTO} WHERE m.usuario_id = ?`;
    const params = [req.usuario.id];

    if (anio) { sql += ' AND m.anio = ?'; params.push(anio); }
    if (mes) { sql += ' AND m.mes = ?'; params.push(mes); }
    if (tipo_registro) { sql += ' AND m.tipo_registro = ?'; params.push(tipo_registro); }
    if (estado) { sql += ' AND m.estado = ?'; params.push(estado); }

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
      `${SELECT_MOVIMIENTO} WHERE m.id = ? AND m.usuario_id = ?`,
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
    const { concepto, tipo_movimiento, monto, fecha, tipo_registro, estado, descripcion } = req.body;
    const usuario_id = req.usuario.id;

    if (!concepto || !tipo_movimiento || !monto || !fecha) {
      return res.status(400).json({ ok: false, mensaje: 'Faltan campos obligatorios' });
    }

    const normalizado = await validarYNormalizar(req.body, usuario_id);
    if (normalizado.error) {
      return res.status(400).json({ ok: false, mensaje: normalizado.error });
    }

    const [result] = await pool.query(
      `INSERT INTO movimientos
        (usuario_id, categoria_id, concepto, tipo_movimiento, monto, fecha, tipo_registro, estado, descripcion,
         cuenta_id, cuenta_origen_id, cuenta_destino_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        usuario_id, normalizado.categoria_id, concepto, tipo_movimiento, monto, fecha,
        tipo_registro || 'generico', estado || 'pendiente', descripcion || null,
        normalizado.cuenta_id, normalizado.cuenta_origen_id, normalizado.cuenta_destino_id
      ]
    );

    const [rows] = await pool.query(`${SELECT_MOVIMIENTO} WHERE m.id = ? AND m.usuario_id = ?`, [result.insertId, usuario_id]);
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
    const { concepto, tipo_movimiento, monto, fecha, tipo_registro, estado, descripcion } = req.body;

    const [existe] = await pool.query('SELECT * FROM movimientos WHERE id = ? AND usuario_id = ?', [id, usuario_id]);
    if (existe.length === 0) {
      return res.status(404).json({ ok: false, mensaje: 'Movimiento no encontrado' });
    }
    const actual = existe[0];

    const normalizado = await validarYNormalizar(req.body, usuario_id);
    if (normalizado.error) {
      return res.status(400).json({ ok: false, mensaje: normalizado.error });
    }

    // Si el movimiento tiene detalles, el monto y el estado se calculan
    // automáticamente y no se pueden editar manualmente desde aquí.
    const montoFinal = actual.tiene_detalle ? actual.monto : monto;
    const estadoFinal = actual.tiene_detalle ? actual.estado : estado;

    await pool.query(
      `UPDATE movimientos SET
        categoria_id = ?, concepto = ?, tipo_movimiento = ?, monto = ?,
        fecha = ?, tipo_registro = ?, estado = ?, descripcion = ?,
        cuenta_id = ?, cuenta_origen_id = ?, cuenta_destino_id = ?
       WHERE id = ? AND usuario_id = ?`,
      [
        normalizado.categoria_id, concepto, tipo_movimiento, montoFinal, fecha, tipo_registro, estadoFinal,
        descripcion || null, normalizado.cuenta_id, normalizado.cuenta_origen_id, normalizado.cuenta_destino_id,
        id, usuario_id
      ]
    );

    const [rows] = await pool.query(`${SELECT_MOVIMIENTO} WHERE m.id = ? AND m.usuario_id = ?`, [id, usuario_id]);
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

    await pool.query('UPDATE movimientos SET estado = ? WHERE id = ? AND usuario_id = ?', [estado, id, usuario_id]);

    const [rows] = await pool.query(`${SELECT_MOVIMIENTO} WHERE m.id = ? AND m.usuario_id = ?`, [id, usuario_id]);
    const actualizado = rows[0];
    getIO(req).to(`usuario_${usuario_id}`).emit('movimiento:estado-cambiado', actualizado);

    return res.json({ ok: true, data: actualizado });
  } catch (error) {
    console.error('Error al cambiar estado:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor' });
  }
}

// PATCH /api/movimientos/:id/mover-a/:destinoId
// Convierte un movimiento completo en detalle de otro (drag & drop).
// Las transferencias no se pueden convertir en detalle: un detalle
// pertenece al desglose de un ingreso/gasto, no tiene sentido para
// un movimiento entre cuentas.
async function moverComoDetalle(req, res) {
  try {
    const { id, destinoId } = req.params;
    const usuario_id = req.usuario.id;

    if (String(id) === String(destinoId)) {
      return res.status(400).json({ ok: false, mensaje: 'El movimiento de origen y destino no pueden ser el mismo' });
    }

    const [origenRows] = await pool.query('SELECT * FROM movimientos WHERE id = ? AND usuario_id = ?', [id, usuario_id]);
    const [destinoRows] = await pool.query('SELECT id, tipo_movimiento FROM movimientos WHERE id = ? AND usuario_id = ?', [destinoId, usuario_id]);

    if (origenRows.length === 0 || destinoRows.length === 0) {
      return res.status(404).json({ ok: false, mensaje: 'Movimiento no encontrado' });
    }

    const movOrigen = origenRows[0];

    if (movOrigen.tipo_movimiento === 'transferencia' || destinoRows[0].tipo_movimiento === 'transferencia') {
      return res.status(400).json({ ok: false, mensaje: 'Las transferencias no se pueden convertir en detalle' });
    }

    const [detallesOrigen] = await pool.query('SELECT id FROM movimiento_detalles WHERE movimiento_id = ?', [id]);

    if (detallesOrigen.length > 0) {
      await pool.query('UPDATE movimiento_detalles SET movimiento_id = ? WHERE movimiento_id = ?', [destinoId, id]);
    } else {
      await pool.query(
        `INSERT INTO movimiento_detalles (movimiento_id, concepto, monto, fecha, hora, estado)
         VALUES (?, ?, ?, ?, NULL, ?)`,
        [destinoId, movOrigen.concepto, movOrigen.monto, movOrigen.fecha, movOrigen.estado]
      );
    }

    await pool.query('DELETE FROM movimientos WHERE id = ? AND usuario_id = ?', [id, usuario_id]);

    const movimientoDestino = await recalcularMovimiento(destinoId, usuario_id, getIO(req));
    getIO(req).to(`usuario_${usuario_id}`).emit('movimiento:eliminado', { id: Number(id) });

    return res.json({ ok: true, mensaje: 'Movimiento movido como detalle correctamente', movimiento: movimientoDestino });
  } catch (error) {
    console.error('Error al mover movimiento como detalle:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor' });
  }
}

// DELETE /api/movimientos/:id
async function eliminar(req, res) {
  try {
    const { id } = req.params;
    const usuario_id = req.usuario.id;

    const [existe] = await pool.query('SELECT id FROM movimientos WHERE id = ? AND usuario_id = ?', [id, usuario_id]);
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
       LEFT JOIN categorias c ON c.id = m.categoria_id
       WHERE m.usuario_id = ? AND m.anio = ? AND m.mes = ?`,
      [usuario_id, anio, mes]
    );

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
    const pendientePorTipo = { Ingreso: 0, Gasto: 0, Deuda: 0, Inversion: 0 };
    const pagadoPorTipo   = { Ingreso: 0, Gasto: 0, Deuda: 0, Inversion: 0 };

    for (const r of rows) {
      const monto = parseFloat(r.monto);
      const esTransferencia = r.tipo_movimiento === 'transferencia';

      if (r.tipo_movimiento === 'ingreso') totalIngresos += monto;
      if (r.tipo_movimiento === 'gasto') totalGastos += monto;

      // Las transferencias son neutras: no suman ni restan al total del
      // periodo ni al % de cumplimiento (no representan gasto/ingreso real).
      if (!esTransferencia) {
        montoTotalPeriodo += monto;
        const pagadoReal = r.tiene_detalle
          ? (pagadoDetalleMap[r.id] || 0)
          : (r.estado === 'pagado' ? monto : 0);
        montoCumplidoPeriodo += pagadoReal;
      }

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

    // Efectivo acumulado con lógica de flujo real de caja:
    //   - Gasto con cuenta NO-TC     → resta inmediatamente (el cash sale al comprar)
    //   - Gasto con cuenta TC        → NO resta (el cash aún está en tu banco)
    //   - Transferencia banco → TC   → resta (es cuando el cash realmente sale)
    //   - Transferencia entre no-TC  → neutral (el dinero solo cambia de bolsillo)
    //   - Ingreso                    → suma siempre
    const [acumRows] = await pool.query(
      `SELECT m.tipo_movimiento, m.monto, c.tipo AS categoria_tipo,
              cu.tipo AS cuenta_tipo,
              co.tipo AS cuenta_origen_tipo,
              cd.tipo AS cuenta_destino_tipo
       FROM movimientos m
       LEFT JOIN categorias c   ON c.id  = m.categoria_id
       LEFT JOIN cuentas cu     ON cu.id = m.cuenta_id
       LEFT JOIN cuentas co     ON co.id = m.cuenta_origen_id
       LEFT JOIN cuentas cd     ON cd.id = m.cuenta_destino_id
       WHERE m.usuario_id = ? AND ((m.anio < ?) OR (m.anio = ? AND m.mes <= ?))`,
      [usuario_id, anio, anio, mes]
    );

    let efectivoAcumulado = 0;
    const acumPorTipo = { Gasto: 0, Deuda: 0, Inversion: 0 };

    for (const r of acumRows) {
      const monto = parseFloat(r.monto);

      if (r.tipo_movimiento === 'ingreso') {
        efectivoAcumulado += monto;
        // Los ingresos a TC (cashback, devoluciones) se ignoran en el
        // efectivo acumulado porque no llegaron a tu cuenta bancaria.
        if (r.cuenta_tipo !== 'tarjeta_credito') {
          if (acumPorTipo[r.categoria_tipo] !== undefined) {
            acumPorTipo[r.categoria_tipo] += monto;
          }
        }

      } else if (r.tipo_movimiento === 'gasto') {
        const esTc = r.cuenta_tipo === 'tarjeta_credito';
        if (!esTc) {
          // Gasto con efectivo/débito/ahorros: el cash sale en el acto
          efectivoAcumulado -= monto;
          if (acumPorTipo[r.categoria_tipo] !== undefined) {
            acumPorTipo[r.categoria_tipo] += monto;
          }
        }
        // Gasto con TC: no se contabiliza aquí; se contabilizará cuando
        // el usuario haga la transferencia de pago (ver bloque siguiente).

      } else if (r.tipo_movimiento === 'transferencia') {
        const origenEsTc  = r.cuenta_origen_tipo  === 'tarjeta_credito';
        const destinoEsTc = r.cuenta_destino_tipo === 'tarjeta_credito';

        if (destinoEsTc && !origenEsTc) {
          // Pago de TC desde cuenta bancaria: AQUÍ sale el cash de verdad.
          efectivoAcumulado -= monto;
        }
        // Transferencia TC→banco (devolución de saldo a favor): suma.
        if (origenEsTc && !destinoEsTc) {
          efectivoAcumulado += monto;
        }
        // Banco→banco: neutral (dinero que cambia de bolsillo, no sale).
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