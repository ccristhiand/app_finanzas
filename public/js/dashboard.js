requireAuth();

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

const state = {
  anio: new Date().getFullYear(),
  mes: new Date().getMonth() + 1,
  movimientos: [],
  categorias: [],
  categoriasDetalle: [],
  filtroChecklist: 'todos',
  vista: 'dashboard',
  editandoId: null,
  idAEliminar: null,
  tipoAEliminar: 'movimiento', // 'movimiento' | 'detalle'
  ordenChecklist: { campo: 'fecha', direccion: 'desc' },
  // ── Detalle de movimientos ──
  detallesCache: {},      // movimientoId -> array de detalles
  detalleAbiertoId: null  // id (string) del movimiento cuyo desglose está expandido
};

// ---------------- Inicialización ----------------
function init() {
  pintarUsuario();
  poblarSelectoresPeriodo();
  cargarCategorias();
  cargarCategoriasDetalle();
  cargarMovimientos();
  bindNav();
  bindModal();
  bindModalDetalle();
  bindFiltros();
  bindOrdenChecklist();
  bindLogout();
  initSocket();
}

function pintarUsuario() {
  const usuario = JSON.parse(localStorage.getItem('usuario') || '{}');
  document.getElementById('userName').textContent = usuario.nombre || usuario.username || 'Usuario';
  document.getElementById('avatarLetter').textContent = (usuario.nombre || usuario.username || 'A').charAt(0).toUpperCase();
}

function poblarSelectoresPeriodo() {
  const selMes = document.getElementById('selectMes');
  const selAnio = document.getElementById('selectAnio');

  MESES.forEach((m, i) => {
    const opt = document.createElement('option');
    opt.value = i + 1;
    opt.textContent = m;
    if (i + 1 === state.mes) opt.selected = true;
    selMes.appendChild(opt);
  });

  const anioActual = new Date().getFullYear();
  for (let y = anioActual - 2; y <= anioActual + 2; y++) {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y;
    if (y === state.anio) opt.selected = true;
    selAnio.appendChild(opt);
  }

  selMes.addEventListener('change', () => {
    state.mes = Number(selMes.value);
    reiniciarEstadoDetalles();
    cargarMovimientos();
  });
  selAnio.addEventListener('change', () => {
    state.anio = Number(selAnio.value);
    reiniciarEstadoDetalles();
    cargarMovimientos();
  });
}

function reiniciarEstadoDetalles() {
  state.detalleAbiertoId = null;
  state.detallesCache = {};
}

// ---------------- Navegación ----------------
function bindNav() {
  document.querySelectorAll('.nav-item, .mnav-item:not(.mnav-fab)').forEach(btn => {
    btn.addEventListener('click', () => cambiarVista(btn.dataset.view));
  });

  document.getElementById('btnNuevoSidebar').addEventListener('click', () => abrirModal());
  document.getElementById('btnNuevoMobile').addEventListener('click', () => abrirModal());
}

function cambiarVista(vista) {
  state.vista = vista;
  document.querySelectorAll('.nav-item, .mnav-item:not(.mnav-fab)').forEach(b => {
    b.classList.toggle('active', b.dataset.view === vista);
  });
  document.getElementById('view-dashboard').style.display = vista === 'dashboard' ? '' : 'none';
  document.getElementById('view-checklist').style.display = vista === 'checklist' ? '' : 'none';

  document.getElementById('viewTitle').textContent = vista === 'dashboard' ? 'Dashboard' : 'Checklist de cumplimiento';
  document.getElementById('viewSubtitle').textContent = vista === 'dashboard'
    ? 'Resumen financiero del periodo seleccionado'
    : 'Marca tus movimientos como pagados en tiempo real';

  if (vista === 'checklist') renderChecklist();
}

function bindLogout() {
  document.getElementById('btnLogout').addEventListener('click', logout);
}

// ---------------- Carga de datos ----------------
async function cargarCategorias() {
  const res = await apiFetch('/categorias');
  if (res && res.ok) {
    state.categorias = res.data;
    const select = document.getElementById('fCategoria');
    select.innerHTML = state.categorias.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
  }
}

async function cargarCategoriasDetalle() {
  const res = await apiFetch('/categorias-detalle');
  if (res && res.ok) {
    state.categoriasDetalle = res.data;
    const select = document.getElementById('dCategoriaDetalle');
    select.innerHTML = `<option value="">Sin categoría</option>` +
      state.categoriasDetalle.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
  }
}

async function cargarMovimientos() {
  const [resMov, resResumen] = await Promise.all([
    apiFetch(`/movimientos?anio=${state.anio}&mes=${state.mes}`),
    apiFetch(`/movimientos/resumen/dashboard?anio=${state.anio}&mes=${state.mes}`)
  ]);

  if (resMov && resMov.ok) state.movimientos = resMov.data;
  if (resResumen && resResumen.ok) renderResumen(resResumen.data);

  renderRecientes();
  if (state.vista === 'checklist') renderChecklist();
}

