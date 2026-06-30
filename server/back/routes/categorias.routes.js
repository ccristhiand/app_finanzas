const express = require('express');
const router = express.Router();
const categoriasController = require('../controllers/categorias.controller');
const { verificarToken } = require('../middleware/auth.middleware');

router.get('/', verificarToken, categoriasController.listar);

module.exports = router;
