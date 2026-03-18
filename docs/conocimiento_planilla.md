# Conocimiento de la planilla

## 1) Resumen de fuentes

### `BD_Real`
Base transaccional de ejecución real. Registra movimientos efectivamente ocurridos (costos, consumos o partidas ejecutadas) con su trazabilidad temporal y contable.

### `BD Presupuesto` / `BD_Presupuesto`
Base planificada (presupuestada) para comparar contra ejecución real. Puede contener montos proyectados por período, centro de costo, cuenta y tipo presupuestario.

### `TD` (tabla de filtros globales)
Tabla/pestaña de control para filtros transversales equivalentes a los segmentadores de Excel. Se usa para restringir simultáneamente las vistas de `BD_Real` y `BD_Presupuesto` con criterios comunes (mes, tipo, ubicación, fecha, etc.).

---

## 2) Diccionario de campos por hoja

> Nota: Los nombres exactos pueden variar levemente entre hojas (por ejemplo `BD Presupuesto` vs `BD_Presupuesto`). Este diccionario define estándar funcional esperado para integración.

### Hoja: `BD_Real`

| Campo | Tipo esperado | Descripción funcional |
|---|---|---|
| `Fecha` | fecha (ISO `YYYY-MM-DD`) | Fecha del movimiento real. |
| `Month` | texto corto (`YYYY-MM` o nombre de mes) | Clave de agrupación mensual para filtros rápidos. |
| `CECO` | texto alfanumérico | Centro de costo asociado a la partida. |
| `CODIGO` | texto alfanumérico | Código operacional o identificador de partida/rubro. |
| `CUENTA` | texto alfanumérico | Cuenta contable o categoría financiera. |
| `TIPO` | texto | Tipo de registro (clasificación funcional). |
| `UBICACIÓN` | texto | Sede, planta, área geográfica o ubicación operativa. |
| `EXPLICACIÓN DE LA PARTIDA` | texto largo (nullable) | Glosa descriptiva del movimiento. Puede estar vacía. |
| `MONTO` | decimal con signo | Valor monetario ejecutado en moneda base o indicada. |
| `MONEDA` | texto corto (ISO 4217 preferido) | Moneda del registro (`CLP`, `USD`, etc.). |

### Hoja: `BD_Presupuesto`

| Campo | Tipo esperado | Descripción funcional |
|---|---|---|
| `Fecha` | fecha (ISO `YYYY-MM-DD`) | Fecha de vigencia o imputación del presupuesto. |
| `Month` | texto corto (`YYYY-MM` o nombre de mes) | Agrupación mensual presupuestaria. |
| `CECO` | texto alfanumérico | Centro de costo presupuestado. |
| `CODIGO` | texto alfanumérico | Código de partida presupuestaria. |
| `CUENTA` | texto alfanumérico | Cuenta o agrupador contable del presupuesto. |
| `TIPO` | texto | Tipo presupuestario o clasificación de control. |
| `TIPO__PRESUPUESTO` | texto | Segmentación específica del presupuesto para filtros globales. |
| `UBICACIÓN` | texto | Ubicación de imputación del presupuesto. |
| `EXPLICACIÓN DE LA PARTIDA` | texto largo (nullable) | Glosa de detalle de la partida presupuestaria. |
| `MONTO` | decimal con signo | Valor presupuestado; puede incluir negativos (ajustes/reversas). |
| `MONEDA` | texto corto (ISO 4217 preferido) | Moneda del presupuesto. |

### Hoja: `TD`

| Campo | Tipo esperado | Descripción funcional |
|---|---|---|
| `Month` | texto corto | Filtro global por mes para ambas bases. |
| `TIPO__PRESUPUESTO` | texto | Filtro global de tipo de presupuesto. |
| `UBICACIÓN` | texto | Filtro global por ubicación. |
| `Fecha` | fecha (ISO `YYYY-MM-DD`) | Filtro global temporal granular. |

---

## 3) Reglas de normalización

### 3.1 Fechas (serial Excel → ISO)