async function cargarDetalles(movimientoId) {
  const res = await apiFetch(`/detalles/movimiento/${movimientoId}`);
  if (res && res.ok) {
    state.detallesCache[movimientoId] = res.data;
  }
}

// ---------------- Render: Dashboard KPIs ----------------
function formatoMoneda(valor) {
  return `S/ ${Number(valor || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function renderResumen(data) {
  document.getElementById('kpiIngresos').textContent = formatoMoneda(data.totalIngresos);
  document.getElementById('kpiGastos').textContent = formatoMoneda(data.totalGastos);
  document.getElementById('kpiBalance').textContent = formatoMoneda(data.balance);

  const tagBalance = document.getElementById('kpiBalanceTag');
  tagBalance.textContent = data.balance >= 0 ? 'Saldo positivo' : 'Saldo negativo';
  tagBalance.className = 'kpi-tag ' + (data.balance >= 0 ? 'success' : 'danger');

  document.getElementById('kpiCumplimiento').textContent = `${data.porcentajeCumplimiento}%`;
  document.getElementById('kpiCumplimientoBar').style.width = `${data.porcentajeCumplimiento}%`;

  document.getElementById('kpiAcumulado').textContent = formatoMoneda(data.efectivoAcumulado);
  const tagAcumulado = document.getElementById('kpiAcumuladoTag');
  tagAcumulado.textContent = data.efectivoAcumulado >= 0 ? 'Hasta el periodo seleccionado' : 'Déficit acumulado';
  tagAcumulado.className = 'kpi-tag ' + (data.efectivoAcumulado >= 0 ? 'success' : 'danger');

  // ── Versus por tipo ──
  const pend = data.pendientePorTipo || {};
  const pag  = data.pagadoPorTipo   || {};
  ['Ingreso','Gasto','Deuda','Inversion'].forEach(tipo => {
    const p = pend[tipo] || 0;
    const g = pag[tipo]  || 0;
    const total = (p + g) || 1;
    const key = tipo === 'Inversion' ? 'Inversion' : tipo;
    document.getElementById(`vp${key}Pend`).style.width = `${(p / total) * 100}%`;
    document.getElementById(`vp${key}Pag`).style.width  = `${(g / total) * 100}%`;
    document.getElementById(`vp${key}PendVal`).textContent = formatoMonedaCorta(p);
    document.getElementById(`vp${key}PagVal`).textContent  = formatoMonedaCorta(g);
  });

  // ── Distribución por tipo ──
  const tipos = data.totalesPorTipo || { Ingreso: 0, Gasto: 0, Deuda: 0, Inversion: 0 };
  const totalTipos = (tipos.Ingreso + tipos.Gasto + tipos.Deuda + tipos.Inversion) || 1;
  document.getElementById('tipoIngresoVal').textContent = formatoMoneda(tipos.Ingreso);
  document.getElementById('tipoGastoVal').textContent   = formatoMoneda(tipos.Gasto);
  document.getElementById('tipoDeudaVal').textContent   = formatoMoneda(tipos.Deuda);
  document.getElementById('tipoInversionVal').textContent = formatoMoneda(tipos.Inversion);
  document.getElementById('tipoIngresoBar').style.width   = `${(tipos.Ingreso   / totalTipos) * 100}%`;
  document.getElementById('tipoGastoBar').style.width     = `${(tipos.Gasto     / totalTipos) * 100}%`;
  document.getElementById('tipoDeudaBar').style.width     = `${(tipos.Deuda     / totalTipos) * 100}%`;
  document.getElementById('tipoInversionBar').style.width = `${(tipos.Inversion / totalTipos) * 100}%`;

  // ── Acumulados Gasto / Deuda / Inversión ──
  const acum = data.acumuladoPorTipo || { Gasto: 0, Deuda: 0, Inversion: 0 };
  document.getElementById('acumGasto').textContent     = formatoMoneda(acum.Gasto);
  document.getElementById('acumDeuda').textContent     = formatoMoneda(acum.Deuda);
  document.getElementById('acumInversion').textContent = formatoMoneda(acum.Inversion);
}

function renderRecientes() {
  const cont = document.getElementById('dashboardRecientes');
  const recientes = [...state.movimientos].slice(0, 8);

  if (recientes.length === 0) {
    cont.innerHTML = `<div class="empty-state">No hay movimientos registrados para este periodo.</div>`;
    return;
  }

  cont.innerHTML = recientes.map(m => `
    <div class="reciente-row">
      <div class="reciente-info">
        <span class="reciente-cat-dot" style="background:${m.categoria_color || '#999'}"></span>
        <div>
          <div class="reciente-concepto">${escapeHtml(m.concepto)}</div>
          <div class="reciente-meta">${m.categoria_nombre} · ${formatoFecha(m.fecha)}</div>
        </div>
      </div>
      <div class="reciente-monto ${m.tipo_movimiento}">${m.tipo_movimiento === 'gasto' ? '-' : '+'} ${formatoMoneda(m.monto)}</div>
    </div>
  `).join('');
}

// ---------------- Render: Checklist ----------------
function bindFiltros() {
  document.querySelectorAll('.filtro-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filtro-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.filtroChecklist = chip.dataset.filtro;
      renderChecklist();
    });
  });
}

function bindOrdenChecklist() {
  document.querySelectorAll('#checklistHeader [data-sort]').forEach(btn => {
    btn.addEventListener('click', () => {
      const campo = btn.dataset.sort;
      if (state.ordenChecklist.campo === campo) {
        state.ordenChecklist.direccion = state.ordenChecklist.direccion === 'asc' ? 'desc' : 'asc';
      } else {
        state.ordenChecklist.campo = campo;
        state.ordenChecklist.direccion = 'asc';
      }
      renderChecklist();
    });
  });
}

function actualizarIndicadoresOrden() {
  document.querySelectorAll('#checklistHeader [data-sort]').forEach(btn => {
    const activo = btn.dataset.sort === state.ordenChecklist.campo;
    btn.classList.toggle('active-sort', activo);
    btn.querySelector('.sort-arrow').textContent = activo
      ? (state.ordenChecklist.direccion === 'asc' ? '▲' : '▼')
      : '';
  });
}

function sortMovimientos(lista) {
  const { campo, direccion } = state.ordenChecklist;
  const factor = direccion === 'asc' ? 1 : -1;

  return [...lista].sort((a, b) => {
    let valA = a[campo];
    let valB = b[campo];

    if (campo === 'monto') {
      valA = Number(valA);
      valB = Number(valB);
    } else if (campo === 'fecha') {
      valA = new Date(valA).getTime();
      valB = new Date(valB).getTime();
    } else {
      valA = String(valA || '').toLowerCase();
      valB = String(valB || '').toLowerCase();
    }

    if (valA < valB) return -1 * factor;
    if (valA > valB) return 1 * factor;
    return 0;
  });
}

function renderChecklist() {
  const cont = document.getElementById('checklistContainer');
  actualizarIndicadoresOrden();

  let lista = [...state.movimientos];
  if (state.filtroChecklist === 'pendiente') lista = lista.filter(m => m.estado === 'pendiente');
  if (state.filtroChecklist === 'pagado') lista = lista.filter(m => m.estado === 'pagado');
  if (state.filtroChecklist === 'plan') lista = lista.filter(m => m.tipo_registro === 'plan');
  if (state.filtroChecklist === 'generico') lista = lista.filter(m => m.tipo_registro === 'generico');

  if (lista.length === 0) {
    cont.innerHTML = `<div class="card empty-state">No hay movimientos que coincidan con este filtro.</div>`;
    return;
  }

  lista = sortMovimientos(lista);

  cont.innerHTML = lista.map(filaChecklistHTML).join('');

  // ── Fila / movimiento ──
  cont.querySelectorAll('[data-toggle-id]').forEach(el => {
    el.addEventListener('click', () => toggleEstado(el.dataset.toggleId, el.dataset.toggleEstado));
  });
  cont.querySelectorAll('[data-edit-id]').forEach(el => {
    el.addEventListener('click', () => abrirModal(el.dataset.editId));
  });
  cont.querySelectorAll('[data-delete-id]').forEach(el => {
    el.addEventListener('click', () => abrirConfirmacionEliminar(el.dataset.deleteId));
  });
  cont.querySelectorAll('[data-add-detalle-id]').forEach(el => {
    el.addEventListener('click', () => abrirModalDetalle(el.dataset.addDetalleId));
  });
  cont.querySelectorAll('[data-toggle-detalle-id]').forEach(el => {
    el.addEventListener('click', () => toggleDetallePanel(el.dataset.toggleDetalleId));
  });

  // ── Detalle (dentro del panel expandido) ──
  cont.querySelectorAll('[data-toggle-detalle]').forEach(el => {
    el.addEventListener('click', () => toggleEstadoDetalle(el.dataset.toggleDetalle, el.dataset.toggleDetalleEstado));
  });
  cont.querySelectorAll('[data-edit-detalle]').forEach(el => {
    el.addEventListener('click', () => abrirModalDetalle(el.dataset.editDetalleMov, el.dataset.editDetalle));
  });
  cont.querySelectorAll('[data-delete-detalle]').forEach(el => {
    el.addEventListener('click', () => abrirConfirmacionEliminarDetalle(el.dataset.deleteDetalle));
  });

  bindDragAndDrop(cont);
}

function iconoChevron(abierto) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="transition:transform .2s ease; transform:rotate(${abierto ? 90 : 0}deg)"><path d="m9 18 6-6-6-6"/></svg>`;
}

