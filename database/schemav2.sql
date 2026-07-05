-- =========================================================
-- GESTOR FINANCIERO PERSONAL - ESQUEMA DE BASE DE DATOS (MySQL 8+)
-- Versión consolidada: incluye detalle de movimientos y
-- categorías de detalle ya integradas (no requiere migraciones
-- adicionales en una base de datos nueva).
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
-- Tipifica el movimiento a nivel de cabecera: Ingreso, Gasto,
-- Deuda, Inversion
-- ---------------------------------------------------------
CREATE TABLE categorias (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  nombre      VARCHAR(50) NOT NULL UNIQUE,
  tipo        ENUM('Ingreso','Gasto','Deuda','Inversion') NOT NULL,
  color       VARCHAR(7) DEFAULT '#4F46E5',
  icono       VARCHAR(50) DEFAULT 'tag'
) ENGINE=InnoDB;

-- ---------------------------------------------------------
-- TABLA: categorias_detalle
-- Sectoriza el gasto dentro del DESGLOSE de un movimiento
-- (Movilidad, Gastos Hormiga, Servicios, Ingresos, Ahorro, etc.)
-- Se crea antes de movimiento_detalles porque esta última la
-- referencia por FK.
-- ---------------------------------------------------------
CREATE TABLE categorias_detalle (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  nombre     VARCHAR(100) NOT NULL UNIQUE,
  color      VARCHAR(20) NOT NULL DEFAULT '#0F766E',
  creado_en  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---------------------------------------------------------
-- TABLA PRINCIPAL: movimientos
-- Centraliza ingresos y gastos, planificados y genéricos.
-- tiene_detalle indica si el monto/estado de este movimiento
-- se calcula automáticamente a partir de movimiento_detalles.
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
  tiene_detalle   TINYINT(1) NOT NULL DEFAULT 0,
  descripcion     VARCHAR(255) DEFAULT NULL,
  creado_en       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_mov_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_mov_categoria FOREIGN KEY (categoria_id) REFERENCES categorias(id),
  INDEX idx_anio_mes (anio, mes),
  INDEX idx_tipo_registro (tipo_registro),
  INDEX idx_estado (estado)
) ENGINE=InnoDB;

-- ---------------------------------------------------------
-- TABLA: movimiento_detalles
-- Desglose de un movimiento (ej. "Pasajes" -> "Moto", "Bus",
-- "Bus Regreso"), cada uno con su propia hora, monto, checkbox
-- de pagado y categoría de detalle opcional.
-- ---------------------------------------------------------
CREATE TABLE movimiento_detalles (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  movimiento_id         INT NOT NULL,
  concepto              VARCHAR(150) NOT NULL,
  monto                 DECIMAL(10,2) NOT NULL,
  fecha                 DATE NOT NULL,
  hora                  TIME NULL,
  estado                ENUM('pendiente','pagado') NOT NULL DEFAULT 'pendiente',
  categoria_detalle_id  INT NULL,
  creado_en             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_detalle_movimiento FOREIGN KEY (movimiento_id)
    REFERENCES movimientos(id) ON DELETE CASCADE,
  CONSTRAINT fk_detalle_categoria_detalle FOREIGN KEY (categoria_detalle_id)
    REFERENCES categorias_detalle(id) ON DELETE SET NULL,
  INDEX idx_detalle_movimiento (movimiento_id)
) ENGINE=InnoDB;

-- =========================================================
-- DATOS INICIALES: CATEGORIAS (cabecera de movimiento)
-- =========================================================
INSERT INTO categorias (nombre, tipo, color, icono) VALUES
  ('Ingreso',   'Ingreso',   '#10B981', 'trending-up'),
  ('Gasto',     'Gasto',     '#EF4444', 'shopping-cart'),
  ('Deuda',     'Deuda',     '#F59E0B', 'credit-card'),
  ('Inversion', 'Inversion', '#3B82F6', 'piggy-bank');

-- =========================================================
-- DATOS INICIALES: CATEGORIAS_DETALLE (sectorización del desglose)
-- =========================================================
INSERT INTO categorias_detalle (nombre, color) VALUES
  ('Movilidad',       '#0F766E'),
  ('Gastos Hormiga',  '#B66B05'),
  ('Servicios',       '#3B4FCB'),
  ('Ingresos',        '#1F9D7C'),
  ('Ahorro',          '#4B4FCB'),
  ('Alimentación',    '#E0584A'),
  ('Salud',           '#0EA5A5'),
  ('Mascotas',       '#F277DA'),
  ('Otros',           '#5C6F6B');

-- =========================================================
-- USUARIOS
-- username: cadc  | password: Crisal123$
-- username: beva  | password: Crisal123$
-- username: hanna | password: 100800
-- Hash bcrypt real (10 rounds), compatible con "bcrypt"/"bcryptjs" de Node.js
-- =========================================================
INSERT INTO usuarios (username, password_hash, nombre, rol, activo) VALUES
  ('cadc',  '$2b$10$H5S0.96yuAnXfyvp3DHec.LQkdnZPfyAaoGaPtUL/LoQDFjwX.Cqe', 'CRISTHIAN', 'admin', 1);

INSERT INTO usuarios (username, password_hash, nombre, rol, activo) VALUES
  ('beva',  '$2b$10$H5S0.96yuAnXfyvp3DHec.LQkdnZPfyAaoGaPtUL/LoQDFjwX.Cqe', 'BETZABHE', 'admin', 1);

INSERT INTO usuarios (username, password_hash, nombre, rol, activo) VALUES
  ('hanna', '$2b$10$tVH2ZN5TbaJFuFckAJ5xA.AVFDmzGJJmvU69fMpWmzU0O255vixMG', 'LESLIE', 'usuario', 1);

-- =========================================================
-- A continuación, ejecutar inserts_movimientos.sql para cargar
-- la migración completa del plan financiero (plan.xlsx)
-- =========================================================