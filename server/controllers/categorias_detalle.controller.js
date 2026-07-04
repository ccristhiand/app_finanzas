// server/controllers/categorias_detalle.controller.js
const pool = require('../config/db');

async function listar(req, res) {
  try {
    const [rows] = await pool.query('SELECT * FROM categorias_detalle ORDER BY nombre');
    return res.json({ ok: true, data: rows });
  } catch (error) {
    console.error('Error al listar categorías de detalle:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor' });
  }
}

// POST /api/categorias-detalle  { nombre, color }
// Permite ampliar el listado ("Movilidad, Gastos Hormiga, ... entre otros")
// sin tener que tocar la base de datos manualmente.
async function crear(req, res) {
  try {
    const { nombre, color } = req.body;
    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ ok: false, mensaje: 'El nombre es obligatorio' });
    }

    const [result] = await pool.query(
      'INSERT INTO categorias_detalle (nombre, color) VALUES (?, ?)',
      [nombre.trim(), color || '#0F766E']
    );

    const [rows] = await pool.query('SELECT * FROM categorias_detalle WHERE id = ?', [result.insertId]);
    return res.status(201).json({ ok: true, data: rows[0] });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ ok: false, mensaje: 'Ya existe una categoría de detalle con ese nombre' });
    }
    console.error('Error al crear categoría de detalle:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor' });
  }
}

module.exports = { listar, crear };