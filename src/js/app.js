const SHEET_REAL = 'BD_Real';
const SHEET_TC = 'TC';
const SHEET_TD = 'TD';
const DEFAULT_EXCEL_CANDIDATES = [
  './BD Real vs PPTO.xlsx',
  './BD%20Real%20vs%20PPTO.xlsx',
  'BD Real vs PPTO.xlsx',
  'BD%20Real%20vs%20PPTO.xlsx',
  '/BD Real vs PPTO.xlsx',
  '/BD%20Real%20vs%20PPTO.xlsx',
];

const TC_KEYS = {
  month: ['Month', 'MES', 'Mes'],
  type: ['TIPO__PRESUPUESTO', 'TIPO_PRESUPUESTO', 'Tipo'],
  location: ['UBICACIÓN', 'UBICACION', 'Ubicación', 'Ubicacion'],
};

const state = {
  rows: [],
  page: 1,
  pageSize: 50,
  sort: { key: '', dir: 'asc' },
  textQuery: '',
  tcFilters: { month: '', type: '', location: '' },
  extraFilterColumns: [],
  extraFilters: {},
  catalogs: { month: [], type: [], location: [], extra: {} },
};

const el = {
  status: document.querySelector('#status'),
  tcMonth: document.querySelector('#tcMonth'),
  tcType: document.querySelector('#tcType'),
  tcLocation: document.querySelector('#tcLocation'),
  filterGrid: document.querySelector('#filterGrid'),
  textQuery: document.querySelector('#textQuery'),
  clearFilters: document.querySelector('#clearFilters'),
  tableReal: document.querySelector('#tableReal'),
  tableMeta: document.querySelector('#tableMeta'),
  prevPage: document.querySelector('#prevPage'),
  nextPage: document.querySelector('#nextPage'),
  pageInfo: document.querySelector('#pageInfo'),
  pageSize: document.querySelector('#pageSize'),
};

function normalizeHeaders(rows) {
  return rows.map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      out[String(k).trim()] = v == null ? '' : String(v).trim();
    }
    return out;
  });
}

function excelDateToISO(value) {
  if (value === '' || value == null) return '';

  if (!Number.isNaN(Number(value)) && Number(value) > 1000) {
    const parsed = XLSX.SSF.parse_date_code(Number(value));
    if (parsed) {
      const mm = String(parsed.m).padStart(2, '0');
      const dd = String(parsed.d).padStart(2, '0');
      return `${parsed.y}-${mm}-${dd}`;
    }
  }

  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);

  return String(value).trim();
}

function normalizeRows(rows) {
  return rows.map((row) => {
    const copy = { ...row };
    if ('Fecha' in copy) copy.Fecha = excelDateToISO(copy.Fecha);
    if (!copy.Month && copy.Fecha && /^\d{4}-\d{2}-\d{2}$/.test(copy.Fecha)) {
      copy.Month = copy.Fecha.slice(0, 7);
    }
    return copy;
  });
}

function getSheetRows(workbook, sheetName) {
  const ws = workbook.Sheets[sheetName];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { defval: '' });
}

function updateStatus(message, type = 'ok') {
  el.status.textContent = message;
  el.status.style.borderLeftColor = type === 'error' ? '#ef4444' : '#10b981';
}

function uniqueValues(rows, col) {
  return Array.from(
    new Set(
      rows
        .map((r) => (r[col] == null ? '' : String(r[col]).trim()))
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, 'es'));
}

function pickColumn(columns, candidates) {
  return candidates.find((c) => columns.includes(c)) || '';
}

function buildSelect(selectEl, values, selected) {
  selectEl.innerHTML = '<option value="">Todos</option>';
  values.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    option.selected = value === selected;
    selectEl.appendChild(option);
  });
}