function filaChecklistHTML(m) {
  const pagado = m.estado === 'pagado';
  const tieneDetalle = Number(m.tiene_detalle) === 1;
  const detalleAbierto = state.detalleAbiertoId === String(m.id);
  const signo = m.tipo_movimiento === 'gasto' ? '-' : '+';
  const montoStr = `${signo} ${formatoMoneda(m.monto)}`;
  const badgeTipo = `<span class="badge ${m.tipo_registro === 'plan' ? 'badge-plan' : 'badge-generico'}">${m.tipo_registro === 'plan' ? 'Plan' : 'Genérico'}</span>`;
  const badgeEstado = `<span class="badge ${pagado ? 'badge-pagado' : 'badge-pendiente'}">${pagado ? 'Pagado' : 'Pendiente'}</span>`;
  const badgeDetalles = tieneDetalle
    ? `<span class="badge badge-generico">${m.detalles_count} detalle${Number(m.detalles_count) === 1 ? '' : 's'}</span>`
    : '';

  const checkbox = tieneDetalle
    ? `<div class="mov-checkbox disabled ${pagado ? 'checked' : ''}" title="Estado calculado desde los detalles">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6 9 17l-5-5"/></svg>
      </div>`
    : `<div class="mov-checkbox ${pagado ? 'checked' : ''}" data-toggle-id="${m.id}" data-toggle-estado="${pagado ? 'pendiente' : 'pagado'}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6 9 17l-5-5"/></svg>
      </div>`;

  const acciones = `
    <button class="btn-icon" data-add-detalle-id="${m.id}" title="Agregar detalle">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" width="14" height="14"><path d="M12 5v14M5 12h14"/></svg>
    </button>
    <button class="btn-icon" data-toggle-detalle-id="${m.id}" title="Ver desglose">
      ${iconoChevron(detalleAbierto)}
    </button>
    <button class="btn-icon" data-edit-id="${m.id}" title="Editar">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>
    </button>
    <button class="btn-icon" data-delete-id="${m.id}" title="Eliminar" style="color:var(--danger)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
    </button>`;

  return `<div class="mov-row-wrap">
    <div class="mov-row ${pagado ? 'pagado' : ''}" draggable="true" data-movimiento-id="${m.id}" title="Arrastra este movimiento sobre otro para convertirlo en su detalle">

      <!-- ▸ DESKTOP: columnas horizontales -->
      <div class="mov-desktop">
        ${checkbox}
        <div class="mov-col-concepto">
          <div class="mov-concepto ${pagado ? 'pagado-text' : ''}">${escapeHtml(m.concepto)}</div>
          <div class="mov-tag-row">${badgeTipo} ${badgeDetalles}</div>
        </div>
        <div class="mov-col-categoria">${m.categoria_nombre}</div>
        <div class="mov-col-fecha">${formatoFecha(m.fecha)}</div>
        <div class="mov-col-estado">${badgeEstado}</div>
        <div class="mov-col-creado" title="Fecha de creación">${formatoFechaHora(m.creado_en)}</div>
        <div class="mov-monto ${m.tipo_movimiento}">${montoStr}</div>
        <div class="mov-actions">${acciones}</div>
      </div>

      <!-- ▸ MOBILE: tarjeta apilada, toda la info visible -->
      <div class="mov-mobile">
        <div class="movm-top">
          ${checkbox}
          <div class="movm-concepto-wrap">
            <div class="movm-concepto ${pagado ? 'pagado-text' : ''}">${escapeHtml(m.concepto)}</div>
            <div class="movm-badges">${badgeTipo} ${badgeEstado} ${badgeDetalles}</div>
          </div>
          <div class="movm-monto ${m.tipo_movimiento}">${montoStr}</div>
        </div>
        <div class="movm-meta">
          <span class="movm-meta-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
            ${formatoFecha(m.fecha)}
          </span>
          <span class="movm-meta-dot">·</span>
          <span class="movm-meta-item">${m.categoria_nombre}</span>
          <span class="movm-meta-dot">·</span>
          <span class="movm-meta-item">${m.tipo_movimiento === 'gasto' ? 'Gasto' : 'Ingreso'}</span>
        </div>
        <div class="movm-creado">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          Registrado: ${formatoFechaHora(m.creado_en)}
        </div>
        <div class="movm-actions">${acciones}</div>
      </div>

    </div>

    <div class="detalle-panel-container ${detalleAbierto ? 'open' : ''}">
      ${detalleAbierto ? detallePanelHTML(m.id) : ''}
    </div>
  </div>`;
}

