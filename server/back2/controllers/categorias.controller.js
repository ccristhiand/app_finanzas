const pool = require('../config/db');

async function listar(req, res) {
  try {
    const [rows] = await pool.query('SELECT * FROM categorias ORDER BY tipo, nombre');
    return res.json({ ok: true, data: rows });
  } catch (error) {
    console.error('Error al listar categorías:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor' });
  }
}

module.exports = { listar };
