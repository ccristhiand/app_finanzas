// server/routes/categorias_detalle.routes.js
const express = require('express');
const router = express.Router();
const categoriasDetalleController = require('../controllers/categorias_detalle.controller');
const { verificarToken } = require('../middleware/auth.middleware');

router.use(verificarToken);

router.get('/', categoriasDetalleController.listar);
router.post('/', categoriasDetalleController.crear);

module.exports = router;