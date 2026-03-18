const SHEET_REAL = 'BD_Real';
const SHEET_PPTO = 'BD_Presupuesto';
const SHEET_PPTO_ALT = 'BD Presupuesto';
const SHEET_TC = 'TC';
const SHEET_TD = 'TD';
const FALLBACK_FILTER_COLUMNS = ['Month', 'TIPO__PRESUPUESTO', 'UBICACIÓN', 'Fecha'];
const DEFAULT_EXCEL_PATH = './BD Real vs PPTO.xlsx';
const ROW_RENDER_LIMIT = 600;

const state = {
  real: [],
  ppto: [],
  filterColumns: [...FALLBACK_FILTER_COLUMNS],
  filterCatalog: {},
  filters: Object.fromEntries(FALLBACK_FILTER_COLUMNS.map((c) => [c, ''])),
  textQuery: '',
};

const el = {
  file: document.querySelector('#excelFile'),
  status: document.querySelector('#status'),
  tableReal: document.querySelector('#tableReal'),
  tablePpto: document.querySelector('#tablePpto'),
  countReal: document.querySelector('#countReal'),
  countPpto: document.querySelector('#countPpto'),
  filterGrid: document.querySelector('#filterGrid'),
  clearFilters: document.querySelector('#clearFilters'),
  textQuery: document.querySelector('#textQuery'),
  loadDefaultBtn: document.querySelector('#loadDefaultBtn'),
};

