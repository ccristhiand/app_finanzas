# Gestor Financiero Personal

Sistema web completo (Backend + Frontend) para el control de ingresos y gastos personales, con migración de datos desde `plan.xlsx`, CRUD completo, checklist de cumplimiento y actualizaciones en tiempo real vía WebSockets.

## Estructura del proyecto

```
project/
├── database/
│   ├── schema.sql                 # CREATE TABLE + categorías + usuario admin (bcrypt)
│   └── inserts_movimientos.sql    # 249 INSERTs migrados desde plan.xlsx (tipo_registro='plan')
├── server/
│   ├── index.js                   # Punto de entrada Express + Socket.io
│   ├── config/db.js               # Pool de conexión MySQL
│   ├── middleware/auth.middleware.js
│   ├── controllers/
│   │   ├── auth.controller.js
│   │   ├── movimientos.controller.js
│   │   └── categorias.controller.js
│   └── routes/
│       ├── auth.routes.js
│       ├── movimientos.routes.js
│       └── categorias.routes.js
├── public/
│   ├── login.html
│   ├── dashboard.html
│   ├── index.html
│   ├── css/{styles.css, dashboard.css}
│   └── js/{api.js, dashboard.js}
├── package.json
└── .env.example
```

## 1. Base de datos

1. Crea la base ejecutando `database/schema.sql` (crea la BD, tablas `usuarios`, `categorias`, `movimientos`, las categorías base y el usuario admin).
2. Carga la migración del plan ejecutando `database/inserts_movimientos.sql`.

```bash
mysql -u root -p < database/schema.sql
mysql -u root -p gestor_financiero < database/inserts_movimientos.sql
```

**Usuario administrador:** `cadc` / `Crisal123$` (contraseña almacenada como hash bcrypt real, 10 rounds).

## 2. Backend

```bash
cp .env.example .env   # edita tus credenciales de MySQL y un JWT_SECRET propio
npm install
npm start               # o: npm run dev (con nodemon)
```

El servidor expone:
- `POST /api/auth/login` — autenticación (devuelve JWT)
- `GET /api/auth/perfil` — perfil del usuario autenticado
- `GET /api/movimientos?anio=&mes=&tipo_registro=&estado=` — listado con filtros
- `GET /api/movimientos/resumen/dashboard?anio=&mes=` — KPIs del dashboard
- `POST /api/movimientos` — crear
- `PUT /api/movimientos/:id` — actualizar
- `PATCH /api/movimientos/:id/estado` — cambiar estado (checklist)
- `DELETE /api/movimientos/:id` — eliminar
- `GET /api/categorias` — listado de categorías

Todos los cambios (crear, actualizar, cambiar estado, eliminar) emiten eventos de Socket.io (`movimiento:creado`, `movimiento:actualizado`, `movimiento:estado-cambiado`, `movimiento:eliminado`) que el frontend escucha para refrescar la información en tiempo real en todos los clientes conectados.

## 3. Frontend

El servidor Express sirve la carpeta `public/` como contenido estático, así que al iniciar el servidor basta con visitar:

```
http://localhost:3000/login.html
```

Inicia sesión con `cadc` / `Crisal123$` y serás redirigido al dashboard, que carga por defecto el año y mes actuales.

## Notas de mapeo del plan.xlsx

Cada fila (Año, Mes) del Excel se migró concepto por concepto a `movimientos`, con `tipo_registro = 'plan'` y `estado = 'pendiente'`:

| Categoría asignada | Conceptos |
|---|---|
| Ingreso | Sueldo, Grati, Cts, Bono |
| Gasto | IPHONE LESLIE, Impresora, Laptop, Zapatilla, Veterinaria Coco, Universidad, Gastos Hogar, Gasto Festivo, Matrícula, Servidor Elastika, Youtube, Viajes |
| Deuda | Deuda a Betza, Pago Visa Signature, Pago MasterCard Black, Pago Cel Interbank, Otros Interbank, Deudas |
| Inversion | Terreno, Reserva Emergencia, Reserva CTS, Inversiones |

Los valores nulos o en cero del Excel no generan movimiento (no aportan información). Las columnas calculadas del Excel (`Ingresos Totales`, `TOTALES`, `Efectivo Acumulado`) no se migran porque se recalculan dinámicamente en el dashboard.
