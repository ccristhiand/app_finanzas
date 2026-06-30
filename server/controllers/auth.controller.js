const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
require('dotenv').config();

async function login(req, res) {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ ok: false, mensaje: 'Usuario y contraseña son obligatorios' });
    }

    const [rows] = await pool.query(
      'SELECT id, username, password_hash, nombre, rol, activo FROM usuarios WHERE username = ? LIMIT 1',
      [username]
    );

    if (rows.length === 0) {
      return res.status(401).json({ ok: false, mensaje: 'Credenciales inválidas' });
    }

    const usuario = rows[0];

    if (!usuario.activo) {
      return res.status(403).json({ ok: false, mensaje: 'Usuario inactivo' });
    }

    const coincide = await bcrypt.compare(password, usuario.password_hash);

    if (!coincide) {
      return res.status(401).json({ ok: false, mensaje: 'Credenciales inválidas' });
    }

    const payload = { id: usuario.id, username: usuario.username, rol: usuario.rol };
    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '8h'
    });

    return res.json({
      ok: true,
      token,
      usuario: { id: usuario.id, username: usuario.username, nombre: usuario.nombre, rol: usuario.rol }
    });
  } catch (error) {
    console.error('Error en login:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor' });
  }
}

async function perfil(req, res) {
  return res.json({ ok: true, usuario: req.usuario });
}

module.exports = { login, perfil };
