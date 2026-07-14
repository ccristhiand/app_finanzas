// server/controllers/cuentas.controller.js
const pool = require('../config/db');

const TIPOS_VALIDOS = ['efectivo', 'ahorros', 'corriente', 'tarjeta_credito', 'billetera_digital', 'otro'];

function validarDiaMes(valor, nombreCampo) {
  if (valor === undefined || valor === null || valor === '') return null;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1 || n > 31) {
    throw new Error(`${nombreCampo} debe ser un número entre 1 y 31`);
  }
  return n;
}

function calcularProximaFechaPago(diaPago) {
  if (!diaPago) return null;
  const hoy = new Date();
  let anio = hoy.getFullYear();
  let mes = hoy.getMonth();
  const diaHoy = hoy.getDate();

  if (diaHoy > diaPago) {
    mes += 1;
    if (mes > 11) { mes = 0; anio += 1; }
  }

  const ultimoDiaDelMes = new Date(anio, mes + 1, 0).getDate();
  const dia = Math.min(diaPago, ultimoDiaDelMes);
  return new Date(anio, mes, dia).toISOString().slice(0, 10);
}

// GET /api/cuentas
async function listar(req, res) {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM cuentas WHERE usuario_id = ? ORDER BY activa DESC, nombre',
      [req.usuario.id]
    );
    return res.json({ ok: true, data: rows });
  } catch (error) {
    console.error('Error al listar cuentas:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor' });
  }
}

// GET /api/cuentas/saldos?anio=2026&mes=6
// El saldo de cada cuenta se calcula en 4 partes (todas al vuelo, nada guardado):
//
// 1. Movimientos SIN detalle donde cuenta_id = esta cuenta
//    (tipo ingreso/gasto registrado directamente en la cabecera)
// 2. Detalles de movimientos que tienen su propio cuenta_id = esta cuenta
//    (tipo ingreso/gasto a nivel de detalle individual)
// 3. Transferencias ENTRANTES a esta cuenta
// 4. Transferencias SALIENTES de esta cuenta
//
// Retrocompatible: los movimientos sin detalles siguen funcionando igual
// que antes (cuenta_id en la cabecera). Los nuevos movimientos con detalles
// donde cada detalle tiene su propia cuenta también se calculan correctamente.
async function listarConSaldo(req, res) {
  try {
    const usuario_id = req.usuario.id;
    const anio = req.query.anio || new Date().getFullYear();
    const mes = req.query.mes || (new Date().getMonth() + 1);

    const [rows] = await pool.query(
      `SELECT
        c.id, c.nombre, c.tipo, c.color, c.saldo_inicial, c.activa,
        c.limite_credito, c.dia_corte, c.dia_pago,
        c.saldo_inicial + (

          -- PARTE 1: movimientos sin detalle con cuenta directa en la cabecera
          COALESCE((
            SELECT SUM(
              CASE WHEN m.tipo_movimiento = 'ingreso' THEN m.monto ELSE -m.monto END
            )
            FROM movimientos m
            WHERE m.usuario_id = c.usuario_id
              AND m.cuenta_id = c.id
              AND m.tiene_detalle = 0
              AND m.tipo_movimiento IN ('ingreso','gasto')
              AND m.estado = 'pagado'
              AND ((m.anio < ?) OR (m.anio = ? AND m.mes <= ?))
          ), 0)

          +

          -- PARTE 2: detalles con cuenta propia asignada
          COALESCE((
            SELECT SUM(
              CASE WHEN d.tipo_movimiento = 'ingreso' THEN d.monto ELSE -d.monto END
            )
            FROM movimiento_detalles d
            JOIN movimientos m ON m.id = d.movimiento_id
            WHERE m.usuario_id = c.usuario_id
              AND d.cuenta_id = c.id
              AND d.estado = 'pagado'
              AND ((m.anio < ?) OR (m.anio = ? AND m.mes <= ?))
          ), 0)

          +

          -- PARTE 3: transferencias entrantes a esta cuenta
          COALESCE((
            SELECT SUM(m.monto)
            FROM movimientos m
            WHERE m.usuario_id = c.usuario_id
              AND m.tipo_movimiento = 'transferencia'
              AND m.cuenta_destino_id = c.id
              AND m.estado = 'pagado'
              AND ((m.anio < ?) OR (m.anio = ? AND m.mes <= ?))
          ), 0)

          -

          -- PARTE 4: transferencias salientes de esta cuenta
          COALESCE((
            SELECT SUM(m.monto)
            FROM movimientos m
            WHERE m.usuario_id = c.usuario_id
              AND m.tipo_movimiento = 'transferencia'
              AND m.cuenta_origen_id = c.id
              AND m.estado = 'pagado'
              AND ((m.anio < ?) OR (m.anio = ? AND m.mes <= ?))
          ), 0)

        ) AS saldo_actual

      FROM cuentas c
      WHERE c.usuario_id = ? AND c.activa = 1
      ORDER BY c.nombre`,
      [
        // parte 1
        anio, anio, mes,
        // parte 2
        anio, anio, mes,
        // parte 3
        anio, anio, mes,
        // parte 4
        anio, anio, mes,
        // WHERE outer
        usuario_id
      ]
    );

    const data = rows.map(r => {
      const saldoActual = Number(r.saldo_actual);
      const esTarjeta = r.tipo === 'tarjeta_credito';

      const base = {
        ...r,
        saldo_inicial: Number(r.saldo_inicial),
        saldo_actual: saldoActual,
        limite_credito: r.limite_credito !== null ? Number(r.limite_credito) : null
      };

      if (!esTarjeta) return base;

      const deudaActual = saldoActual < 0 ? Number((-saldoActual).toFixed(2)) : 0;
      const aFavor = saldoActual > 0 ? Number(saldoActual.toFixed(2)) : 0;
      const disponible = base.limite_credito !== null
        ? Number((base.limite_credito - deudaActual).toFixed(2))
        : null;
      const porcentajeUso = base.limite_credito
        ? Number(((deudaActual / base.limite_credito) * 100).toFixed(1))
        : null;

      return {
        ...base,
        deuda_actual: deudaActual,
        a_favor: aFavor,
        disponible,
        porcentaje_uso: porcentajeUso,
        proxima_fecha_pago: calcularProximaFechaPago(r.dia_pago)
      };
    });

    return res.json({ ok: true, data });
  } catch (error) {
    console.error('Error al calcular saldos de cuentas:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor' });
  }
}

