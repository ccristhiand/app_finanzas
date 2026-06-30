const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { verificarToken } = require('../middleware/auth.middleware');

router.post('/login', authController.login);
router.get('/perfil', verificarToken, authController.perfil);

module.exports = router;
