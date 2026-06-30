const express = require('express');
const router = express.Router();
const movimientosController = require('../controllers/movimientos.controller');
const { verificarToken } = require('../middleware/auth.middleware');

router.use(verificarToken);

router.get('/resumen/dashboard', movimientosController.resumenDashboard);
router.get('/', movimientosController.listar);
router.get('/:id', movimientosController.obtener);
router.post('/', movimientosController.crear);
router.put('/:id', movimientosController.actualizar);
router.patch('/:id/estado', movimientosController.cambiarEstado);
router.delete('/:id', movimientosController.eliminar);

module.exports = router;
