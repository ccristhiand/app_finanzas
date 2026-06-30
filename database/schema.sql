-- =========================================================
-- GESTOR FINANCIERO PERSONAL - ESQUEMA DE BASE DE DATOS (MySQL 8+)
-- =========================================================

CREATE DATABASE IF NOT EXISTS gestor_financiero
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE gestor_financiero;

-- ---------------------------------------------------------
-- TABLA: usuarios
-- ---------------------------------------------------------
CREATE TABLE usuarios (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  nombre        VARCHAR(100) DEFAULT NULL,
  rol           ENUM('admin','usuario') NOT NULL DEFAULT 'usuario',
  activo        TINYINT(1) NOT NULL DEFAULT 1,
  creado_en     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---------------------------------------------------------
-- TABLA: categorias
-- Tipifica de forma diferenciada: Ingreso, Gasto, Deuda, Inversion
-- ---------------------------------------------------------
CREATE TABLE categorias (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  nombre      VARCHAR(50) NOT NULL UNIQUE,
  tipo        ENUM('Ingreso','Gasto','Deuda','Inversion') NOT NULL,
  color       VARCHAR(7) DEFAULT '#4F46E5',
  icono       VARCHAR(50) DEFAULT 'tag'
) ENGINE=InnoDB;

-- ---------------------------------------------------------
-- TABLA PRINCIPAL: movimientos
-- Centraliza ingresos y gastos, planificados y genéricos
-- ---------------------------------------------------------
CREATE TABLE movimientos (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id      INT NOT NULL,
  categoria_id    INT NOT NULL,
  concepto        VARCHAR(150) NOT NULL,
  tipo_movimiento ENUM('ingreso','gasto') NOT NULL,
  monto           DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  fecha           DATE NOT NULL,
  anio            INT GENERATED ALWAYS AS (YEAR(fecha)) STORED,
  mes             INT GENERATED ALWAYS AS (MONTH(fecha)) STORED,
  tipo_registro   ENUM('plan','generico') NOT NULL DEFAULT 'generico',
  estado          ENUM('pendiente','pagado') NOT NULL DEFAULT 'pendiente',
  descripcion     VARCHAR(255) DEFAULT NULL,
  creado_en       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_mov_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_mov_categoria FOREIGN KEY (categoria_id) REFERENCES categorias(id),
  INDEX idx_anio_mes (anio, mes),
  INDEX idx_tipo_registro (tipo_registro),
  INDEX idx_estado (estado)
) ENGINE=InnoDB;

-- =========================================================
-- DATOS INICIALES: CATEGORIAS
-- =========================================================
INSERT INTO categorias (nombre, tipo, color, icono) VALUES
  ('Ingreso',   'Ingreso',   '#10B981', 'trending-up'),
  ('Gasto',     'Gasto',     '#EF4444', 'shopping-cart'),
  ('Deuda',     'Deuda',     '#F59E0B', 'credit-card'),
  ('Inversion', 'Inversion', '#3B82F6', 'piggy-bank');

-- =========================================================
-- USUARIO ADMINISTRADOR
-- username: cadc | password: Crisal123$
-- Hash bcrypt real (10 rounds), compatible con la librería "bcrypt" / "bcryptjs" de Node.js
-- =========================================================
INSERT INTO usuarios (username, password_hash, nombre, rol, activo) VALUES
  ('cadc', '$2b$10$H5S0.96yuAnXfyvp3DHec.LQkdnZPfyAaoGaPtUL/LoQDFjwX.Cqe', 'CRISTHIAN', 'admin', 1);--Crisal123$

INSERT INTO usuarios (username, password_hash, nombre, rol, activo) VALUES
  ('beva', '$2b$10$H5S0.96yuAnXfyvp3DHec.LQkdnZPfyAaoGaPtUL/LoQDFjwX.Cqe', 'BETZABHE', 'admin', 1);--Crisal123$

INSERT INTO usuarios (username, password_hash, nombre, rol, activo) VALUES
  ('hanna', '$2b$10$tVH2ZN5TbaJFuFckAJ5xA.AVFDmzGJJmvU69fMpWmzU0O255vixMG', 'LESLIE', 'usuario', 1);--100800
-- =========================================================
-- A continuación, ejecutar inserts_movimientos.sql para cargar
-- la migración completa del plan financiero (plan.xlsx)
-- =========================================================
