// server/routes/cuentas.routes.js
const express = require('express');
const router = express.Router();
const cuentasController = require('../controllers/cuentas.controller');
const { verificarToken } = require('../middleware/auth.middleware');

router.use(verificarToken);

router.get('/saldos', cuentasController.listarConSaldo);
router.get('/', cuentasController.listar);
router.post('/', cuentasController.crear);
router.put('/:id', cuentasController.actualizar);
router.patch('/:id/activa', cuentasController.cambiarActiva);
router.delete('/:id', cuentasController.eliminar);

module.exports = router;