function setupCatalogs(tcRows, realRows) {
  const realColumns = realRows.length ? Object.keys(realRows[0]) : [];
  const tcColumns = tcRows.length ? Object.keys(tcRows[0]) : [];

  const monthCol = pickColumn(tcColumns, TC_KEYS.month) || pickColumn(realColumns, TC_KEYS.month);
  const typeCol = pickColumn(tcColumns, TC_KEYS.type) || pickColumn(realColumns, TC_KEYS.type);
  const locCol = pickColumn(tcColumns, TC_KEYS.location) || pickColumn(realColumns, TC_KEYS.location);

  state.catalogs.month = monthCol ? uniqueValues(tcRows.length ? tcRows : realRows, monthCol) : [];
  state.catalogs.type = typeCol ? uniqueValues(tcRows.length ? tcRows : realRows, typeCol) : [];
  state.catalogs.location = locCol ? uniqueValues(tcRows.length ? tcRows : realRows, locCol) : [];

  state.tcColumns = { monthCol, typeCol, locCol };

  const preferredExtras = ['Sociedad', 'Centro de Costo', 'Cuenta', 'Moneda', 'Clase de coste'];
  const existingPreferred = preferredExtras.filter((c) => realColumns.includes(c));
  const fallbackExtras = realColumns.slice(0, 5);
  state.extraFilterColumns = existingPreferred.length ? existingPreferred : fallbackExtras;

  state.extraFilters = Object.fromEntries(state.extraFilterColumns.map((col) => [col, '']));
  state.catalogs.extra = Object.fromEntries(
    state.extraFilterColumns.map((col) => [col, uniqueValues(realRows, col)])
  );
}

function buildExtraFilters() {
  el.filterGrid.innerHTML = '';
  state.extraFilterColumns.forEach((col) => {
    const label = document.createElement('label');
    label.textContent = col;

    const select = document.createElement('select');
    select.dataset.column = col;
    buildSelect(select, state.catalogs.extra[col] || [], state.extraFilters[col]);

    select.addEventListener('change', (event) => {
      state.extraFilters[col] = event.target.value;
      state.page = 1;
      render();
    });

    label.appendChild(select);
    el.filterGrid.appendChild(label);
  });
}

function rowPassesFilters(row) {
  const { monthCol, typeCol, locCol } = state.tcColumns;

  if (state.tcFilters.month && monthCol && String(row[monthCol] || '').trim() !== state.tcFilters.month) {
    return false;
  }
  if (state.tcFilters.type && typeCol && String(row[typeCol] || '').trim() !== state.tcFilters.type) {
    return false;
  }
  if (state.tcFilters.location && locCol && String(row[locCol] || '').trim() !== state.tcFilters.location) {
    return false;
  }

  for (const [col, value] of Object.entries(state.extraFilters)) {
    if (!value) continue;
    if (String(row[col] || '').trim() !== value) return false;
  }

  if (!state.textQuery) return true;
  return Object.values(row).join(' | ').toLowerCase().includes(state.textQuery.toLowerCase());
}

function sortRows(rows) {
  if (!state.sort.key) return rows;

  const { key, dir } = state.sort;
  const sorted = [...rows].sort((a, b) => {
    const av = String(a[key] ?? '').trim();
    const bv = String(b[key] ?? '').trim();

    const an = Number(av.replace(',', '.'));
    const bn = Number(bv.replace(',', '.'));
    const bothNumeric = !Number.isNaN(an) && !Number.isNaN(bn) && av !== '' && bv !== '';

    if (bothNumeric) return an - bn;
    return av.localeCompare(bv, 'es', { sensitivity: 'base' });
  });

  return dir === 'asc' ? sorted : sorted.reverse();
}

