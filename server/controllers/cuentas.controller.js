// server/controllers/cuentas.controller.js
const pool = require('../config/db');

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
// Saldo calculado al vuelo: saldo_inicial + movimientos PAGADOS de esa
// cuenta hasta el periodo indicado (o hasta hoy si no se especifica).
async function listarConSaldo(req, res) {
  try {
    const usuario_id = req.usuario.id;
    const anio = req.query.anio || new Date().getFullYear();
    const mes = req.query.mes || (new Date().getMonth() + 1);

    const [rows] = await pool.query(
      `SELECT
        c.id, c.nombre, c.tipo, c.color, c.saldo_inicial, c.activa,
        c.saldo_inicial + COALESCE(SUM(
          CASE
            WHEN m.tipo_movimiento = 'ingreso' AND m.cuenta_id = c.id AND m.estado = 'pagado' THEN m.monto
            WHEN m.tipo_movimiento = 'gasto' AND m.cuenta_id = c.id AND m.estado = 'pagado' THEN -m.monto
            WHEN m.tipo_movimiento = 'transferencia' AND m.cuenta_destino_id = c.id AND m.estado = 'pagado' THEN m.monto
            WHEN m.tipo_movimiento = 'transferencia' AND m.cuenta_origen_id = c.id AND m.estado = 'pagado' THEN -m.monto
            ELSE 0
          END
        ), 0) AS saldo_actual
      FROM cuentas c
      LEFT JOIN movimientos m
        ON m.usuario_id = c.usuario_id
        AND (m.cuenta_id = c.id OR m.cuenta_origen_id = c.id OR m.cuenta_destino_id = c.id)
        AND ((m.anio < ?) OR (m.anio = ? AND m.mes <= ?))
      WHERE c.usuario_id = ? AND c.activa = 1
      GROUP BY c.id
      ORDER BY c.nombre`,
      [anio, anio, mes, usuario_id]
    );

    const data = rows.map(r => ({
      ...r,
      saldo_inicial: Number(r.saldo_inicial),
      saldo_actual: Number(r.saldo_actual)
    }));

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
    const { nombre, tipo, saldo_inicial, color } = req.body;

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ ok: false, mensaje: 'El nombre de la cuenta es obligatorio' });
    }

    const [result] = await pool.query(
      `INSERT INTO cuentas (usuario_id, nombre, tipo, saldo_inicial, color)
       VALUES (?, ?, ?, ?, ?)`,
      [usuario_id, nombre.trim(), tipo || 'otro', saldo_inicial || 0, color || '#0F766E']
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
    const { nombre, tipo, saldo_inicial, color } = req.body;

    const [existe] = await pool.query('SELECT id FROM cuentas WHERE id = ? AND usuario_id = ?', [id, usuario_id]);
    if (existe.length === 0) {
      return res.status(404).json({ ok: false, mensaje: 'Cuenta no encontrada' });
    }

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ ok: false, mensaje: 'El nombre de la cuenta es obligatorio' });
    }

    await pool.query(
      'UPDATE cuentas SET nombre = ?, tipo = ?, saldo_inicial = ?, color = ? WHERE id = ? AND usuario_id = ?',
      [nombre.trim(), tipo || 'otro', saldo_inicial || 0, color || '#0F766E', id, usuario_id]
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

// PATCH /api/cuentas/:id/activa  { activa: true|false }
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

// DELETE /api/cuentas/:id  (solo si no tiene movimientos asociados)
async function eliminar(req, res) {
  try {
    const { id } = req.params;
    const usuario_id = req.usuario.id;

    const [existe] = await pool.query('SELECT id FROM cuentas WHERE id = ? AND usuario_id = ?', [id, usuario_id]);
    if (existe.length === 0) {
      return res.status(404).json({ ok: false, mensaje: 'Cuenta no encontrada' });
    }

    const [enUso] = await pool.query(
      `SELECT id FROM movimientos
       WHERE usuario_id = ? AND (cuenta_id = ? OR cuenta_origen_id = ? OR cuenta_destino_id = ?)
       LIMIT 1`,
      [usuario_id, id, id, id]
    );

    if (enUso.length > 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'No se puede eliminar: esta cuenta tiene movimientos asociados. Desactívala en su lugar.'
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