function normalizeHeaders(rows) {
  return rows.map((row) => {
    const normalized = {};
    for (const [key, value] of Object.entries(row)) {
      normalized[String(key).trim()] = value == null ? '' : String(value).trim();
    }
    return normalized;
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
  if (!Number.isNaN(date.getTime())) {
    return date.toISOString().slice(0, 10);
  }

  return String(value);
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

function updateStatus(message, type = 'info') {
  el.status.textContent = message;
  el.status.style.borderLeft = `5px solid ${type === 'error' ? '#ef4444' : '#10b981'}`;
}

function getUniqueValues(rows, col) {
  return Array.from(
    new Set(
      rows
        .map((r) => (r[col] == null ? '' : String(r[col]).trim()))
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, 'es'));
}

function initializeFilters(columns, catalog = {}) {
  state.filterColumns = columns.length ? columns : [...FALLBACK_FILTER_COLUMNS];
  state.filterCatalog = catalog;
  state.filters = Object.fromEntries(state.filterColumns.map((c) => [c, '']));
}

function buildFilters() {
  el.filterGrid.innerHTML = '';

  for (const col of state.filterColumns) {
    const wrapper = document.createElement('label');
    wrapper.textContent = col;

    const select = document.createElement('select');
    select.dataset.column = col;
    select.innerHTML = '<option value="">Todos</option>';

    const values = state.filterCatalog[col]?.length
      ? state.filterCatalog[col]
      : getUniqueValues([...state.real, ...state.ppto], col);

    for (const value of values) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    }

    select.addEventListener('change', (event) => {
      state.filters[col] = event.target.value;
      renderAll();
    });

    wrapper.appendChild(select);
    el.filterGrid.appendChild(wrapper);
  }
}

function rowPassesFilters(row) {
  for (const [col, value] of Object.entries(state.filters)) {
    if (!value) continue;
    if (!(col in row)) continue;
    if (String(row[col]).trim() !== value) return false;
  }

  if (!state.textQuery) return true;
  return Object.values(row)
    .join(' | ')
    .toLowerCase()
    .includes(state.textQuery.toLowerCase());
}

function filterRows(rows) {
  return rows.filter(rowPassesFilters);
}

function renderTable(tableEl, rows, counterEl) {
  if (!rows.length) {
    tableEl.innerHTML = '<tr><td>Sin datos para mostrar.</td></tr>';
    counterEl.textContent = '(0 filas)';
    return;
  }

  const headers = Object.keys(rows[0]);
  const shownRows = rows.slice(0, ROW_RENDER_LIMIT);

  const thead = `<thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>`;
  const tbodyRows = shownRows
    .map(
      (row) =>
        `<tr>${headers.map((h) => `<td>${row[h] == null ? '' : row[h]}</td>`).join('')}</tr>`
    )
    .join('');

  tableEl.innerHTML = `${thead}<tbody>${tbodyRows}</tbody>`;
  counterEl.textContent = `(${rows.length.toLocaleString('es-CL')} filas${rows.length > ROW_RENDER_LIMIT ? `, mostrando ${ROW_RENDER_LIMIT}` : ''})`;
}

function renderAll() {
  const realFiltered = filterRows(state.real);
  const pptoFiltered = filterRows(state.ppto);
  renderTable(el.tableReal, realFiltered, el.countReal);
  renderTable(el.tablePpto, pptoFiltered, el.countPpto);
}

function extractGlobalFiltersFromWorkbook(workbook, combinedRows) {
  const tdRows = normalizeRows(normalizeHeaders(getSheetRows(workbook, SHEET_TC).length ? getSheetRows(workbook, SHEET_TC) : getSheetRows(workbook, SHEET_TD)));
  if (!tdRows.length) {
    const catalog = Object.fromEntries(
      FALLBACK_FILTER_COLUMNS.map((col) => [col, getUniqueValues(combinedRows, col)])
    );
    return { columns: [...FALLBACK_FILTER_COLUMNS], catalog, source: 'fallback' };
  }

  const candidateColumns = Object.keys(tdRows[0]).filter((col) =>
    tdRows.some((row) => String(row[col] || '').trim())
  );
  const columns = candidateColumns.length ? candidateColumns : [...FALLBACK_FILTER_COLUMNS];

  const catalog = Object.fromEntries(
    columns.map((col) => {
      const valuesFromTD = getUniqueValues(tdRows, col);
      const valuesFromData = getUniqueValues(combinedRows, col);
      return [col, valuesFromTD.length ? valuesFromTD : valuesFromData];
    })
  );

  return { columns, catalog, source: getSheetRows(workbook, SHEET_TC).length ? SHEET_TC : SHEET_TD };
}

function applyWorkbook(workbook, sourceLabel = 'archivo') {
  const realRows = normalizeRows(normalizeHeaders(getSheetRows(workbook, SHEET_REAL)));
  const pptoRows = normalizeRows(
    normalizeHeaders(
      getSheetRows(workbook, SHEET_PPTO).length
        ? getSheetRows(workbook, SHEET_PPTO)
        : getSheetRows(workbook, SHEET_PPTO_ALT)
    )
  );

  state.real = realRows;
  state.ppto = pptoRows;

  if (!state.real.length && !state.ppto.length) {
    updateStatus('No se encontraron hojas BD_Real y/o BD_Presupuesto en el archivo.', 'error');
    return;
  }

  const globalFilterSetup = extractGlobalFiltersFromWorkbook(workbook, [...state.real, ...state.ppto]);
  initializeFilters(globalFilterSetup.columns, globalFilterSetup.catalog);

  updateStatus(
    `${sourceLabel} cargado. BD_Real: ${state.real.length.toLocaleString('es-CL')} filas | BD_Presupuesto: ${state.ppto.length.toLocaleString('es-CL')} filas | filtros: ${globalFilterSetup.source}`
  );

  buildFilters();
  renderAll();
}

async function loadFromArrayBuffer(buffer, sourceLabel) {
  const workbook = XLSX.read(buffer, { type: 'array' });
  applyWorkbook(workbook, sourceLabel);
}

async function loadWorkbookFromRoot() {
  try {
    updateStatus('Leyendo BD Real vs PPTO.xlsx desde la raíz...');
    const response = await fetch(DEFAULT_EXCEL_PATH);
    if (!response.ok) throw new Error('No accesible por fetch');
    const buf = await response.arrayBuffer();
    await loadFromArrayBuffer(buf, 'Archivo raíz');
  } catch {
    updateStatus(
      'No se pudo cargar automáticamente desde la raíz. Selecciona el Excel manualmente.',
      'error'
    );
  }
}

el.file.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  updateStatus(`Leyendo ${file.name}...`);
  const buf = await file.arrayBuffer();
  await loadFromArrayBuffer(buf, file.name);
});

el.loadDefaultBtn.addEventListener('click', async () => {
  await loadWorkbookFromRoot();
});

el.clearFilters.addEventListener('click', () => {
  state.filters = Object.fromEntries(state.filterColumns.map((c) => [c, '']));
  state.textQuery = '';
  el.textQuery.value = '';
  for (const select of el.filterGrid.querySelectorAll('select')) {
    select.value = '';
  }
  renderAll();
});

el.textQuery.addEventListener('input', (event) => {
  state.textQuery = event.target.value.trim();
  renderAll();
});

loadWorkbookFromRoot();
