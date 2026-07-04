// server/routes/detalles.routes.js
const express = require('express');
const router = express.Router();
const detallesController = require('../controllers/detalles.controller');
const { verificarToken } = require('../middleware/auth.middleware');

router.use(verificarToken);

router.get('/movimiento/:movimientoId', detallesController.listarPorMovimiento);
router.post('/movimiento/:movimientoId', detallesController.crear);
router.put('/:id', detallesController.actualizar);
router.patch('/:id/estado', detallesController.cambiarEstado);
router.patch('/:id/mover', detallesController.mover);
router.delete('/:id', detallesController.eliminar);

module.exports = router;