function renderTable(rows) {
  if (!rows.length) {
    el.tableReal.innerHTML = '<tr><td>Sin registros para mostrar.</td></tr>';
    return;
  }

  const headers = Object.keys(rows[0]);
  const head = headers
    .map((h) => {
      const active = state.sort.key === h ? 'sort-active' : '';
      const arrow = state.sort.key === h ? (state.sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
      return `<th class="${active}" data-col="${h}">${h}${arrow}</th>`;
    })
    .join('');

  const body = rows
    .map((row) => `<tr>${headers.map((h) => `<td>${row[h] ?? ''}</td>`).join('')}</tr>`)
    .join('');

  el.tableReal.innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body}</tbody>`;

  el.tableReal.querySelectorAll('th[data-col]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.col;
      if (state.sort.key === key) {
        state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sort.key = key;
        state.sort.dir = 'asc';
      }
      render();
    });
  });
}

function render() {
  const filtered = state.rows.filter(rowPassesFilters);
  const sorted = sortRows(filtered);

  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
  if (state.page > totalPages) state.page = totalPages;

  const start = (state.page - 1) * state.pageSize;
  const pageRows = sorted.slice(start, start + state.pageSize);

  renderTable(pageRows);

  const from = total ? start + 1 : 0;
  const to = Math.min(start + state.pageSize, total);
  el.tableMeta.textContent = `${total.toLocaleString('es-CL')} registros filtrados | mostrando ${from}-${to}`;
  el.pageInfo.textContent = `Página ${state.page} de ${totalPages}`;
  el.prevPage.disabled = state.page <= 1;
  el.nextPage.disabled = state.page >= totalPages;
}

function wireEvents() {
  el.tcMonth.addEventListener('change', (e) => {
    state.tcFilters.month = e.target.value;
    state.page = 1;
    render();
  });

  el.tcType.addEventListener('change', (e) => {
    state.tcFilters.type = e.target.value;
    state.page = 1;
    render();
  });

  el.tcLocation.addEventListener('change', (e) => {
    state.tcFilters.location = e.target.value;
    state.page = 1;
    render();
  });

  el.textQuery.addEventListener('input', (e) => {
    state.textQuery = e.target.value.trim();
    state.page = 1;
    render();
  });

  el.pageSize.addEventListener('change', (e) => {
    state.pageSize = Number(e.target.value);
    state.page = 1;
    render();
  });

  el.prevPage.addEventListener('click', () => {
    if (state.page > 1) state.page -= 1;
    render();
  });

  el.nextPage.addEventListener('click', () => {
    state.page += 1;
    render();
  });

  el.clearFilters.addEventListener('click', () => {
    state.tcFilters = { month: '', type: '', location: '' };
    state.textQuery = '';
    state.extraFilters = Object.fromEntries(state.extraFilterColumns.map((c) => [c, '']));
    state.page = 1;

    el.textQuery.value = '';
    el.tcMonth.value = '';
    el.tcType.value = '';
    el.tcLocation.value = '';
    Array.from(el.filterGrid.querySelectorAll('select')).forEach((s) => {
      s.value = '';
    });

    render();
  });
}

function applyWorkbook(workbook) {
  const realRows = normalizeRows(normalizeHeaders(getSheetRows(workbook, SHEET_REAL)));
  const tcRowsRaw = getSheetRows(workbook, SHEET_TC);
  const tdRowsRaw = getSheetRows(workbook, SHEET_TD);
  const tcRows = normalizeRows(normalizeHeaders(tcRowsRaw.length ? tcRowsRaw : tdRowsRaw));

  if (!realRows.length) {
    updateStatus('No se encontró la hoja BD_Real en el archivo.', 'error');
    return;
  }

  state.rows = realRows;
  setupCatalogs(tcRows, realRows);

  buildSelect(el.tcMonth, state.catalogs.month, state.tcFilters.month);
  buildSelect(el.tcType, state.catalogs.type, state.tcFilters.type);
  buildSelect(el.tcLocation, state.catalogs.location, state.tcFilters.location);
  buildExtraFilters();

  updateStatus(
    `Archivo cargado correctamente. BD_Real: ${realRows.length.toLocaleString('es-CL')} filas.`
  );

  render();
}

async function loadWorkbookFromRoot() {
  updateStatus('Cargando BD Real vs PPTO.xlsx desde la raíz...');

  const errors = [];
  for (const path of DEFAULT_EXCEL_CANDIDATES) {
    try {
      const response = await fetch(path, { cache: 'no-store' });
      if (!response.ok) {
        errors.push(`${path} -> HTTP ${response.status}`);
        continue;
      }

      const buf = await response.arrayBuffer();
      const workbook = XLSX.read(buf, { type: 'array' });
      applyWorkbook(workbook);
      return;
    } catch (error) {
      errors.push(`${path} -> ${error?.message || 'error de red'}`);
    }
  }

  const runningOnFileProtocol = window.location.protocol === 'file:';
  const protocolHint = runningOnFileProtocol
    ? ' Detectado file://; por seguridad del navegador fetch puede fallar en archivos locales. Levanta un servidor simple (ej: `python -m http.server`) y vuelve a abrir la URL http://localhost.'
    : '';

  updateStatus(
    `No se pudo cargar BD Real vs PPTO.xlsx desde la raíz. Intentos: ${errors.join(' | ')}.${protocolHint}`,
    'error'
  );
}

wireEvents();
loadWorkbookFromRoot();
