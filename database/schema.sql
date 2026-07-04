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
-- MIGRACIÓN: Detalle de movimientos
-- Ejecutar una sola vez sobre la base de datos existente
-- =========================================================

-- 1) Nueva columna en `movimientos`: indica si el movimiento
--    ahora se gestiona a través de sus detalles (monto y estado
--    calculados) o de forma manual (comportamiento actual).
ALTER TABLE movimientos
  ADD COLUMN tiene_detalle TINYINT(1) NOT NULL DEFAULT 0 AFTER estado;

-- 2) Tabla de detalles. Cada movimiento (ej. "Pasajes") puede tener
--    varios registros hijos (ej. "Moto", "Bus", "Bus Regreso"),
--    cada uno con su propia hora, monto y checkbox de pagado.
CREATE TABLE IF NOT EXISTS movimiento_detalles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  movimiento_id INT NOT NULL,
  concepto VARCHAR(150) NOT NULL,
  monto DECIMAL(10,2) NOT NULL,
  fecha DATE NOT NULL,
  hora TIME NULL,
  estado ENUM('pendiente','pagado') NOT NULL DEFAULT 'pendiente',
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_detalle_movimiento FOREIGN KEY (movimiento_id)
    REFERENCES movimientos(id) ON DELETE CASCADE,
  INDEX idx_detalle_movimiento (movimiento_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Nota: los movimientos ya existentes (inserts_movimientos.sql, etc.)
-- quedan con tiene_detalle = 0, así que se siguen editando manualmente
-- (monto/estado desde el modal) tal como hoy. En cuanto un movimiento
-- reciba su primer detalle, el backend lo marca tiene_detalle = 1 y a
-- partir de ahí el monto y el estado del encabezado se recalculan
-- automáticamente a partir de sus detalles.

-- =========================================================
-- MIGRACIÓN v2: Categorías de detalle + soporte para mover
-- movimientos/detalles entre sí (drag & drop)
-- =========================================================

-- 1) Tabla de categorías de DETALLE (independiente de `categorias`,
--    que sigue siendo Ingreso/Gasto/Deuda/Inversión a nivel de
--    movimiento). Esta nueva tabla sectoriza el gasto dentro del
--    desglose: Movilidad, Gastos Hormiga, Servicios, etc.
CREATE TABLE IF NOT EXISTS categorias_detalle (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL UNIQUE,
  color VARCHAR(20) NOT NULL DEFAULT '#0F766E',
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO categorias_detalle (nombre, color) VALUES
  ('Movilidad',       '#0F766E'),
  ('Gastos Hormiga',  '#B66B05'),
  ('Servicios',       '#3B4FCB'),
  ('Ingresos',        '#1F9D7C'),
  ('Ahorro',          '#4B4FCB'),
  ('Alimentación',    '#E0584A'),
  ('Salud',           '#0EA5A5'),
  ('Otros',           '#5C6F6B')
ON DUPLICATE KEY UPDATE nombre = nombre;

-- 2) Vínculo opcional desde cada detalle hacia su categoría de detalle.
--    Es NULL-able porque los detalles ya existentes no tienen categoría
--    asignada todavía (se pueden editar luego desde el front).
ALTER TABLE movimiento_detalles
  ADD COLUMN categoria_detalle_id INT NULL AFTER estado,
  ADD CONSTRAINT fk_detalle_categoria_detalle FOREIGN KEY (categoria_detalle_id)
    REFERENCES categorias_detalle(id) ON DELETE SET NULL;

-- Nota: no se requiere ninguna migración adicional para la función de
-- "arrastrar y soltar" (mover movimientos/detalles entre sí); esa
-- funcionalidad solo usa las tablas ya existentes (movimientos y
-- movimiento_detalles) a través de los nuevos endpoints del backend.







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