// ---------------- Detalle de movimiento (desglose) ----------------
function detallePanelHTML(movimientoId) {
  const detalles = state.detallesCache[movimientoId];

  if (!detalles) {
    return `<div class="detalle-panel card"><div class="detalle-loading">Cargando detalle...</div></div>`;
  }

  if (detalles.length === 0) {
    return `<div class="detalle-panel card">
      <div class="detalle-empty">Aún no hay detalles registrados. Usa el botón «+» para añadir el primero.</div>
    </div>`;
  }

  const totalDetalle = detalles.reduce((acc, d) => acc + Number(d.monto), 0);
  const filas = detalles.map(d => detalleItemHTML(movimientoId, d)).join('');

  return `<div class="detalle-panel card">
    <div class="detalle-panel-head">
      <span>Desglose del movimiento</span>
      <span class="detalle-panel-total">${formatoMoneda(totalDetalle)}</span>
    </div>
    <div class="detalle-lista">${filas}</div>
  </div>`;
}

function detalleItemHTML(movimientoId, d) {
  const pagado = d.estado === 'pagado';
  const chipCategoria = d.categoria_detalle_nombre
    ? `<span class="chip-categoria-detalle" style="background:${d.categoria_detalle_color || '#0F766E'}1A; color:${d.categoria_detalle_color || 'var(--primary-dark)'}">${escapeHtml(d.categoria_detalle_nombre)}</span>`
    : '';
  return `<div class="detalle-item ${pagado ? 'pagado' : ''}" draggable="true" data-detalle-id="${d.id}" data-detalle-mov-id="${movimientoId}" title="Arrastra este detalle sobre otro movimiento para moverlo">
    <div class="detalle-check ${pagado ? 'checked' : ''}" data-toggle-detalle="${d.id}" data-toggle-detalle-estado="${pagado ? 'pendiente' : 'pagado'}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6 9 17l-5-5"/></svg>
    </div>
    <div class="detalle-info">
      <div class="detalle-concepto ${pagado ? 'pagado-text' : ''}">${escapeHtml(d.concepto)}</div>
      <div class="detalle-meta">${formatoFecha(d.fecha)}${d.hora ? ' · ' + formatoHora(d.hora) : ''}${chipCategoria}</div>
    </div>
    <div class="detalle-monto">${formatoMoneda(d.monto)}</div>
    <div class="detalle-actions">
      <button class="btn-icon btn-icon-sm" data-edit-detalle="${d.id}" data-edit-detalle-mov="${movimientoId}" title="Editar detalle">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>
      </button>
      <button class="btn-icon btn-icon-sm" data-delete-detalle="${d.id}" title="Eliminar detalle" style="color:var(--danger)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      </button>
    </div>
  </div>`;
}

