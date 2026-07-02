requireAuth();

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

const state = {
  anio: new Date().getFullYear(),
  mes: new Date().getMonth() + 1,
  movimientos: [],
  categorias: [],
  filtroChecklist: 'todos',
  vista: 'dashboard',
  editandoId: null,
  idAEliminar: null,
  ordenChecklist: { campo: 'fecha', direccion: 'desc' }
};

// ---------------- Inicialización ----------------
function init() {
  pintarUsuario();
  poblarSelectoresPeriodo();
  cargarCategorias();
  cargarMovimientos();
  bindNav();
  bindModal();
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

  selMes.addEventListener('change', () => { state.mes = Number(selMes.value); cargarMovimientos(); });
  selAnio.addEventListener('change', () => { state.anio = Number(selAnio.value); cargarMovimientos(); });
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

  cont.querySelectorAll('[data-toggle-id]').forEach(el => {
    el.addEventListener('click', () => toggleEstado(el.dataset.toggleId, el.dataset.toggleEstado));
  });
  cont.querySelectorAll('[data-edit-id]').forEach(el => {
    el.addEventListener('click', () => abrirModal(el.dataset.editId));
  });
  cont.querySelectorAll('[data-delete-id]').forEach(el => {
    el.addEventListener('click', () => abrirConfirmacionEliminar(el.dataset.deleteId));
  });
}

function filaChecklistHTML(m) {
  const pagado = m.estado === 'pagado';
  const signo = m.tipo_movimiento === 'gasto' ? '-' : '+';
  const montoStr = `${signo} ${formatoMoneda(m.monto)}`;
  const badgeTipo = `<span class="badge ${m.tipo_registro === 'plan' ? 'badge-plan' : 'badge-generico'}">${m.tipo_registro === 'plan' ? 'Plan' : 'Genérico'}</span>`;
  const badgeEstado = `<span class="badge ${pagado ? 'badge-pagado' : 'badge-pendiente'}">${pagado ? 'Pagado' : 'Pendiente'}</span>`;
  const checkbox = `
    <div class="mov-checkbox ${pagado ? 'checked' : ''}" data-toggle-id="${m.id}" data-toggle-estado="${pagado ? 'pendiente' : 'pagado'}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6 9 17l-5-5"/></svg>
    </div>`;
  const acciones = `
    <button class="btn-icon" data-edit-id="${m.id}" title="Editar">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>
    </button>
    <button class="btn-icon" data-delete-id="${m.id}" title="Eliminar" style="color:var(--danger)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
    </button>`;

  return `<div class="mov-row ${pagado ? 'pagado' : ''}">

    <!-- ▸ DESKTOP: columnas horizontales -->
    <div class="mov-desktop">
      ${checkbox}
      <div class="mov-col-concepto">
        <div class="mov-concepto ${pagado ? 'pagado-text' : ''}">${escapeHtml(m.concepto)}</div>
        <div class="mov-tag-row">${badgeTipo}</div>
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
          <div class="movm-badges">${badgeTipo} ${badgeEstado}</div>
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

  </div>`;
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
    mostrarToast('No se pudo actualizar el estado', 'error');
  }
}

// ---------------- Modal CRUD ----------------
function bindModal() {
  const overlay = document.getElementById('modalOverlay');
  document.getElementById('modalClose').addEventListener('click', cerrarModal);
  document.getElementById('btnCancelar').addEventListener('click', cerrarModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrarModal(); });

  document.querySelectorAll('.seg-control').forEach(seg => {
    seg.addEventListener('click', (e) => {
      const btn = e.target.closest('.seg-btn');
      if (!btn) return;
      seg.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  document.getElementById('movForm').addEventListener('submit', guardarMovimiento);

  // Confirmación de eliminado
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
  } else {
    document.getElementById('modalTitle').textContent = 'Nuevo movimiento';
    document.getElementById('movId').value = '';
    document.getElementById('fFecha').value = new Date().toISOString().slice(0, 10);
    setSeg('segTipoMovimiento', 'gasto');
    setSeg('segTipoRegistro', 'generico');
    setSeg('segEstado', 'pendiente');
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
  document.getElementById('confirmOverlay').classList.add('show');
}

async function confirmarEliminar() {
  const id = state.idAEliminar;
  document.getElementById('confirmOverlay').classList.remove('show');
  if (!id) return;

  const res = await apiFetch(`/movimientos/${id}`, { method: 'DELETE' });
  if (res && res.ok) {
    mostrarToast('Movimiento eliminado', 'success');
  } else {
    mostrarToast('No se pudo eliminar el movimiento', 'error');
  }
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
  socket.on('movimiento:eliminado', () => cargarMovimientos());
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