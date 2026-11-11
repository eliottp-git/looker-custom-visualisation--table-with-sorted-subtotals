# Project Context: Looker Custom Visualization — Subtotal-Sorted Table

## 1. Project Overview & Goal
This project is a custom Looker visualization (`subtotal_sorted_table`) designed to address a key limitation in Looker's native visualisations: **sorting grouped data by subtotal values**.

In standard Looker tables, sorting on a metric sorts raw rows rather than group hierarchies. This visualization enables true hierarchical sorting:
1. Groups data by a primary dimension (Level 1, e.g., product department/category).
2. Calculates subtotals for all metrics within each Level 1 group.
3. Sorts Level 1 groups descending by their **subtotal** of the primary metric.
4. Sorts Level 2 rows (e.g., product category/item) descending by their metric value **within** each group.

## 2. Current Architecture & State
- **Runtime:** Vanilla JavaScript running inside Looker's custom visualization sandbox (`looker.plugins.visualizations.add`).
- **Build / Dev Pipeline:** Webpack 5 + Webpack Dev Server serving over HTTPS (`https://127.0.0.1:3443`), exposed to Looker via `ngrok`.
- **Core Files:**
  - `src/index.js`: Visualization logic (`create` lifecycle for DOM scaffolding/CSS, `updateAsync` for data aggregation, sorting, dynamic option registration, and HTML rendering).
  - `webpack.config.js`: Dev server, HTTPS, and CORS setup.
  - **Existing Config Options:**
  - **Plot:** `showTotal` (grand total row), `showSubtotals` (group subtotal row), `hideRepeatedLabels` (suppress repeating column 1 dimension values on detail rows), `resetColumnOrder` (revert column order toggle; only visible when columns are reordered, auto-resets).
  - **Column Reordering & Persistence:** Drag-and-drop on metric headers in output table, persisted via `config.metricColumnOrder` (survives dashboard tile saves and explore reloads).
  - **Series:** Master-detail selector (`active_series`) providing per-field overrides for:
    - Custom label (`label_${fieldName}`)
    - Column width in px (`width_${fieldName}`)
    - Text alignment (`align_${fieldName}`: Left, Center, Right)
    - Bold styling (`bold_${fieldName}`)
  - **Formatting:**
    - Font sizes: `headerFontSize`, `rowFontSize`
    - Colors & alignment: `headerFontColor`, `headerBgColor`, `headerAlign`, `subtotalFontColor`, `subtotalBgColor`, `rowBgColor`, `borderColor`
    - **Conditional Formatting:** `enable_cf` master toggle ("Enable Conditional Formatting", disabled by default) and 5 progressive rule slots:
      - Rule activation (`cf_active_${i}`) with progressive reveal
      - Progressive field dropdowns (`cf_field_${i}_1`, `cf_field_${i}_2`, ...): clean dropdown per field excluding already chosen fields in other slots of the same rule, auto-compacting and purging trailing slots when fields are reverted to `(None)`
      - Condition operator (`cf_operator_${i}`: `>`, `<`, `>=`, `<=`, `==`, `!=`, `between`)
      - Numerical threshold values (`cf_value_${i}`, `cf_value_max_${i}`)
      - Styling: Independent toggles (`cf_use_bg_${i}`, `cf_use_font_${i}`) with background color (`cf_bg_${i}`) and text color (`cf_font_${i}`) pickers (unchecking a toggle leaves that property transparent / default)
      - Subtotal & Grand Total toggles (`cf_subtotals_${i}`, `cf_totals_${i}`) enabled by default with per-rule toggles

## 3. Next Steps & Target
The objective is to incrementally expand the configuration menu to achieve feature parity with Looker's native **Table Next** visualization, including:
- **Plot & Layout Controls:** e.g., row numbers, column resizing/widths, table theme/density, pagination/row limits.
- **Series Formatting:** e.g., text alignment (left, center, right), column visibility toggles, number formatting.
- **Cell Visualizations & Conditional Formatting:** e.g., color scales, value thresholds, inline bar charts.

## 4. Engineering Principles & Constraints
1. **Preserve Working Functionality:** All existing hierarchical grouping, subtotal sorting, and dynamic series options must remain functional or be cleanly adapted.
2. **Step-by-Step Evolution:** Config options and rendering features will be introduced incrementally to isolate testing and prevent regressions.
3. **No Unnecessary External Dependencies:** Keep the bundle lightweight and compatible with Looker's sandbox environment.

## 5. Dev Commands
- `npm run start:dev` — webpack dev server on `https://127.0.0.1:3443` (self-signed cert; open it once in the browser and accept the warning).
- `npm run build` — production bundle into `dist/`.
- Expose to Looker via a reverse proxy/tunnel (see project notes: `ngrok http https://127.0.0.1:3443`).