async function toggleDetallePanel(movimientoId) {
  movimientoId = String(movimientoId);

  if (state.detalleAbiertoId === movimientoId) {
    state.detalleAbiertoId = null;
    renderChecklist();
    return;
  }

  state.detalleAbiertoId = movimientoId;
  renderChecklist(); // muestra el estado "cargando"
  await cargarDetalles(movimientoId);
  renderChecklist();
}

async function toggleEstadoDetalle(id, nuevoEstado) {
  const res = await apiFetch(`/detalles/${id}/estado`, {
    method: 'PATCH',
    body: JSON.stringify({ estado: nuevoEstado })
  });
  if (!res || !res.ok) {
    mostrarToast(res?.mensaje || 'No se pudo actualizar el detalle', 'error');
  }
  // La actualización visual real llega vía WebSocket ('detalle:actualizado' / 'movimiento:actualizado')
}

async function toggleEstado(id, nuevoEstado) {
  const res = await apiFetch(`/movimientos/${id}/estado`, {
    method: 'PATCH',
    body: JSON.stringify({ estado: nuevoEstado })
  });
  if (res && res.ok) {
    mostrarToast(`Movimiento marcado como ${nuevoEstado}`, 'success');
    // La actualización visual real llega vía WebSocket
  } else {
    mostrarToast(res?.mensaje || 'No se pudo actualizar el estado', 'error');
  }
}

// ---------------- Drag & Drop: mover movimientos/detalles entre sí ----------------
function bindDragAndDrop(cont) {
  // ── Filas de movimiento: origen y destino a la vez ──
  cont.querySelectorAll('.mov-row[data-movimiento-id]').forEach(row => {
    row.addEventListener('dragstart', (e) => {
      const payload = { tipo: 'movimiento', id: row.dataset.movimientoId };
      e.dataTransfer.setData('text/plain', JSON.stringify(payload));
      e.dataTransfer.effectAllowed = 'move';
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));

    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));

    row.addEventListener('drop', async (e) => {
      e.preventDefault();
      row.classList.remove('drag-over');
      const destinoId = row.dataset.movimientoId;
      const raw = e.dataTransfer.getData('text/plain');
      if (!raw) return;

      let payload;
      try { payload = JSON.parse(raw); } catch { return; }

      if (payload.tipo === 'movimiento') {
        if (String(payload.id) === String(destinoId)) return;
        await moverMovimientoComoDetalle(payload.id, destinoId);
      } else if (payload.tipo === 'detalle') {
        if (String(payload.origenMovimientoId) === String(destinoId)) return;
        await moverDetalleAOtroMovimiento(payload.id, destinoId);
      }
    });
  });

  // ── Ítems de detalle: solo origen (se sueltan sobre una fila de movimiento) ──
  cont.querySelectorAll('.detalle-item[data-detalle-id]').forEach(item => {
    item.addEventListener('dragstart', (e) => {
      const payload = {
        tipo: 'detalle',
        id: item.dataset.detalleId,
        origenMovimientoId: item.dataset.detalleMovId
      };
      e.dataTransfer.setData('text/plain', JSON.stringify(payload));
      e.dataTransfer.effectAllowed = 'move';
      e.stopPropagation();
      item.classList.add('dragging');
    });
    item.addEventListener('dragend', (e) => {
      e.stopPropagation();
      item.classList.remove('dragging');
    });
  });
}