1. Si un valor de fecha llega como serial Excel (número), convertir usando el sistema 1900:
   - Fecha base operativa: `1899-12-30`.
   - `fecha_iso = base + serial_días`.
2. Si ya viene como texto de fecha, parsear formatos comunes (`DD/MM/YYYY`, `YYYY-MM-DD`) y normalizar a `YYYY-MM-DD`.
3. Si no se puede parsear, registrar como nulo y enviar a cola de calidad de datos.

### 3.2 Montos

1. Eliminar separadores de miles y estandarizar separador decimal a punto (`.`).
2. Convertir a decimal de alta precisión (ej. `DECIMAL(18,2)` o equivalente).
3. Preservar el signo (`+`/`-`) en todas las hojas.
4. Si un monto vacío no representa cero explícito, mantener como nulo (no imputar 0 automáticamente).

### 3.3 Moneda

1. Estandarizar códigos a ISO 4217 (`CLP`, `USD`, `EUR`, etc.).
2. Para valores faltantes, aplicar una moneda por defecto **solo** si la regla de negocio lo define explícitamente.
3. Registrar conversiones de alias (ej. `US$` → `USD`) en tabla de homologación.

---

## 4) Mapeo de dimensiones comunes

Estas dimensiones deben existir y homologarse de forma idéntica entre `BD_Real` y `BD_Presupuesto` para permitir filtros y cruces comparables:

| Dimensión canónica | Origen típico | Regla de homologación |
|---|---|---|
| `Fecha` | Campo `Fecha` | Normalizar a `YYYY-MM-DD`; derivar `Month` desde `Fecha` si no existe. |
| `CECO` | Campo `CECO` | Trim, mayúsculas, remover caracteres invisibles; conservar ceros a la izquierda. |
| `CODIGO` | Campo `CODIGO` | Tratar como texto (no numérico) para evitar pérdida de formato. |
| `CUENTA` | Campo `CUENTA` | Homologar catálogo contable y alias. |
| `TIPO` | Campo `TIPO` | Unificar taxonomía (valores canónicos y sinónimos). |

---

## 5) Filtros globales equivalentes a Excel

Los filtros globales deben comportarse como en Excel: al seleccionar un valor, se restringen simultáneamente todas las tablas/vistas conectadas.

### Filtros requeridos

1. `Month`
   - Nivel: mensual.
   - Uso: comparar real vs presupuesto en el mismo período.

2. `TIPO__PRESUPUESTO`
   - Nivel: clasificación presupuestaria.
   - Uso: analizar solo una familia o tipo de presupuesto.

3. `UBICACIÓN`
   - Nivel: geográfico/organizacional.
   - Uso: segmentar por sede/planta/área.

4. `Fecha`
   - Nivel: diario (o rango).
   - Uso: análisis detallado por ventana temporal.

### Regla de interacción recomendada

- Aplicación en modo **AND** entre filtros activos (intersección).
- Listas de filtros dependientes del contexto actual (solo valores con datos disponibles tras aplicar filtros previos).
- Opción de “Todos” para restaurar universo completo por cada dimensión.

---

## 6) Casos borde

### 6.1 Nulos en `EXPLICACIÓN DE LA PARTIDA`

- Permitir nulos sin bloquear carga ni filtrado.
- Mostrar placeholder visual opcional (ej. `"(Sin explicación)"`) solo en capa de presentación.
- No usar este campo como llave de join.

### 6.2 Signos negativos en presupuesto

- Mantener valores negativos en `BD_Presupuesto` (no aplicar valor absoluto).
- Interpretación funcional típica:
  - ajustes,
  - reversas,
  - redistribuciones.
- En agregaciones, sumar respetando signo para evitar sobreestimación del presupuesto neto.

---

## 7) Recomendaciones de implementación

- Definir un esquema canónico intermedio (staging normalizado) antes de exponer tablas al front-end.
- Implementar validaciones automáticas de calidad:
  - fechas inválidas,
  - moneda no homologada,
  - claves dimensionales vacías.
- Versionar catálogo de homologaciones (`TIPO`, `CUENTA`, monedas) para trazabilidad.