// POST /api/cuentas
async function crear(req, res) {
  try {
    const usuario_id = req.usuario.id;
    const { nombre, tipo, saldo_inicial, color, limite_credito, dia_corte, dia_pago } = req.body;

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ ok: false, mensaje: 'El nombre de la cuenta es obligatorio' });
    }
    if (tipo && !TIPOS_VALIDOS.includes(tipo)) {
      return res.status(400).json({ ok: false, mensaje: 'Tipo de cuenta inválido' });
    }
    if (limite_credito !== undefined && limite_credito !== null && limite_credito !== '' && Number(limite_credito) < 0) {
      return res.status(400).json({ ok: false, mensaje: 'El límite de crédito no puede ser negativo' });
    }

    let diaCorteValido, diaPagoValido;
    try {
      diaCorteValido = validarDiaMes(dia_corte, 'El día de corte');
      diaPagoValido = validarDiaMes(dia_pago, 'El día de pago');
    } catch (errValidacion) {
      return res.status(400).json({ ok: false, mensaje: errValidacion.message });
    }

    const [result] = await pool.query(
      `INSERT INTO cuentas (usuario_id, nombre, tipo, saldo_inicial, color, limite_credito, dia_corte, dia_pago)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [usuario_id, nombre.trim(), tipo || 'otro', saldo_inicial || 0, color || '#0F766E',
       limite_credito || null, diaCorteValido, diaPagoValido]
    );

    const [rows] = await pool.query('SELECT * FROM cuentas WHERE id = ?', [result.insertId]);
    return res.status(201).json({ ok: true, data: rows[0] });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ ok: false, mensaje: 'Ya tienes una cuenta con ese nombre' });
    }
    console.error('Error al crear cuenta:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor' });
  }
}

// PUT /api/cuentas/:id
async function actualizar(req, res) {
  try {
    const { id } = req.params;
    const usuario_id = req.usuario.id;
    const { nombre, tipo, saldo_inicial, color, limite_credito, dia_corte, dia_pago } = req.body;

    const [existe] = await pool.query('SELECT id FROM cuentas WHERE id = ? AND usuario_id = ?', [id, usuario_id]);
    if (existe.length === 0) {
      return res.status(404).json({ ok: false, mensaje: 'Cuenta no encontrada' });
    }
    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ ok: false, mensaje: 'El nombre de la cuenta es obligatorio' });
    }

    let diaCorteValido, diaPagoValido;
    try {
      diaCorteValido = validarDiaMes(dia_corte, 'El día de corte');
      diaPagoValido = validarDiaMes(dia_pago, 'El día de pago');
    } catch (errValidacion) {
      return res.status(400).json({ ok: false, mensaje: errValidacion.message });
    }

    await pool.query(
      `UPDATE cuentas SET nombre = ?, tipo = ?, saldo_inicial = ?, color = ?,
        limite_credito = ?, dia_corte = ?, dia_pago = ?
       WHERE id = ? AND usuario_id = ?`,
      [nombre.trim(), tipo || 'otro', saldo_inicial || 0, color || '#0F766E',
       limite_credito || null, diaCorteValido, diaPagoValido, id, usuario_id]
    );

    const [rows] = await pool.query('SELECT * FROM cuentas WHERE id = ?', [id]);
    return res.json({ ok: true, data: rows[0] });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ ok: false, mensaje: 'Ya tienes una cuenta con ese nombre' });
    }
    console.error('Error al actualizar cuenta:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor' });
  }
}

// PATCH /api/cuentas/:id/activa
async function cambiarActiva(req, res) {
  try {
    const { id } = req.params;
    const usuario_id = req.usuario.id;
    const { activa } = req.body;

    const [existe] = await pool.query('SELECT id FROM cuentas WHERE id = ? AND usuario_id = ?', [id, usuario_id]);
    if (existe.length === 0) {
      return res.status(404).json({ ok: false, mensaje: 'Cuenta no encontrada' });
    }

    await pool.query('UPDATE cuentas SET activa = ? WHERE id = ? AND usuario_id = ?', [activa ? 1 : 0, id, usuario_id]);
    const [rows] = await pool.query('SELECT * FROM cuentas WHERE id = ?', [id]);
    return res.json({ ok: true, data: rows[0] });
  } catch (error) {
    console.error('Error al cambiar estado de cuenta:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor' });
  }
}

// DELETE /api/cuentas/:id
async function eliminar(req, res) {
  try {
    const { id } = req.params;
    const usuario_id = req.usuario.id;

    const [existe] = await pool.query('SELECT id FROM cuentas WHERE id = ? AND usuario_id = ?', [id, usuario_id]);
    if (existe.length === 0) {
      return res.status(404).json({ ok: false, mensaje: 'Cuenta no encontrada' });
    }

    // Verifica que no haya movimientos ni detalles usando esta cuenta
    const [enUsoMov] = await pool.query(
      `SELECT id FROM movimientos
       WHERE usuario_id = ? AND (cuenta_id = ? OR cuenta_origen_id = ? OR cuenta_destino_id = ?)
       LIMIT 1`,
      [usuario_id, id, id, id]
    );
    const [enUsoDet] = await pool.query(
      `SELECT d.id FROM movimiento_detalles d
       JOIN movimientos m ON m.id = d.movimiento_id
       WHERE m.usuario_id = ? AND d.cuenta_id = ?
       LIMIT 1`,
      [usuario_id, id]
    );

    if (enUsoMov.length > 0 || enUsoDet.length > 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'No se puede eliminar: esta cuenta tiene movimientos o detalles asociados. Desactívala en su lugar.'
      });
    }

    await pool.query('DELETE FROM cuentas WHERE id = ? AND usuario_id = ?', [id, usuario_id]);
    return res.json({ ok: true, mensaje: 'Cuenta eliminada correctamente' });
  } catch (error) {
    console.error('Error al eliminar cuenta:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor' });
  }
}

module.exports = { listar, listarConSaldo, crear, actualizar, cambiarActiva, eliminar };