async function moverMovimientoComoDetalle(movimientoOrigenId, movimientoDestinoId) {
  const res = await apiFetch(`/movimientos/${movimientoOrigenId}/mover-a/${movimientoDestinoId}`, {
    method: 'PATCH'
  });
  if (res && res.ok) {
    mostrarToast('Movimiento convertido en detalle', 'success');
  } else {
    mostrarToast(res?.mensaje || 'No se pudo mover el movimiento', 'error');
  }
}

async function moverDetalleAOtroMovimiento(detalleId, movimientoDestinoId) {
  const res = await apiFetch(`/detalles/${detalleId}/mover`, {
    method: 'PATCH',
    body: JSON.stringify({ movimiento_id: movimientoDestinoId })
  });
  if (res && res.ok) {
    mostrarToast('Detalle movido a otro movimiento', 'success');
  } else {
    mostrarToast(res?.mensaje || 'No se pudo mover el detalle', 'error');
  }
}

// ---------------- Modal CRUD: Movimiento ----------------
function bindModal() {
  const overlay = document.getElementById('modalOverlay');
  document.getElementById('modalClose').addEventListener('click', cerrarModal);
  document.getElementById('btnCancelar').addEventListener('click', cerrarModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrarModal(); });

  document.querySelectorAll('.seg-control').forEach(seg => {
    seg.addEventListener('click', (e) => {
      const btn = e.target.closest('.seg-btn');
      if (!btn || btn.disabled) return;
      seg.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  document.getElementById('movForm').addEventListener('submit', guardarMovimiento);

  // Confirmación de eliminado (movimiento o detalle)
  document.getElementById('btnCancelarEliminar').addEventListener('click', () => {
    document.getElementById('confirmOverlay').classList.remove('show');
  });
  document.getElementById('btnConfirmarEliminar').addEventListener('click', confirmarEliminar);
}

function valorSeg(segId) {
  return document.querySelector(`#${segId} .seg-btn.active`).dataset.val;
}
function setSeg(segId, valor) {
  document.querySelectorAll(`#${segId} .seg-btn`).forEach(b => {
    b.classList.toggle('active', b.dataset.val === valor);
  });
}

function abrirModal(id = null) {
  const form = document.getElementById('movForm');
  form.reset();
  state.editandoId = id;

  const montoInput = document.getElementById('fMonto');
  const segEstado = document.getElementById('segEstado');
  const notaMonto = document.getElementById('notaMontoCalculado');
  const notaEstado = document.getElementById('notaEstadoCalculado');

  if (id) {
    const m = state.movimientos.find(mov => String(mov.id) === String(id));
    if (!m) return;
    document.getElementById('modalTitle').textContent = 'Editar movimiento';
    document.getElementById('movId').value = m.id;
    document.getElementById('fConcepto').value = m.concepto;
    document.getElementById('fCategoria').value = m.categoria_id;
    document.getElementById('fMonto').value = m.monto;
    document.getElementById('fFecha').value = m.fecha;
    document.getElementById('fDescripcion').value = m.descripcion || '';
    setSeg('segTipoMovimiento', m.tipo_movimiento);
    setSeg('segTipoRegistro', m.tipo_registro);
    setSeg('segEstado', m.estado);

    const tieneDetalle = Number(m.tiene_detalle) === 1;
    montoInput.readOnly = tieneDetalle;
    notaMonto.style.display = tieneDetalle ? 'block' : 'none';
    notaEstado.style.display = tieneDetalle ? 'block' : 'none';
    segEstado.classList.toggle('seg-disabled', tieneDetalle);
    segEstado.querySelectorAll('.seg-btn').forEach(b => { b.disabled = tieneDetalle; });
  } else {
    document.getElementById('modalTitle').textContent = 'Nuevo movimiento';
    document.getElementById('movId').value = '';
    document.getElementById('fFecha').value = new Date().toISOString().slice(0, 10);
    setSeg('segTipoMovimiento', 'gasto');
    setSeg('segTipoRegistro', 'generico');
    setSeg('segEstado', 'pendiente');

    montoInput.readOnly = false;
    notaMonto.style.display = 'none';
    notaEstado.style.display = 'none';
    segEstado.classList.remove('seg-disabled');
    segEstado.querySelectorAll('.seg-btn').forEach(b => { b.disabled = false; });
  }

  document.getElementById('modalOverlay').classList.add('show');
}

function cerrarModal() {
  document.getElementById('modalOverlay').classList.remove('show');
  state.editandoId = null;
}

async function guardarMovimiento(e) {
  e.preventDefault();

  const payload = {
    concepto: document.getElementById('fConcepto').value.trim(),
    categoria_id: Number(document.getElementById('fCategoria').value),
    monto: Number(document.getElementById('fMonto').value),
    fecha: document.getElementById('fFecha').value,
    descripcion: document.getElementById('fDescripcion').value.trim(),
    tipo_movimiento: valorSeg('segTipoMovimiento'),
    tipo_registro: valorSeg('segTipoRegistro'),
    estado: valorSeg('segEstado')
  };

  const id = document.getElementById('movId').value;
  const res = id
    ? await apiFetch(`/movimientos/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
    : await apiFetch('/movimientos', { method: 'POST', body: JSON.stringify(payload) });

  if (res && res.ok) {
    mostrarToast(id ? 'Movimiento actualizado' : 'Movimiento creado', 'success');
    cerrarModal();
  } else {
    mostrarToast(res?.mensaje || 'No se pudo guardar el movimiento', 'error');
  }
}

function abrirConfirmacionEliminar(id) {
  state.idAEliminar = id;
  state.tipoAEliminar = 'movimiento';
  document.getElementById('confirmTitle').textContent = '¿Eliminar movimiento?';
  document.getElementById('confirmOverlay').classList.add('show');
}

async function confirmarEliminar() {
  const id = state.idAEliminar;
  const tipo = state.tipoAEliminar;
  document.getElementById('confirmOverlay').classList.remove('show');
  if (!id) return;

  if (tipo === 'detalle') {
    const res = await apiFetch(`/detalles/${id}`, { method: 'DELETE' });
    if (res && res.ok) {
      mostrarToast('Detalle eliminado', 'success');
      if (state.detalleAbiertoId) {
        await cargarDetalles(state.detalleAbiertoId);
        renderChecklist();
      }
    } else {
      mostrarToast(res?.mensaje || 'No se pudo eliminar el detalle', 'error');
    }
    return;
  }

  const res = await apiFetch(`/movimientos/${id}`, { method: 'DELETE' });
  if (res && res.ok) {
    mostrarToast('Movimiento eliminado', 'success');
  } else {
    mostrarToast(res?.mensaje || 'No se pudo eliminar el movimiento', 'error');
  }
}

// ---------------- Modal: Detalle de movimiento ----------------
function bindModalDetalle() {
  const overlay = document.getElementById('modalDetalleOverlay');
  document.getElementById('modalDetalleClose').addEventListener('click', cerrarModalDetalle);
  document.getElementById('btnCancelarDetalle').addEventListener('click', cerrarModalDetalle);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrarModalDetalle(); });
  document.getElementById('detalleForm').addEventListener('submit', guardarDetalle);
}

function abrirModalDetalle(movimientoId, detalleId = null) {
  const form = document.getElementById('detalleForm');
  form.reset();
  document.getElementById('detalleMovimientoId').value = movimientoId;
  document.getElementById('detalleId').value = detalleId || '';

  if (detalleId) {
    const detalles = state.detallesCache[movimientoId] || [];
    const d = detalles.find(x => String(x.id) === String(detalleId));
    if (!d) return;
    document.getElementById('modalDetalleTitle').textContent = 'Editar detalle';
    document.getElementById('dConcepto').value = d.concepto;
    document.getElementById('dMonto').value = d.monto;
    document.getElementById('dFecha').value = d.fecha;
    document.getElementById('dHora').value = d.hora ? d.hora.slice(0, 5) : '';
    document.getElementById('dCategoriaDetalle').value = d.categoria_detalle_id || '';
    setSeg('segDetalleEstado', d.estado);
  } else {
    document.getElementById('modalDetalleTitle').textContent = 'Nuevo detalle';
    // La fecha del detalle es SIEMPRE la fecha actual (el momento en que se
    // registra el gasto real), no la fecha del movimiento cabecera.
    document.getElementById('dFecha').value = new Date().toISOString().slice(0, 10);
    const ahora = new Date();
    document.getElementById('dHora').value = `${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}`;
    document.getElementById('dCategoriaDetalle').value = '';
    setSeg('segDetalleEstado', 'pendiente');
  }

  document.getElementById('modalDetalleOverlay').classList.add('show');
}

function cerrarModalDetalle() {
  document.getElementById('modalDetalleOverlay').classList.remove('show');
}

async function guardarDetalle(e) {
  e.preventDefault();
  const movimientoId = document.getElementById('detalleMovimientoId').value;
  const detalleId = document.getElementById('detalleId').value;
  const categoriaDetalleValor = document.getElementById('dCategoriaDetalle').value;

  const payload = {
    concepto: document.getElementById('dConcepto').value.trim(),
    monto: Number(document.getElementById('dMonto').value),
    fecha: document.getElementById('dFecha').value,
    hora: document.getElementById('dHora').value || null,
    estado: valorSeg('segDetalleEstado'),
    categoria_detalle_id: categoriaDetalleValor ? Number(categoriaDetalleValor) : null
  };

  const res = detalleId
    ? await apiFetch(`/detalles/${detalleId}`, { method: 'PUT', body: JSON.stringify(payload) })
    : await apiFetch(`/detalles/movimiento/${movimientoId}`, { method: 'POST', body: JSON.stringify(payload) });

  if (res && res.ok) {
    mostrarToast(detalleId ? 'Detalle actualizado' : 'Detalle agregado', 'success');
    cerrarModalDetalle();
    state.detalleAbiertoId = movimientoId; // deja el desglose abierto para ver el resultado
    await cargarDetalles(movimientoId);
    renderChecklist();
  } else {
    mostrarToast(res?.mensaje || 'No se pudo guardar el detalle', 'error');
  }
}

function abrirConfirmacionEliminarDetalle(id) {
  state.idAEliminar = id;
  state.tipoAEliminar = 'detalle';
  document.getElementById('confirmTitle').textContent = '¿Eliminar este detalle?';
  document.getElementById('confirmOverlay').classList.add('show');
}

// ---------------- WebSockets ----------------
function initSocket() {
  const socket = io({
    auth: { token: localStorage.getItem('token') }
  });

  socket.on('connect_error', (err) => {
    console.error('Error de conexión WebSocket:', err.message);
  });

  socket.on('movimiento:creado', () => cargarMovimientos());
  socket.on('movimiento:actualizado', () => cargarMovimientos());
  socket.on('movimiento:estado-cambiado', () => cargarMovimientos());
  socket.on('movimiento:eliminado', (payload) => {
    // Si el movimiento eliminado tenía su panel de detalle abierto (por
    // haber sido "absorbido" por otro al arrastrarlo), se cierra.
    if (payload && state.detalleAbiertoId === String(payload.id)) {
      state.detalleAbiertoId = null;
    }
    cargarMovimientos();
  });

  socket.on('detalle:creado', (payload) => sincronizarDesdeDetalle(payload));
  socket.on('detalle:actualizado', (payload) => sincronizarDesdeDetalle(payload));
  socket.on('detalle:eliminado', (payload) => sincronizarDesdeDetalle(payload));
  socket.on('detalle:movido', (payload) => sincronizarDesdeDetalleMovido(payload));
}

function sincronizarDesdeDetalle(payload) {
  const movimientoId = String(
    payload.movimiento_id ||
    (payload.movimiento && payload.movimiento.id) ||
    (payload.detalle && payload.detalle.movimiento_id) ||
    ''
  );
  if (!movimientoId || state.detalleAbiertoId !== movimientoId) return;

  cargarDetalles(movimientoId).then(() => {
    if (state.vista === 'checklist') renderChecklist();
  });
}

function sincronizarDesdeDetalleMovido(payload) {
  const origenId = String(payload.movimiento_origen_id || '');
  const destinoId = String(payload.movimiento_destino_id || '');

  if (state.detalleAbiertoId === origenId || state.detalleAbiertoId === destinoId) {
    cargarDetalles(state.detalleAbiertoId).then(() => {
      if (state.vista === 'checklist') renderChecklist();
    });
  }
}

// ---------------- Utilidades ----------------
function formatoFecha(fecha) {
  const [y, m, d] = fecha.split('-');
  return `${d}/${m}/${y}`;
}

function formatoFechaHora(fechaStr) {
  if (!fechaStr) return '—';
  const d = new Date(fechaStr);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Convierte 'HH:MM:SS' (columna TIME) a formato 12h, ej: 7:00 am
function formatoHora(horaStr) {
  if (!horaStr) return '';
  const [h, m] = horaStr.split(':').map(Number);
  const periodo = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${periodo}`;
}

// Formato compacto para valores en las barras (ej: S/ 1.2k)
function formatoMonedaCorta(valor) {
  const n = Number(valor || 0);
  if (n >= 1000) return `S/ ${(n/1000).toFixed(1)}k`;
  return `S/ ${n.toFixed(0)}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function mostrarToast(mensaje, tipo = 'success') {
  const cont = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${tipo}`;
  toast.textContent = mensaje;
  cont.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

init();