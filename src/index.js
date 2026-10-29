looker.plugins.visualizations.add({
  id: "subtotal_sorted_table",
  label: "Table with Sorted Subtotals",
  
  options: {}, // Dynamically generated in updateAsync

  create: function(element, config) {
    element.innerHTML = `
      <style>
        .custom-vis-table-container {
          width: 100%;
          height: 100%;
          overflow: auto;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          font-size: 12px;
          color: #333;
        }
        .custom-table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
        }
        .custom-table th, .custom-table td {
          padding: 8px 12px;
          border-bottom: 1px solid var(--table-border, #e0e0e0);
          white-space: nowrap;
        }
        .custom-table th {
          font-weight: 600;
          position: sticky;
          top: 0;
          z-index: 12;
          border-bottom: 2px solid var(--table-border, #d0d7de);
        }
        .custom-table thead tr:nth-child(2) th {
          top: var(--pivot-header-offset, 0px);
          z-index: 11;
        }
        .custom-table th.pivot-group {
          text-align: center;
          vertical-align: middle;
        }
        .custom-table thead th[rowspan] {
          vertical-align: bottom;
        }
        .custom-table th.draggable-metric {
          cursor: pointer;
          user-select: none;
        }
        .custom-table th.is-dragging {
          opacity: 0.35;
          cursor: grabbing;
        }
        .custom-table th.drop-left {
          box-shadow: inset 3px 0 0 #1a73e8 !important;
        }
        .custom-table th.drop-right {
          box-shadow: inset -3px 0 0 #1a73e8 !important;
        }
        .drag-handle {
          display: inline-block;
          margin-right: 6px;
          color: #94a3b8;
          font-size: 10px;
          cursor: grab;
          user-select: none;
        }
        .drag-handle:active {
          cursor: grabbing;
        }
        .sort-indicator {
          display: inline-block;
          margin-left: 6px;
          font-size: 9px;
          vertical-align: middle;
        }
        .sort-indicator.is-secondary {
          opacity: 0.4;
        }
        .custom-table .number {
          text-align: right;
        }
        .custom-table .subtotal-row {
          font-weight: 600;
          cursor: pointer;
        }
        .custom-table .subtotal-row td {
          border-top: 1px solid var(--table-border, #cbd5e1);
          border-bottom: 2px solid var(--table-border, #cbd5e1);
        }
        .custom-table .subtotal-row.depth-2 td {
          border-top: none;
          border-bottom: 1px solid var(--table-border, #cbd5e1);
        }
        .custom-table tr.is-frozen > td {
          position: sticky;
          top: var(--frozen-row-top, 0px);
          z-index: 10;
        }
        .custom-table tr.is-frozen-l2 > td {
          position: sticky;
          top: calc(var(--frozen-row-top, 0px) + var(--frozen-l1-row-height, 0px));
          z-index: 8;
        }
        .custom-table tr.is-frozen-l2.is-stale > td {
          visibility: hidden;
        }
        .custom-table .freeze-col {
          position: sticky;
          z-index: 5;
        }
        .custom-table .freeze-l1 {
          left: 0;
        }
        .custom-table .freeze-l2 {
          left: var(--freeze-l2-left, 0px);
        }
        .custom-table .freeze-l3 {
          left: var(--freeze-l3-left, 0px);
        }
        .custom-table tr.is-frozen > td.freeze-col {
          z-index: 11;
        }
        .custom-table tr.is-frozen-l2 > td.freeze-col {
          z-index: 9;
        }
        .custom-table th.freeze-col {
          z-index: 13;
        }
        .custom-table .freeze-edge {
          box-shadow: inset -1px 0 0 var(--table-border, #e0e0e0), 4px 0 4px -2px rgba(0, 0, 0, 0.12);
        }
        .collapse-chevron {
          display: inline-block;
          width: 12px;
          margin-right: 6px;
          color: #64748b;
          font-size: 9px;
        }
        .custom-table tr.is-hidden {
          display: none;
        }
        .custom-table .grand-total-row {
          background-color: #e2e8f0;
          font-weight: bold;
          border-top: 2px solid #64748b;
        }
        .custom-table .grand-total-row > td {
          background-color: #e2e8f0;
        }
        .custom-table .indent-cell {
          padding-left: 24px;
          color: #64748b;
        }
        .is-bold {
          font-weight: bold !important;
        }
        .is-italic {
          font-style: italic !important;
        }
        .is-underline {
          text-decoration: underline !important;
        }
        .custom-table a,
        .custom-table a:visited {
          color: inherit;
          text-decoration: none;
        }
        .custom-table a:hover {
          cursor: pointer;
          text-decoration: underline dotted;
        }
      </style>
      <div class="custom-vis-table-container" id="table-container"></div>
    `;
  },

  updateAsync: function(data, element, config, queryResponse, details, done) {
    this.clearErrors();

    const dimensions = queryResponse.fields.dimension_like || [];
    const measures = queryResponse.fields.measure_like || [];
    
    // Looker's dimension_like and measure_like already categorize all dimensions, measures,
    // and table calculations (string calcs in dimension_like, numeric calcs in measure_like).
    const allFields = [...dimensions, ...measures];
    const metrics = [...measures];
    // Numeric table calculations normally live in measure_like. If Looker only
    // lists a pivot_index-style calculation under table_calculations, keep it.
    const metricNames = new Set(metrics.map(m => m.name));
    (queryResponse.fields.table_calculations || []).forEach((field) => {
      if (!field || metricNames.has(field.name) || field.is_numeric === false) return;
      metrics.push(field);
      allFields.push(field);
      metricNames.add(field.name);
    });

    if (dimensions.length < 2 || metrics.length < 1) {
      this.addError({
        title: "Insufficient Fields",
        message: "This visualization requires 2 or 3 dimensions (Level 1, Level 2, optional Level 3) and 1 measure."
      });
      return;
    }

    if (dimensions.length > 3) {
      this.addError({
        title: "Too Many Dimensions",
        message: "This visualization supports up to 3 dimensions. Remove or hide the extra dimensions."
      });
      return;
    }

    // Validate that native Looker subtotals are enabled in the Data panel
    const hasSubtotals = !!(
      queryResponse.subtotals_data &&
      Object.keys(queryResponse.subtotals_data).length > 0
    );

    if (!hasSubtotals) {
      this.addError({
        title: "Subtotals Required",
        message: "Please check the 'Subtotals' checkbox in the Data panel. This visualization requires native Looker subtotals to sort groups accurately and compute valid ratios and percentages."
      });
      return;
    }

    // Check if Looker totals are enabled in the query
    const hasTotals = !!(queryResponse.has_totals || queryResponse.totals_data);

    // A pivot does not add measures. Looker keeps one measure field and nests each
    // column on the cell: row[measure.name][pivot.key]. Flatten that into one display
    // column per measure × pivot value. With no pivot, the column id stays the measure
    // name, so a saved sort and column order still match.
    const pivotFields = queryResponse.fields.pivots || [];
    const pivots = Array.isArray(queryResponse.pivots) ? queryResponse.pivots : [];
    const hasPivots = pivots.length > 0;
    const emptyMarker = `<span style="color: #94a3b8;">&#8709;</span>`;

    const escapeHtml = (value) => String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

    // Pivot header values are not measure cells. Looker puts a plain string on
    // pivot.data[field] ("Current"), and a real cell, when it has one, on
    // pivot.metadata[field]. Reading .value on the string is undefined, which
    // was rendering as null. Fall back to pivot.key, which is that same value.
    const labelFromPivotEntry = (entry) => {
      if (entry === null || entry === undefined || entry === "") return null;
      if (typeof entry !== "object") return escapeHtml(entry);

      if (typeof entry.html === "string" && entry.html !== "") return entry.html;
      if (typeof entry.rendered === "string" && entry.rendered !== "") return entry.rendered;

      if (typeof LookerCharts !== "undefined" && LookerCharts.Utils && LookerCharts.Utils.htmlForCell) {
        const html = LookerCharts.Utils.htmlForCell(entry);
        if (typeof html === "string" && html !== "" && html !== "null") return html;
      }

      if (entry.value !== null && entry.value !== undefined && entry.value !== "") {
        return escapeHtml(entry.value);
      }
      return null;
    };

    const renderPivotLabel = (pivot) => {
      if (!pivot || pivot.is_total) return "Total";

      const parts = [];
      pivotFields.forEach((field) => {
        const fromMetadata = pivot.metadata && labelFromPivotEntry(pivot.metadata[field.name]);
        const fromData = pivot.data && labelFromPivotEntry(pivot.data[field.name]);
        const part = fromMetadata || fromData;
        if (part) parts.push(part);
      });

      if (parts.length > 0) return parts.join(" / ");
      if (pivot.key !== null && pivot.key !== undefined && pivot.key !== "") return escapeHtml(pivot.key);
      return emptyMarker;
    };

    // pivot_index, pivot_offset, pivot_row, and pivot_where produce one column.
    // Looker marks those calculations can_pivot: false, and the cell is a normal
    // { value, rendered } rather than a map of pivot keys. Everything else in a
    // pivoted query is repeated once per pivot value.
    const firstMeasureCell = (measureName) => {
      const fromRow = (row) => {
        if (!row) return null;
        const cell = row[measureName];
        return cell && typeof cell === "object" ? cell : null;
      };
      if (Array.isArray(data)) {
        for (let i = 0; i < data.length; i++) {
          const cell = fromRow(data[i]);
          if (cell) return cell;
        }
      }
      const subs = queryResponse.subtotals_data;
      if (subs && typeof subs === "object") {
        const lists = Object.values(subs);
        for (let i = 0; i < lists.length; i++) {
          const list = lists[i];
          if (!Array.isArray(list)) continue;
          for (let j = 0; j < list.length; j++) {
            const cell = fromRow(list[j]);
            if (cell) return cell;
          }
        }
      }
      return fromRow(queryResponse.totals_data);
    };

    const repeatsForEachPivot = (measure) => {
      if (!hasPivots) return false;
      const cell = firstMeasureCell(measure.name);
      if (cell) {
        const hasPivotBucket = pivots.some((pivot) => Object.prototype.hasOwnProperty.call(cell, pivot.key));
        if (hasPivotBucket) return true;
        if (cell.value !== undefined || cell.rendered !== undefined || cell.html !== undefined) return false;
      }
      if (measure.can_pivot === false) return false;
      return true;
    };

    // Looker has no hidden-pivot setting for custom visualizations (config.hidden_pivots is
    // never passed in). Instead, when a pivot column or a single measure x pivot column is
    // hidden, Looker drops that cell from every detail row in `data`. It leaves the pivot in
    // queryResponse.pivots, and subtotals_data / totals_data still carry the values, so
    // only `data` can be used for this check. A genuine null still has the key
    // ({ value: null }), so it is not mistaken for a hidden column.
    const isPivotColumnVisible = (measureName, pivotKey) => {
      // No detail rows means nothing to infer from: keep the column.
      if (!Array.isArray(data) || data.length === 0) return true;
      return data.some((row) => {
        const cell = row && row[measureName];
        return !!cell && typeof cell === "object" &&
          Object.prototype.hasOwnProperty.call(cell, pivotKey);
      });
    };

    const displayColumns = [];
    if (!hasPivots) {
      metrics.forEach((measure) => {
        displayColumns.push({
          id: measure.name,
          measureName: measure.name,
          measure,
          pivotKey: null,
          pivoted: false,
          pivotLabel: ""
        });
      });
    } else {
      const repeatedMetrics = [];
      const singleMetrics = [];
      metrics.forEach((measure) => {
        if (repeatsForEachPivot(measure)) repeatedMetrics.push(measure);
        else singleMetrics.push(measure);
      });
      // Pivot outer, measure inner: Current/Sales, Current/Units, Previous/Sales, Previous/Units.
      // A pivot_index calculation stays one column after those, as in Looker's data table.
      pivots.forEach((pivot) => {
        const label = renderPivotLabel(pivot);
        repeatedMetrics.forEach((measure) => {
          if (!isPivotColumnVisible(measure.name, pivot.key)) return;
          displayColumns.push({
            id: measure.name + "||" + pivot.key,
            measureName: measure.name,
            measure,
            pivotKey: pivot.key,
            pivoted: true,
            pivotLabel: label
          });
        });
      });
      singleMetrics.forEach((measure) => {
        displayColumns.push({
          id: measure.name,
          measureName: measure.name,
          measure,
          pivotKey: null,
          pivoted: false,
          pivotLabel: ""
        });
      });
    }

    const columnById = {};
    displayColumns.forEach((column) => { columnById[column.id] = column; });
    const defaultColumnIds = displayColumns.map((column) => column.id);

    // Column Order Reconciliation:
    // Determine the active display order. Reconciles saved custom order from config
    // with the current columns so added/removed fields and pivot values are handled gracefully.
    let savedOrder = config.metricColumnOrder;
    if (typeof savedOrder === "string") {
      try {
        savedOrder = JSON.parse(savedOrder);
      } catch (e) {
        savedOrder = savedOrder.split(",").map(s => s.trim()).filter(Boolean);
      }
    }

    let orderedColumnIds = [];
    if (Array.isArray(savedOrder)) {
      orderedColumnIds = savedOrder.filter(name => defaultColumnIds.includes(name));
    }
    defaultColumnIds.forEach(name => {
      if (!orderedColumnIds.includes(name)) {
        orderedColumnIds.push(name);
      }
    });

    const hasCustomOrder = orderedColumnIds.some((name, idx) => name !== defaultColumnIds[idx]);

    // Sort column: first display column by default (first pivot of the first measure when pivoted).
    // A header click stores that column id and only re-sorts the existing result.
    const defaultSortMetric = defaultColumnIds[0];
    let sortMetric = (typeof config.sortMetric === "string" && defaultColumnIds.includes(config.sortMetric))
      ? config.sortMetric
      : defaultSortMetric;
    let sortDirection = config.sortDirection === "asc" ? "asc" : "desc";
    // Shift+click on the Level 2 header: rows inside each group sort by Level 2 label
    // instead of the active metric. Group order still follows the active metric.
    let secondarySortDirection = ["asc", "desc"].includes(config.secondarySortDirection)
      ? config.secondarySortDirection
      : "";

    // With 3 dimensions, Level 1 and Level 2 are groups and Level 3 is the detail row.
    // Shift+click on the Level 2 header then sorts the Level 2 groups alphabetically.
    const levelCount = dimensions.length;
    const hasMiddleLevel = levelCount === 3;
    let middleSortDirection = hasMiddleLevel && ["asc", "desc"].includes(config.middleSortDirection)
      ? config.middleSortDirection
      : "";

    const hasCustomSort = sortMetric !== defaultSortMetric || sortDirection !== "desc" ||
      secondarySortDirection !== "" || middleSortDirection !== "";

    // Handle Reset action from the Plot tab toggle: restores column order and every sort.
    if (config.resetColumnOrder) {
      this.trigger('updateConfig', [
        {
          metricColumnOrder: "",
          sortMetric: "",
          sortDirection: "",
          secondarySortDirection: "",
          middleSortDirection: "",
          resetColumnOrder: false
        }
      ]);
      orderedColumnIds = [...defaultColumnIds];
      sortMetric = defaultSortMetric;
      sortDirection = "desc";
      secondarySortDirection = "";
      middleSortDirection = "";
    }

    const readCollapsedKeys = (value) => {
      if (typeof value !== "string" || !value) return [];
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.map(k => String(k)) : [];
      } catch (e) {
        return [];
      }
    };

    // Same momentary toggle as column order: on means "expand everything", then it turns itself off.
    let expandAllGroups = false;
    if (config.resetCollapsedGroups) {
      expandAllGroups = true;
      this.trigger("updateConfig", [
        {
          collapsedGroups: "",
          resetCollapsedGroups: false
        }
      ]);
    }

    const hasCollapsedGroups = !expandAllGroups && readCollapsedKeys(config.collapsedGroups).length > 0;

    const orderedColumns = orderedColumnIds.map(id => columnById[id]).filter(Boolean);

    const sortColumn = columnById[sortMetric] || orderedColumns[0];

    // 1. DYNAMIC OPTIONS CONFIGURATION
    const plotOptions = {
      showSubtotals: { section: "Plot", type: "boolean", label: "Show Subtotals", default: true, order: 1 },
      // Level 2 groups are still sorted by their subtotal when these rows are off.
      showLevel2Subtotals: {
        section: "Plot",
        type: "boolean",
        label: "Show Level 2 Subtotals",
        default: true,
        order: 2,
        hidden: !hasMiddleLevel || config.showSubtotals === false
      },
      hideRepeatedLabels: { section: "Plot", type: "boolean", label: "Hide Repeated Labels", default: false, order: 3 }
    };

    // Only expose the "Show Totals" toggle if totals were computed in the query
    if (hasTotals) {
      plotOptions.showTotal = { section: "Plot", type: "boolean", label: "Show Totals", default: true, order: 4 };
    }

    // Expose the revert toggle in Plot tab when columns are reordered or the sort changed
    plotOptions.resetColumnOrder = {
      section: "Plot",
      type: "boolean",
      label: "Revert Original Column Order & Sorting",
      default: false,
      order: 5,
      hidden: !hasCustomOrder && !hasCustomSort
    };

    plotOptions.resetCollapsedGroups = {
      section: "Plot",
      type: "boolean",
      label: "Revert to Uncollapsed View",
      default: false,
      order: 6,
      hidden: !hasCollapsedGroups
    };

    // Off keeps the two header rows (pivot value, then measure name).
    // On folds both into one cell: "Gross Sales (Current)".
    plotOptions.pivotInMeasureLabel = {
      section: "Plot",
      type: "boolean",
      label: "Pivot Value in Brackets",
      default: false,
      order: 7,
      hidden: !hasPivots
    };

    // Hide the dimension columns from display only. The fields stay in the query,
    // so grouping, subtotals and sorting keep working.
    let plotOrder = 8;
    for (let level = 1; level <= 3; level++) {
      plotOptions[`hideLevel${level}`] = {
        section: "Plot",
        type: "boolean",
        label: `Hide Level ${level}`,
        default: false,
        order: plotOrder++,
        hidden: level > levelCount
      };
    }

    plotOptions.freezeCurrentRow = {
      section: "Plot",
      type: "boolean",
      label: "Freeze Current Row",
      default: true,
      order: plotOrder++
    };

    for (let level = 1; level <= 3; level++) {
      plotOptions[`freezeLevel${level}`] = {
        section: "Plot",
        type: "boolean",
        label: `Freeze Level ${level}`,
        default: false,
        order: plotOrder++,
        hidden: level > levelCount || config[`hideLevel${level}`] === true
      };
    }

    // Hidden option to register metricColumnOrder with Looker's configuration store.
    // In Looker visualizations, properties passed via this.trigger('updateConfig')
    // MUST be declared in options so Looker persists and passes them into config on subsequent updateAsync calls.
    const internalOptions = {
      metricColumnOrder: {
        type: "string",
        hidden: true
      },
      sortMetric: {
        type: "string",
        hidden: true
      },
      sortDirection: {
        type: "string",
        hidden: true
      },
      secondarySortDirection: {
        type: "string",
        hidden: true
      },
      middleSortDirection: {
        type: "string",
        hidden: true
      },
      // Registered so Looker will store it on the Look or dashboard element.
      // hidden: true keeps it out of the gear menu. Empty means every group is open.
      collapsedGroups: {
        type: "string",
        hidden: true
      }
    };

    // Build series dropdown options dynamically from all dimensions and metrics
    const seriesSelectOptions = allFields.map(field => {
      const fieldLabel = field.label_short || field.label;
      return { [fieldLabel]: field.name };
    });

    // Default to the first field if nothing is selected yet
    const activeSeriesKey = config.active_series || (allFields[0] && allFields[0].name);

    const seriesOptions = {
      active_series: {
        section: "Series",
        type: "string",
        display: "select",
        label: "Customize Series",
        values: seriesSelectOptions,
        default: allFields[0] && allFields[0].name,
        order: 1
      }
    };

    // Register options for ALL fields so Looker persists their config values,
    // but only reveal (hidden: false) the inputs for the currently selected series.
    let seriesOrder = 2;
    allFields.forEach(field => {
      const fieldName = field.name;
      const fieldLabel = field.label_short || field.label;
      const isHidden = fieldName !== activeSeriesKey;

      seriesOptions[`label_${fieldName}`] = {
        section: "Series",
        type: "string",
        label: `Label (${fieldLabel})`,
        placeholder: fieldLabel,
        default: "",
        hidden: isHidden,
        order: seriesOrder++
      };

      seriesOptions[`width_${fieldName}`] = {
        section: "Series",
        type: "number",
        label: `Width (px)`,
        placeholder: "auto",
        hidden: isHidden,
        order: seriesOrder++
      };

      seriesOptions[`align_${fieldName}`] = {
        section: "Series",
        type: "string",
        display: "select",
        label: `Text Alignment`,
        values: [
          { "Default": "" },
          { "Left": "left" },
          { "Center": "center" },
          { "Right": "right" }
        ],
        default: "",
        hidden: isHidden,
        order: seriesOrder++
      };

      seriesOptions[`bold_${fieldName}`] = {
        section: "Series",
        type: "boolean",
        label: "Bold",
        display_size: "third",
        default: false,
        hidden: isHidden,
        order: seriesOrder++
      };

      seriesOptions[`italic_${fieldName}`] = {
        section: "Series",
        type: "boolean",
        label: "Italic",
        display_size: "third",
        default: false,
        hidden: isHidden,
        order: seriesOrder++
      };

      seriesOptions[`underline_${fieldName}`] = {
        section: "Series",
        type: "boolean",
        label: "Underl.",
        display_size: "third",
        default: false,
        hidden: isHidden,
        order: seriesOrder++
      };

      seriesOptions[`fontColor_${fieldName}`] = {
        section: "Series",
        type: "string",
        display: "color",
        label: "Font Color",
        display_size: "half",
        default: "",
        hidden: isHidden,
        order: seriesOrder++
      };

      seriesOptions[`bgColor_${fieldName}`] = {
        section: "Series",
        type: "string",
        display: "color",
        label: "Background Color",
        display_size: "half",
        default: "",
        hidden: isHidden,
        order: seriesOrder++
      };

      seriesOptions[`matchBorder_${fieldName}`] = {
        section: "Series",
        type: "boolean",
        label: "Match Border to Background",
        default: false,
        hidden: isHidden,
        order: seriesOrder++
      };

      // Value Formatting: Preset Dropdown matching Table Next
      seriesOptions[`format_${fieldName}`] = {
        section: "Series",
        type: "string",
        display: "select",
        label: `Format`,
        values: [
          { "Default Formatting": "" },
          { "British Pounds (0) — £1,235": "gbp_0" },
          { "British Pounds (2) — £1,234.57": "gbp_2" },
          { "Decimals (0) — 1,235": "dec_0" },
          { "Decimals (1) — 1,234.6": "dec_1" },
          { "Decimals (2) — 1,234.57": "dec_2" },
          { "Decimals (3) — 1,234.567": "dec_3" },
          { "Decimals (4) — 1,234.5668": "dec_4" },
          { "Euros (0) — €1,235": "eur_0" },
          { "Euros (2) — €1,234.57": "eur_2" },
          { "ID — 1235": "id" },
          { "Percent (0) — 123,457%": "pct_0" },
          { "Percent (1) — 123,456.7%": "pct_1" },
          { "Percent (2) — 123,456.68%": "pct_2" },
          { "Percent (3) — 123,456.679%": "pct_3" },
          { "Percent (4) — 123,456.6789%": "pct_4" },
          { "U.S. Dollars (0) — $1,235": "usd_0" },
          { "U.S. Dollars (2) — $1,234.57": "usd_2" }
        ],
        default: "",
        hidden: isHidden,
        order: seriesOrder++
      };
    });

    const formattingOptions = {
      headerFontSize: {
        section: "Formatting",
        type: "number",
        label: "Header Font Size",
        display_size: "half",
        default: 12,
        order: 1
      },
      rowFontSize: {
        section: "Formatting",
        type: "number",
        label: "Row Font Size",
        display_size: "half",
        default: 12,
        order: 2
      },
      headerFontColor: {
        section: "Formatting",
        type: "string",
        display: "color",
        label: "Header Font Color",
        display_size: "half",
        default: "#555555",
        order: 3
      },
      headerBgColor: {
        section: "Formatting",
        type: "string",
        display: "color",
        label: "Header Background Color",
        display_size: "half",
        default: "#f6f8fa",
        order: 4
      },
      headerAlign: {
        section: "Formatting",
        type: "string",
        display: "select",
        label: "Header Text Alignment",
        values: [
          { "Default": "" },
          { "Left": "left" },
          { "Center": "center" },
          { "Right": "right" }
        ],
        default: "",
        order: 5
      },
      subtotalFontColor: {
        section: "Formatting",
        type: "string",
        display: "color",
        label: "Subtotal Font Color",
        display_size: "half",
        default: "#333333",
        order: 6
      },
      subtotalBgColor: {
        section: "Formatting",
        type: "string",
        display: "color",
        label: "Subtotal Background",
        display_size: "half",
        default: "#f1f5f9",
        order: 7
      },
      level2SubtotalBgColor: {
        section: "Formatting",
        type: "string",
        display: "color",
        label: "Level 2 Subtotal Background",
        display_size: "half",
        default: "#f8fafc",
        order: 8,
        hidden: !hasMiddleLevel
      },
      rowBgColor: {
        section: "Formatting",
        type: "string",
        display: "color",
        label: "Row Background",
        display_size: "half",
        default: "#ffffff",
        order: 9
      },
      borderColor: {
        section: "Formatting",
        type: "string",
        display: "color",
        label: "Border Color",
        display_size: "half",
        default: "#e0e0e0",
        order: 10
      }
    };

    // Conditional Formatting: 5 rule slots with progressive reveal and progressive field dropdowns
    const isCfMasterEnabled = config.enable_cf === true;
    const cfOptions = {
      enable_cf: {
        section: "Formatting",
        type: "boolean",
        label: "Enable Conditional Formatting",
        default: false,
        order: 11
      }
    };

    const maxFieldsPerRule = Math.max(metrics.length, 5);
    const staleCfConfigUpdates = {};

    const cfPresetDefaults = [
      { op: "gt", val: 0, bg: "#dcfce7", font: "#009900", useBg: false, useFont: true }, // Rule 1: Green text (> 0)
      { op: "lt", val: 0, bg: "#fee2e2", font: "#990000", useBg: false, useFont: true }, // Rule 2: Red text (< 0)
      { op: "gt", val: 0, bg: "#fef3c7", font: "#92400e", useBg: true, useFont: true }, // Rule 3: Amber
      { op: "gt", val: 0, bg: "#e0f2fe", font: "#0369a1", useBg: true, useFont: true }, // Rule 4: Blue
      { op: "gt", val: 0, bg: "#f3e8ff", font: "#6b21a8", useBg: true, useFont: true }  // Rule 5: Purple
    ];

    let cfOrder = 12;
    let prevRuleActive = isCfMasterEnabled;

    for (let i = 1; i <= 5; i++) {
      const isRuleActive = config[`cf_active_${i}`] === true;
      const isRuleVisible = prevRuleActive;
      const isDetailsVisible = isRuleVisible && isRuleActive;
      const preset = cfPresetDefaults[i - 1];

      cfOptions[`cf_active_${i}`] = {
        section: "Formatting",
        type: "boolean",
        label: `Enable Rule ${i}`,
        default: false,
        hidden: !isRuleVisible,
        order: cfOrder++
      };

      // Collect valid selected field names sequentially.
      // Once any slot is empty, subsequent slots are considered empty.
      const activeFieldsInRule = [];
      for (let f = 1; f <= maxFieldsPerRule; f++) {
        const rawVal = config[`cf_field_${i}_${f}`] || (f === 1 ? config[`cf_field_${i}`] : "");
        if (rawVal && metrics.some(m => m.name === rawVal)) {
          activeFieldsInRule.push(rawVal);
        } else {
          break; // Stop at first empty or invalid slot
        }
      }

      // Purge any stale values in slots that should no longer be visible
      for (let f = activeFieldsInRule.length + 2; f <= maxFieldsPerRule; f++) {
        if (config[`cf_field_${i}_${f}`]) {
          staleCfConfigUpdates[`cf_field_${i}_${f}`] = "";
        }
      }

      // Render progressive field dropdowns:
      // Slots 1..activeFieldsInRule.length are visible and hold selections.
      // Exactly ONE additional slot is shown as "↳ Add Another Field" (if remaining unselected metrics exist).
      // All subsequent slots are hidden.
      for (let f = 1; f <= maxFieldsPerRule; f++) {
        const isSlotVisible = isDetailsVisible && (f <= activeFieldsInRule.length + 1) && (f <= metrics.length);

        // Filter options for slot f: exclude metrics selected in other slots of this rule
        const otherSelectedMetrics = new Set(
          activeFieldsInRule.filter((_, idx) => idx !== f - 1)
        );

        const slotMetricOptions = [
          { "(None)": "" },
          ...metrics
            .filter(m => !otherSelectedMetrics.has(m.name))
            .map(field => {
              const fieldLabel = field.label_short || field.label || field.name;
              return { [fieldLabel]: field.name };
            })
        ];

        cfOptions[`cf_field_${i}_${f}`] = {
          section: "Formatting",
          type: "string",
          display: "select",
          label: f === 1 ? `Rule ${i} Field` : `↳ Add Another Field`,
          values: slotMetricOptions,
          default: f === 1 ? (config[`cf_field_${i}`] || "") : "",
          hidden: !isSlotVisible,
          order: cfOrder++
        };
      }

      cfOptions[`cf_operator_${i}`] = {
        section: "Formatting",
        type: "string",
        display: "select",
        label: `Rule ${i} Condition`,
        values: [
          { "Greater than (>)": "gt" },
          { "Less than (<)": "lt" },
          { "Greater than or equal (>=)": "gte" },
          { "Less than or equal (<=)": "lte" },
          { "Equal to (==)": "eq" },
          { "Not equal to (!=)": "neq" },
          { "Between [min, max]": "between" }
        ],
        default: preset.op,
        display_size: "half",
        hidden: !isDetailsVisible,
        order: cfOrder++
      };

      cfOptions[`cf_value_${i}`] = {
        section: "Formatting",
        type: "number",
        label: `Rule ${i} Value`,
        default: preset.val,
        display_size: "half",
        hidden: !isDetailsVisible,
        order: cfOrder++
      };

      const isBetween = (config[`cf_operator_${i}`] || preset.op) === "between";
      cfOptions[`cf_value_max_${i}`] = {
        section: "Formatting",
        type: "number",
        label: `Rule ${i} Max Value`,
        default: 100,
        display_size: "half",
        hidden: !isDetailsVisible || !isBetween,
        order: cfOrder++
      };

      const hasBg = config[`cf_use_bg_${i}`] ?? preset.useBg;
      const hasFont = config[`cf_use_font_${i}`] ?? preset.useFont;

      cfOptions[`cf_use_bg_${i}`] = {
        section: "Formatting",
        type: "boolean",
        label: `Rule ${i} Color Background`,
        default: preset.useBg,
        display_size: "half",
        hidden: !isDetailsVisible,
        order: cfOrder++
      };

      cfOptions[`cf_bg_${i}`] = {
        section: "Formatting",
        type: "string",
        display: "color",
        label: `Rule ${i} Background`,
        default: preset.bg,
        display_size: "half",
        hidden: !isDetailsVisible || !hasBg,
        order: cfOrder++
      };

      cfOptions[`cf_use_font_${i}`] = {
        section: "Formatting",
        type: "boolean",
        label: `Rule ${i} Color Text`,
        default: preset.useFont,
        display_size: "half",
        hidden: !isDetailsVisible,
        order: cfOrder++
      };

      cfOptions[`cf_font_${i}`] = {
        section: "Formatting",
        type: "string",
        display: "color",
        label: `Rule ${i} Text Color`,
        default: preset.font,
        display_size: "half",
        hidden: !isDetailsVisible || !hasFont,
        order: cfOrder++
      };

      cfOptions[`cf_subtotals_${i}`] = {
        section: "Formatting",
        type: "boolean",
        label: `Rule ${i} Subtotals`,
        default: true,
        display_size: "half",
        hidden: !isDetailsVisible,
        order: cfOrder++
      };

      cfOptions[`cf_totals_${i}`] = {
        section: "Formatting",
        type: "boolean",
        label: `Rule ${i} Grand Total`,
        default: true,
        display_size: "half",
        hidden: !isDetailsVisible,
        order: cfOrder++
      };

      // Looker's panel ignores `default` on options registered here: unset booleans
      // draw as off and unset colors draw empty. Write the preset once so the panel
      // matches what the table renders. Values the user has already set are kept.
      if (isRuleVisible) {
        const ruleSeed = {
          [`cf_operator_${i}`]: preset.op,
          [`cf_value_${i}`]: preset.val,
          [`cf_use_bg_${i}`]: preset.useBg,
          [`cf_bg_${i}`]: preset.bg,
          [`cf_use_font_${i}`]: preset.useFont,
          [`cf_font_${i}`]: preset.font,
          [`cf_subtotals_${i}`]: true,
          [`cf_totals_${i}`]: true
        };
        for (const [key, value] of Object.entries(ruleSeed)) {
          if (config[key] === undefined || config[key] === null || config[key] === "") {
            staleCfConfigUpdates[key] = value;
          }
        }
      }

      prevRuleActive = isDetailsVisible;
    }

    const options = {
      ...plotOptions,
      ...internalOptions,
      ...seriesOptions,
      ...formattingOptions,
      ...cfOptions
    };

    if (Object.keys(staleCfConfigUpdates).length > 0) {
      this.trigger('updateConfig', [staleCfConfigUpdates]);
    }

    this.trigger('registerOptions', options);

    // Looker draws an unset boolean as off, even when default is true.
    // Subtotals already render in that unset state. Writing true makes the
    // Plot checkbox match the table. An explicit off stays off.
    const unsetBooleanDefaults = {};
    if (config.showSubtotals === undefined) unsetBooleanDefaults.showSubtotals = true;
    if (config.freezeCurrentRow === undefined) unsetBooleanDefaults.freezeCurrentRow = true;
    if (hasMiddleLevel && config.showLevel2Subtotals === undefined) unsetBooleanDefaults.showLevel2Subtotals = true;
    if (Object.keys(unsetBooleanDefaults).length > 0) {
      this.trigger("updateConfig", [unsetBooleanDefaults]);
    }

    // 2. DATA PROCESSING & GROUPING
    // levelKeys[0] is Level 1. Every level except the last is a group with a subtotal row;
    // the last level is the detail row.
    const levelKeys = dimensions.map(d => d.name);
    const groupDepth = levelCount - 1;
    const detailKey = levelKeys[levelCount - 1];
    const isLevelHidden = (level) => config[`hideLevel${level}`] === true;

    const dimValue = (row, key) => {
      const cell = row && row[key];
      return cell && cell.value !== undefined ? cell.value : null;
    };
    // JSON keeps null apart from the text "null", and ["a","b"] apart from ["a,b"].
    const pathKeyOf = (values) => JSON.stringify(values);

    // Looker returns one subtotal list per grouping depth ("1", "2"). Each row names the
    // dimensions it groups by in $$$__grouping__$$$, so its length is the depth.
    const nativeSubtotalsByDepth = {};
    Object.entries(queryResponse.subtotals_data || {}).forEach(([depthKey, subRows]) => {
      if (!Array.isArray(subRows)) return;
      subRows.forEach(subRow => {
        if (!subRow) return;
        const grouping = subRow["$$$__grouping__$$$"];
        const depth = Array.isArray(grouping) ? grouping.length : Number(depthKey);
        if (!(depth >= 1 && depth <= groupDepth)) return;
        const path = levelKeys.slice(0, depth).map(key => dimValue(subRow, key));
        if (!nativeSubtotalsByDepth[depth]) nativeSubtotalsByDepth[depth] = {};
        nativeSubtotalsByDepth[depth][pathKeyOf(path)] = subRow;
      });
    });
    const nativeSubtotalRow = (node) => (nativeSubtotalsByDepth[node.depth] || {})[node.pathKey] || null;

    // Pivoted measure cells are maps of pivot key → cell. Unpivoted cells are the cell itself.
    const measureCell = (source, column) => {
      if (!source || !column) return null;
      const fieldCell = source[column.measureName];
      if (!fieldCell) return null;
      if (!column.pivoted) return fieldCell;
      return fieldCell[column.pivotKey] || null;
    };

    const zeroTotals = () => {
      const totals = {};
      orderedColumns.forEach(column => { totals[column.id] = 0; });
      return totals;
    };

    const dimLabelHtml = (cell) => (
      cell && cell.value !== null && cell.value !== undefined
        ? LookerCharts.Utils.htmlForCell(cell)
        : null
    );

    // Level 1 keys keep the original plain-string format so collapses saved before
    // Level 3 existed still apply. Deeper groups use the JSON path.
    const groupKey = (raw) => (raw === null || raw === undefined ? "null" : String(raw));

    // Tree: root → Level 1 nodes → (Level 2 nodes →) detail rows.
    const root = { depth: 0, path: [], children: [], childIndex: {}, rows: [] };
    const grandTotals = zeroTotals();

    data.forEach(row => {
      let parent = root;
      const path = [];
      const ancestors = [];
      for (let depth = 1; depth <= groupDepth; depth++) {
        const key = levelKeys[depth - 1];
        path.push(dimValue(row, key));
        const pathKey = pathKeyOf(path);
        let node = parent.childIndex[pathKey];
        if (!node) {
          node = {
            depth,
            path: [...path],
            pathKey,
            rawValue: path[depth - 1],
            renderedLabel: dimLabelHtml(row[key]),
            collapseKey: depth === 1 ? groupKey(path[0]) : pathKey,
            parent: parent.depth === 0 ? null : parent,
            totals: zeroTotals(),
            children: [],
            childIndex: {},
            rows: []
          };
          parent.childIndex[pathKey] = node;
          parent.children.push(node);
        }
        ancestors.push(node);
        parent = node;
      }

      // Aggregate fallback totals per display column (one pivot value, when pivoted).
      orderedColumns.forEach(column => {
        const cell = measureCell(row, column);
        const val = (cell && cell.value) || 0;
        ancestors.forEach(node => { node.totals[column.id] += val; });
        grandTotals[column.id] += val;
      });

      parent.rows.push(row);
    });

    // Sort groups by the active column (first column by default, or the header the user last clicked).
    // Prefer Looker's native subtotal for that column; otherwise fall back to the JS-aggregated sum.
    const getGroupSortValue = (node) => {
      const nativeCell = measureCell(nativeSubtotalRow(node), sortColumn);
      if (nativeCell && typeof nativeCell.value === 'number') {
        return nativeCell.value;
      }
      return node.totals[sortColumn.id] || 0;
    };

    const compareNumeric = (a, b) => {
      const cmp = a - b;
      return sortDirection === "asc" ? cmp : -cmp;
    };

    const escapeAttr = (value) => String(value)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");

    const collapsedSet = new Set(expandAllGroups ? [] : readCollapsedKeys(config.collapsedGroups));

    // A hidden column has no header to show or change its alphabetical sort, so it is ignored.
    const activeSecondarySort = isLevelHidden(levelCount) ? "" : secondarySortDirection;
    const activeMiddleSort = hasMiddleLevel && !isLevelHidden(2) ? middleSortDirection : "";

    const asText = (value) => (value === null || value === undefined ? null : String(value));
    // numeric: "Item 2" before "Item 10". sensitivity "base": case and accents do not split ties.
    const labelCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    const compareText = (textA, textB, direction) => {
      // Nulls stay last in both directions.
      if (textA === null || textB === null) {
        return (textA === null) - (textB === null);
      }
      const cmp = labelCollator.compare(textA, textB);
      return direction === "asc" ? cmp : -cmp;
    };

    // Level 1 groups always follow the active metric. Level 2 groups follow it too,
    // unless the Level 2 header was shift-clicked. Detail rows follow the metric,
    // or the detail header's alphabetical sort.
    const sortNode = (node) => {
      if (node.depth < groupDepth) {
        const childDepth = node.depth + 1;
        node.children.sort((a, b) => {
          if (childDepth === 2 && activeMiddleSort) {
            return compareText(asText(a.rawValue), asText(b.rawValue), activeMiddleSort);
          }
          return compareNumeric(getGroupSortValue(a), getGroupSortValue(b));
        });
        node.children.forEach(sortNode);
        return;
      }
      node.rows.sort((a, b) => {
        if (activeSecondarySort) {
          return compareText(asText(dimValue(a, detailKey)), asText(dimValue(b, detailKey)), activeSecondarySort);
        }
        const cellA = measureCell(a, sortColumn);
        const cellB = measureCell(b, sortColumn);
        const valA = (cellA && cellA.value) || 0;
        const valB = (cellB && cellB.value) || 0;
        return compareNumeric(valA, valB);
      });
    };
    sortNode(root);

    // 3. APPLY CONFIG & RENDER
    const headerBg = config.headerBgColor || "#f6f8fa";
    const headerFont = config.headerFontColor || "#555555";
    const headerFontSize = Number(config.headerFontSize) > 0 ? Number(config.headerFontSize) : 12;
    const rowFontSize = Number(config.rowFontSize) > 0 ? Number(config.rowFontSize) : 12;
    const asColor = (value, fallback) => (
      typeof value === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim())
        ? value.trim()
        : fallback
    );
    const subtotalFont = asColor(config.subtotalFontColor, "#333333");
    const subtotalBg = asColor(config.subtotalBgColor, "#f1f5f9");
    const level2SubtotalBg = asColor(config.level2SubtotalBgColor, "#f8fafc");
    const rowBg = asColor(config.rowBgColor, "#ffffff");
    const borderColor = asColor(config.borderColor, "#e0e0e0");

    const parseNumericValue = (val) => {
      if (val === null || val === undefined || val === "") return null;
      if (typeof val === "number") return isNaN(val) ? null : val;
      if (typeof val === "string") {
        const cleaned = val.replace(/[$,€£%\s]/g, "");
        const parsed = parseFloat(cleaned);
        return isNaN(parsed) ? null : parsed;
      }
      return null;
    };

    // Helper to evaluate if a cell matches any conditional formatting rule
    const getCfStyle = (fieldName, kind, rawValue) => {
      if (!isCfMasterEnabled) return null;
      const numVal = parseNumericValue(rawValue);
      if (numVal === null) return null;

      for (let i = 1; i <= 5; i++) {
        // Rule must be enabled
        const isRuleActive = config[`cf_active_${i}`] === true || Boolean(config[`cf_field_${i}`]);
        if (!isRuleActive) continue;

        // Check if the current field is selected under Rule i across sequential active dropdown slots
        const activeFieldsForRule = [];
        for (let f = 1; f <= maxFieldsPerRule; f++) {
          const val = config[`cf_field_${i}_${f}`] || (f === 1 ? config[`cf_field_${i}`] : "");
          if (val && metrics.some(m => m.name === val)) {
            activeFieldsForRule.push(val);
          } else {
            break; // Stop at first empty slot so trailing/stale slots are never applied
          }
        }

        const isLegacyChecked = config[`cf_field_${i}_${fieldName}`] === true;
        const isFieldChecked = activeFieldsForRule.includes(fieldName) || isLegacyChecked;
        if (!isFieldChecked) continue;

        // Check subtotals / grand totals toggles (both default to true)
        if (kind === "subtotal" && config[`cf_subtotals_${i}`] === false) continue;
        if (kind === "total" && config[`cf_totals_${i}`] === false) continue;

        const defaultPreset = cfPresetDefaults[i - 1];
        const op = config[`cf_operator_${i}`] || defaultPreset.op;
        const thresh = typeof config[`cf_value_${i}`] === "number" ? config[`cf_value_${i}`] : (parseFloat(config[`cf_value_${i}`]) || 0);
        const threshMax = typeof config[`cf_value_max_${i}`] === "number" ? config[`cf_value_max_${i}`] : (parseFloat(config[`cf_value_max_${i}`]) || 0);

        let matches = false;
        switch (op) {
          case "gt":
            matches = numVal > thresh;
            break;
          case "gte":
            matches = numVal >= thresh;
            break;
          case "lt":
            matches = numVal < thresh;
            break;
          case "lte":
            matches = numVal <= thresh;
            break;
          case "eq":
            matches = Math.abs(numVal - thresh) < 1e-9;
            break;
          case "neq":
            matches = Math.abs(numVal - thresh) >= 1e-9;
            break;
          case "between": {
            const min = Math.min(thresh, threshMax);
            const max = Math.max(thresh, threshMax);
            matches = numVal >= min && numVal <= max;
            break;
          }
          default:
            matches = false;
        }

        if (matches) {
          const useBg = config[`cf_use_bg_${i}`] ?? defaultPreset.useBg;
          const useFont = config[`cf_use_font_${i}`] ?? defaultPreset.useFont;

          // null = "don't override", so the cell falls back to the series/row colors
          let bg = null;
          if (useBg) {
            bg = asColor(config[`cf_bg_${i}`], defaultPreset.bg);
          }

          let font = null;
          if (useFont) {
            font = asColor(config[`cf_font_${i}`], defaultPreset.font);
          }

          return { bg, font };
        }
      }

      return null;
    };

    // Series color wins on that column. An empty series color falls through to the row color.
    // Conditional formatting (if matched) takes highest precedence for that cell.
    const cellColorCss = (fieldName, kind, rawValue, depth = 1) => {
      const rowFont = kind === "subtotal" ? subtotalFont : "#333333";
      const groupBg = depth === 2 ? level2SubtotalBg : subtotalBg;
      const rowBackground = kind === "subtotal" ? groupBg : (kind === "total" ? "#e2e8f0" : rowBg);

      const cf = getCfStyle(fieldName, kind, rawValue);

      const font = (cf && cf.font !== null) ? cf.font : (asColor(config[`fontColor_${fieldName}`], "") || rowFont);
      const bg = (cf && cf.bg !== null) ? cf.bg : (asColor(config[`bgColor_${fieldName}`], "") || rowBackground);
      return `color: ${font}; background-color: ${bg};${borderMatchCss(fieldName)}`;
    };

    // Only the series background is used. An empty background leaves the global border in place.
    const borderMatchCss = (fieldName) => {
      if (!config[`matchBorder_${fieldName}`]) return "";
      const seriesBg = asColor(config[`bgColor_${fieldName}`], "");
      return seriesBg ? ` border-color: ${seriesBg};` : "";
    };
    const textStyleClass = (fieldName) => [
      config[`bold_${fieldName}`] ? "is-bold" : "",
      config[`italic_${fieldName}`] ? "is-italic" : "",
      config[`underline_${fieldName}`] ? "is-underline" : ""
    ].filter(Boolean).join(" ");

    // Helper functions to retrieve per-column styling declarations
    const getColumnInlineCss = (fieldName, defaultAlign = '') => {
      const styles = [];
      const width = config[`width_${fieldName}`];
      const align = config[`align_${fieldName}`] || defaultAlign;

      if (width && !isNaN(width)) {
        styles.push(`width: ${width}px`, `min-width: ${width}px`, `max-width: ${width}px`);
      }
      if (align) {
        styles.push(`text-align: ${align}`);
      }
      return styles.join('; ');
    };

    const getHeaderInlineCss = (fieldName, defaultAlign = '') => {
      const styles = [];
      const width = config[`width_${fieldName}`];
      const align = config.headerAlign || config[`align_${fieldName}`] || defaultAlign;

      if (width && !isNaN(width)) {
        styles.push(`width: ${width}px`, `min-width: ${width}px`, `max-width: ${width}px`);
      }
      if (align) {
        styles.push(`text-align: ${align}`);
      }
      return styles.join('; ');
    };

    // Helper function to format numbers using JavaScript's native Intl.NumberFormat
    const formatNumberWithPreset = (num, preset) => {
      if (typeof num !== 'number' || isNaN(num)) return num;

      switch (preset) {
        case 'gbp_0':
          return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(num);
        case 'gbp_2':
          return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
        case 'dec_0':
          return new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(num);
        case 'dec_1':
          return new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(num);
        case 'dec_2':
          return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
        case 'dec_3':
          return new Intl.NumberFormat('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(num);
        case 'dec_4':
          return new Intl.NumberFormat('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(num);
        case 'eur_0':
          return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(num);
        case 'eur_2':
          return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
        case 'id':
          return String(Math.round(num));
        case 'pct_0':
          return new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(num);
        case 'pct_1':
          return new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(num);
        case 'pct_2':
          return new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
        case 'pct_3':
          return new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(num);
        case 'pct_4':
          return new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(num);
        case 'usd_0':
          return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(num);
        case 'usd_2':
          return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
        default:
          return null;
      }
    };

    // Symbol for null values (Looker standard crossed zero: ∅)
    const NULL_DISPLAY = emptyMarker;

    // Helper to detect if a field in LookML represents a percentage
    const isFieldLookMLPercent = (fieldName) => {
      const fieldDef = allFields.find(f => f.name === fieldName);
      if (!fieldDef) return false;
      const fmt = (fieldDef.value_format || '').toLowerCase();
      return fmt.includes('%') || (fieldDef.type && fieldDef.type.includes('percent'));
    };

    // Helper function to format numbers based on series config
    const formatMetricValue = (val, fieldName, fallbackCell) => {
      if (val === null || val === undefined) return NULL_DISPLAY;

      const formatPreset = config[`format_${fieldName}`];

      // If a non-default preset is selected, format the numeric value
      if (formatPreset) {
        const num = typeof val === 'number' ? val : parseFloat(val);
        const formatted = formatNumberWithPreset(num, formatPreset);
        if (formatted !== null) return formatted;
      }

      // If default formatting is selected, use Looker's LookML cell rendering for raw rows or native subtotal cells
      if (fallbackCell) {
        if (typeof fallbackCell.rendered === 'string' && fallbackCell.rendered !== '') {
          return fallbackCell.rendered;
        }
        if (LookerCharts.Utils.htmlForCell) {
          const rendered = LookerCharts.Utils.htmlForCell(fallbackCell);
          if (rendered !== null && rendered !== undefined && rendered !== '') {
            return rendered;
          }
        }
      }

      // Default fallback for subtotals and grand totals:
      // If the field is a percentage in LookML, format as a percent even on Default
      if (typeof val === 'number' && isFieldLookMLPercent(fieldName)) {
        return new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(val);
      }

      // Default fallback for subtotals and grand totals (standard numeric)
      return typeof val === 'number'
        ? val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : String(val);
    };

    const measureLabel = (column) => (
      config[`label_${column.measureName}`] || column.measure.label_short || column.measure.label
    );

    // Default pivot header is two rows. The Plot toggle folds that into one label.
    // A single pivot_index column does not belong under a pivot group, so it does not
    // by itself turn the two-row header on.
    const pivotInBrackets = hasPivots && config.pivotInMeasureLabel === true;
    const hasRepeatedPivotColumns = orderedColumns.some(column => column.pivoted);
    const useGroupedHeader = hasRepeatedPivotColumns && !pivotInBrackets;
    const headerRowSpan = useGroupedHeader ? ` rowspan="2"` : "";

    // Display-only flags: the dimension still drives grouping, just not a rendered column.
    const allLevels = levelKeys.map((_, i) => i + 1);
    const visibleLevels = allLevels.filter(level => !isLevelHidden(level));

    // Each depth's label row is sticky at its own offset. A later row paints over the
    // earlier one when it reaches the top, so only the current group's row shows.
    const freezeCurrentRow = config.freezeCurrentRow !== false;
    const frozenClass = freezeCurrentRow ? " is-frozen" : "";
    const frozenL2Class = freezeCurrentRow ? " is-frozen-l2" : "";

    const showSubtotals = config.showSubtotals !== false;
    const showsSubtotalRow = (depth) => showSubtotals && (depth === 1 || config.showLevel2Subtotals !== false);

    // Freezing a level also freezes every visible level before it, like freeze panes in a spreadsheet.
    const deepestFrozenLevel = visibleLevels.reduce(
      (deepest, level) => (config[`freezeLevel${level}`] === true ? level : deepest),
      0
    );
    const frozenLevels = visibleLevels.filter(level => level <= deepestFrozenLevel);
    const freezeColClass = (level) => {
      if (!frozenLevels.includes(level)) return "";
      const isEdge = level === frozenLevels[frozenLevels.length - 1];
      return `freeze-col freeze-l${level}${isEdge ? " freeze-edge" : ""}`;
    };
    const classAttr = (...names) => {
      const joined = names.filter(Boolean).join(" ");
      return joined ? ` class="${joined}"` : "";
    };

    const columnHeader = (column) => {
      const name = measureLabel(column);
      if (!pivotInBrackets || !column.pivoted) return name;
      return `${name} (${column.pivotLabel})`;
    };

    const metricHeaderHtml = (column, spansBothRows) => {
      const customLabel = columnHeader(column);
      const colCss = getHeaderInlineCss(column.measureName, 'right');
      const isActiveSort = column.id === sortMetric;
      const sortArrow = isActiveSort
        ? `<span class="sort-indicator" aria-hidden="true" style="color: ${headerFont};">${sortDirection === "asc" ? "▲" : "▼"}</span>`
        : "";
      const sortTitle = isActiveSort
        ? `Sorted ${sortDirection === "asc" ? "ascending" : "descending"}. Click to reverse.`
        : "Click to sort by this metric";
      const rowSpanAttr = spansBothRows ? ` rowspan="2"` : "";
      return `<th${rowSpanAttr} class="number draggable-metric" draggable="true" data-field-name="${escapeAttr(column.id)}" title="${escapeAttr(sortTitle)}" style="background-color: ${headerBg}; color: ${headerFont}; font-size: ${headerFontSize}px; ${borderMatchCss(column.measureName)} ${colCss}"><span class="drag-handle" title="Drag to reorder column">⠿</span>${customLabel}${sortArrow}</th>`;
    };

    let html = `<table class="custom-table"><thead><tr>`;
    
    // Render Dimension Headers
    // Level 1 has no alphabetical sort. The detail column sorts rows within the deepest
    // subtotal; with 3 levels the Level 2 column sorts its groups within each Level 1 subtotal.
    const alphaSortHeader = (level) => {
      if (level === levelCount) {
        return { className: "detail-sort-header", direction: activeSecondarySort, scope: "within each subtotal" };
      }
      if (level === 2) {
        return { className: "middle-sort-header", direction: activeMiddleSort, scope: "within each Level 1 subtotal" };
      }
      return null;
    };

    visibleLevels.forEach(level => {
      const field = dimensions[level - 1];
      const customLabel = config[`label_${field.name}`] || field.label_short || field.label;
      const colCss = getHeaderInlineCss(field.name, 'left');
      const headerStyle = `background-color: ${headerBg}; color: ${headerFont}; font-size: ${headerFontSize}px; ${borderMatchCss(field.name)} ${colCss}`;
      const alpha = alphaSortHeader(level);
      if (!alpha) {
        html += `<th${headerRowSpan}${classAttr(freezeColClass(level))} style="${headerStyle}">${customLabel}</th>`;
        return;
      }
      const arrow = alpha.direction
        ? `<span class="sort-indicator is-secondary" aria-hidden="true" style="color: ${headerFont};">${alpha.direction === "asc" ? "▲" : "▼"}</span>`
        : "";
      const title = alpha.direction
        ? `Sorted ${alpha.direction === "asc" ? "A to Z" : "Z to A"} ${alpha.scope}. Shift+click to reverse.`
        : `Shift+click to sort alphabetically ${alpha.scope}`;
      html += `<th${headerRowSpan}${classAttr(alpha.className, freezeColClass(level))} data-alpha-sort="${alpha.direction}" title="${escapeAttr(title)}" style="${headerStyle}">${customLabel}${arrow}</th>`;
    });

    if (useGroupedHeader) {
      const groupAlign = config.headerAlign || "center";
      let index = 0;
      while (index < orderedColumns.length) {
        const column = orderedColumns[index];
        // A pivot_index column spans both header rows. It is not inside a pivot group.
        if (!column.pivoted) {
          html += metricHeaderHtml(column, true);
          index += 1;
          continue;
        }
        let span = 1;
        while (
          index + span < orderedColumns.length &&
          orderedColumns[index + span].pivoted &&
          orderedColumns[index + span].pivotKey === column.pivotKey
        ) {
          span += 1;
        }
        html += `<th class="pivot-group" colspan="${span}" style="background-color: ${headerBg}; color: ${headerFont}; font-size: ${headerFontSize}px; text-align: ${groupAlign};">${column.pivotLabel}</th>`;
        index += span;
      }
      html += `</tr><tr>`;
    }

    // Render metric headers. Each one is a display column, so a pivot can be sorted and dragged on its own.
    orderedColumns.forEach(column => {
      if (useGroupedHeader && !column.pivoted) return;
      html += metricHeaderHtml(column, false);
    });
    
    html += `</tr></thead><tbody style="font-size: ${rowFontSize}px;">`;

    // Render Rows & Subtotals
    const levelCss = levelKeys.map(key => getColumnInlineCss(key));
    const levelTextStyle = levelKeys.map(key => textStyleClass(key));

    const labelCell = (level, kind, depth, content, extraClass = "") => {
      if (isLevelHidden(level)) return "";
      const key = levelKeys[level - 1];
      return `<td${classAttr(extraClass, levelTextStyle[level - 1], freezeColClass(level))} style="${cellColorCss(key, kind, undefined, depth)} ${levelCss[level - 1]}">${content}</td>`;
    };

    // A collapse only counts while its subtotal row is shown, since that row is the only way to undo it.
    const isCollapsedNode = (node) => showsSubtotalRow(node.depth) && collapsedSet.has(node.collapseKey);

    // Hide Repeated Labels: an ancestor label shows only on the first rendered row of that ancestor's group.
    let previousPath = null;
    const startsGroupAt = (path, depth) => (
      previousPath === null || pathKeyOf(previousPath.slice(0, depth)) !== pathKeyOf(path.slice(0, depth))
    );
    const ancestorLabelCell = (ancestor, path, kind, depth) => {
      const label = ancestor.renderedLabel || NULL_DISPLAY;
      if (!config.hideRepeatedLabels) return labelCell(ancestor.depth, kind, depth, label, "indent-cell");
      return labelCell(ancestor.depth, kind, depth, startsGroupAt(path, ancestor.depth) ? label : "");
    };

    const renderSubtotalRow = (node, chain, l1Index) => {
      const collapsed = collapsedSet.has(node.collapseKey);
      const hiddenByAncestor = chain.slice(0, -1).some(isCollapsedNode);
      const chevron = collapsed ? "&#9654;" : "&#9660;";
      const collapseTitle = collapsed ? "Click to expand" : "Click to collapse";
      const rowFrozen = node.depth === 1 ? frozenClass : frozenL2Class;

      html += `<tr class="subtotal-row depth-${node.depth}${collapsed ? " is-collapsed" : ""}${hiddenByAncestor ? " is-hidden" : ""}${rowFrozen}" data-group-key="${escapeAttr(node.collapseKey)}" data-l1-index="${l1Index}" title="${collapseTitle}">`;

      allLevels.forEach(level => {
        if (level < node.depth) {
          html += ancestorLabelCell(chain[level - 1], node.path, "subtotal", node.depth);
        } else if (level === node.depth) {
          html += labelCell(level, "subtotal", node.depth, `<span class="collapse-chevron" aria-hidden="true">${chevron}</span>${node.renderedLabel || NULL_DISPLAY}`);
        } else if (level === node.depth + 1) {
          html += labelCell(level, "subtotal", node.depth, `<em>Subtotal</em>`);
        } else {
          html += labelCell(level, "subtotal", node.depth, "");
        }
      });

      const nativeSubRow = nativeSubtotalRow(node);
      orderedColumns.forEach(column => {
        const styleM = textStyleClass(column.measureName);
        const mCss = getColumnInlineCss(column.measureName, 'right');

        // Check if Looker provided a pre-calculated subtotal cell for this pivot column
        const nativeCell = nativeSubRow ? measureCell(nativeSubRow, column) : null;
        let formattedSubtotal;
        let rawSubtotalVal;

        if (nativeCell && (nativeCell.value !== undefined || nativeCell.rendered !== undefined)) {
          // Use native cell with formatMetricValue (handles custom formatting overrides or defaults to native rendered)
          formattedSubtotal = formatMetricValue(nativeCell.value, column.measureName, nativeCell);
          rawSubtotalVal = nativeCell.value;
        } else {
          // Fallback to JS-aggregated total
          formattedSubtotal = formatMetricValue(node.totals[column.id], column.measureName);
          rawSubtotalVal = node.totals[column.id];
        }

        html += `<td class="number ${styleM}" style="${cellColorCss(column.measureName, "subtotal", rawSubtotalVal, node.depth)} ${mCss}">${formattedSubtotal}</td>`;
      });
      html += `</tr>`;
      previousPath = node.path;
    };

    const renderDetailRow = (row, leaf, chain) => {
      const hiddenByAncestor = chain.some(isCollapsedNode);
      // With subtotals off, the first row of each Level 1 group is the one that carries its value.
      const detailFrozenClass = !showSubtotals && startsGroupAt(leaf.path, 1) ? frozenClass : "";

      html += `<tr class="group-detail${hiddenByAncestor ? " is-hidden" : ""}${detailFrozenClass}" data-group-key="${escapeAttr(leaf.collapseKey)}">`;
      chain.forEach(ancestor => {
        html += ancestorLabelCell(ancestor, leaf.path, "detail", 1);
      });
      html += labelCell(levelCount, "detail", 1, dimLabelHtml(row[detailKey]) || NULL_DISPLAY);

      orderedColumns.forEach(column => {
        const mCell = measureCell(row, column);
        const rawRowVal = mCell ? mCell.value : undefined;
        const mFormatted = formatMetricValue(rawRowVal, column.measureName, mCell);
        const styleM = textStyleClass(column.measureName);
        const mCss = getColumnInlineCss(column.measureName, 'right');
        html += `<td class="number ${styleM}" style="${cellColorCss(column.measureName, "detail", rawRowVal)} ${mCss}">${mFormatted}</td>`;
      });
      html += `</tr>`;
      previousPath = leaf.path;
    };

    const renderNode = (node, parentChain, l1Index) => {
      const chain = [...parentChain, node];
      if (showsSubtotalRow(node.depth)) renderSubtotalRow(node, chain, l1Index);
      if (node.depth < groupDepth) {
        node.children.forEach(child => renderNode(child, chain, l1Index));
      } else {
        node.rows.forEach(row => renderDetailRow(row, node, chain));
      }
    };
    root.children.forEach((node, l1Index) => renderNode(node, [], l1Index));

    // Render Grand Total dynamically (only if totals exist in query and showTotal is not disabled)
    if (hasTotals && config.showTotal !== false) {
      // colspan="0" is invalid, so with every dimension hidden there is no label cell.
      let totalLabelCells = "";
      if (visibleLevels.length > 1 && frozenLevels.length > 0) {
        // A cell spanning several columns would stick as one block, wider than the frozen area.
        totalLabelCells = visibleLevels
          .map((level, i) => `<td${classAttr(freezeColClass(level))}>${i === 0 ? "Total" : ""}</td>`)
          .join("");
      } else if (visibleLevels.length > 0) {
        totalLabelCells = `<td colspan="${visibleLevels.length}"${classAttr(freezeColClass(visibleLevels[0]))}>Total</td>`;
      }
      html += `<tr class="grand-total-row">${totalLabelCells}`;
      const nativeTotalsData = queryResponse.totals_data || {};

      orderedColumns.forEach(column => {
        const mCss = getColumnInlineCss(column.measureName, 'right');
        const nativeTotalCell = measureCell(nativeTotalsData, column);
        let formattedTotal;
        let rawTotalVal;

        if (nativeTotalCell && (nativeTotalCell.value !== undefined || nativeTotalCell.rendered !== undefined)) {
          formattedTotal = formatMetricValue(nativeTotalCell.value, column.measureName, nativeTotalCell);
          rawTotalVal = nativeTotalCell.value;
        } else {
          formattedTotal = formatMetricValue(grandTotals[column.id], column.measureName);
          rawTotalVal = grandTotals[column.id];
        }

        html += `<td class="number ${textStyleClass(column.measureName)}" style="${cellColorCss(column.measureName, "total", rawTotalVal)} ${mCss}">${formattedTotal}</td>`;
      });
      html += `</tr>`;
    }

    html += `</tbody></table>`;

    const container = document.getElementById("table-container");
    container.style.setProperty("--table-border", borderColor);
    container.innerHTML = html;

    if (useGroupedHeader) {
      const firstHeaderRow = container.querySelector("thead tr");
      if (firstHeaderRow) {
        container.style.setProperty("--pivot-header-offset", firstHeaderRow.getBoundingClientRect().height + "px");
      }
    }

    let frozenRowTop = 0;
    if (freezeCurrentRow) {
      const thead = container.querySelector("thead");
      if (thead) {
        frozenRowTop = thead.getBoundingClientRect().height;
        container.style.setProperty("--frozen-row-top", frozenRowTop + "px");
      }
      // Level 2 subtotal rows stick just below the Level 1 subtotal row.
      const firstL1Row = container.querySelector("tr.subtotal-row.depth-1");
      if (firstL1Row) {
        container.style.setProperty("--frozen-l1-row-height", firstL1Row.getBoundingClientRect().height + "px");
      }
    }

    // A stuck Level 2 row stays at its offset until a later sticky row paints over it.
    // When the next Level 1 group shows no Level 2 rows (collapsed), the previous group's
    // Level 2 row would stay visible under it, so rows from earlier groups are hidden.
    if (this._stickyScrollHandler) {
      container.removeEventListener("scroll", this._stickyScrollHandler);
      this._stickyScrollHandler = null;
    }
    const l2StickyRows = freezeCurrentRow ? [...container.querySelectorAll("tr.subtotal-row.depth-2")] : [];
    if (l2StickyRows.length > 0) {
      const l1Rows = [...container.querySelectorAll("tr.subtotal-row.depth-1")];
      let currentL1Index = null;
      let frameRequested = false;
      const updateStaleRows = () => {
        frameRequested = false;
        const containerRect = container.getBoundingClientRect();
        // A tile rendered while hidden (e.g. another dashboard tab) has no layout yet.
        if (containerRect.height === 0) return;
        // The row box keeps its place in the flow; only its cells stick.
        const stickyLine = containerRect.top + frozenRowTop + 1;
        let index = -1;
        for (const tr of l1Rows) {
          if (tr.getBoundingClientRect().top > stickyLine) break;
          index = Number(tr.getAttribute("data-l1-index"));
        }
        if (index === currentL1Index) return;
        currentL1Index = index;
        l2StickyRows.forEach(tr => {
          tr.classList.toggle("is-stale", Number(tr.getAttribute("data-l1-index")) < index);
        });
      };
      this._stickyScrollHandler = () => {
        if (frameRequested) return;
        frameRequested = true;
        requestAnimationFrame(updateStaleRows);
      };
      container.addEventListener("scroll", this._stickyScrollHandler, { passive: true });
      updateStaleRows();
    }

    // The previous render's header cells are gone, so its observer has nothing left to watch.
    if (this._freezeObserver) {
      this._freezeObserver.disconnect();
      this._freezeObserver = null;
    }
    // Each frozen column starts where the frozen columns before it end.
    [2, 3].forEach(level => container.style.removeProperty(`--freeze-l${level}-left`));
    const frozenHeaders = frozenLevels
      .map(level => ({ level, th: container.querySelector(`thead th.freeze-l${level}`) }))
      .filter(entry => entry.th);
    if (frozenHeaders.length > 1) {
      const setFreezeOffsets = () => {
        let left = 0;
        frozenHeaders.forEach(({ level, th }) => {
          if (level > 1) container.style.setProperty(`--freeze-l${level}-left`, left + "px");
          left += th.getBoundingClientRect().width;
        });
      };
      setFreezeOffsets();
      if (typeof ResizeObserver !== "undefined") {
        this._freezeObserver = new ResizeObserver(setFreezeOffsets);
        frozenHeaders.forEach(({ th }) => this._freezeObserver.observe(th));
      }
    }

    // A click updates viz config the same way a sort click does.
    // Looker writes that config only when someone saves the Look or dashboard.
    // A dashboard viewer cannot save, so their clicks last until reload.
    const self = this;
    container.querySelectorAll("tr.subtotal-row").forEach(tr => {
      tr.addEventListener("click", (e) => {
        if (e.target.closest("a")) return;

        const key = tr.getAttribute("data-group-key");
        if (key === null) return;

        const next = new Set(collapsedSet);
        if (next.has(key)) next.delete(key);
        else next.add(key);

        self.trigger("updateConfig", [
          { collapsedGroups: JSON.stringify([...next].sort()) }
        ]);
      });
    });

    const alphaSortConfigKeys = {
      "detail-sort-header": "secondarySortDirection",
      "middle-sort-header": "middleSortDirection"
    };
    Object.entries(alphaSortConfigKeys).forEach(([className, configKey]) => {
      const header = container.querySelector(`th.${className}`);
      if (!header) return;
      // Shift+mousedown would otherwise extend the browser's text selection.
      header.addEventListener("mousedown", (e) => {
        if (e.shiftKey) e.preventDefault();
      });
      header.addEventListener("click", (e) => {
        if (!e.shiftKey) return;
        const current = header.getAttribute("data-alpha-sort");
        self.trigger("updateConfig", [
          { [configKey]: current === "asc" ? "desc" : "asc" }
        ]);
      });
    });

    // 4. ATTACH DRAG & DROP REORDERING LISTENERS
    const metricHeaders = container.querySelectorAll("th.draggable-metric");
    let draggedField = null;
    let suppressHeaderClick = false;

    metricHeaders.forEach(th => {
      th.addEventListener("dragstart", (e) => {
        suppressHeaderClick = true;
        draggedField = th.getAttribute("data-field-name");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", draggedField);
        th.classList.add("is-dragging");
      });

      th.addEventListener("dragend", () => {
        draggedField = null;
        metricHeaders.forEach(header => {
          header.classList.remove("is-dragging", "drop-left", "drop-right");
        });
        // click fires after dragend in some browsers; ignore that leftover click
        setTimeout(() => {
          suppressHeaderClick = false;
        }, 0);
      });

      th.addEventListener("click", (e) => {
        if (suppressHeaderClick) return;
        if (e.target.closest(".drag-handle")) return;

        const fieldName = th.getAttribute("data-field-name");
        if (!fieldName || !defaultColumnIds.includes(fieldName)) return;

        // New column starts descending (same as the default first-metric sort).
        // Clicking the already-active header flips direction, like a normal Looker table.
        const nextDirection = (fieldName === sortMetric && sortDirection === "desc")
          ? "asc"
          : "desc";

        self.trigger("updateConfig", [
          {
            sortMetric: fieldName,
            sortDirection: nextDirection,
            secondarySortDirection: "",
            middleSortDirection: ""
          }
        ]);
      });

      th.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";

        const targetField = th.getAttribute("data-field-name");
        if (!draggedField || targetField === draggedField) {
          th.classList.remove("drop-left", "drop-right");
          return;
        }

        const rect = th.getBoundingClientRect();
        const midpoint = rect.left + rect.width / 2;
        if (e.clientX < midpoint) {
          th.classList.add("drop-left");
          th.classList.remove("drop-right");
        } else {
          th.classList.add("drop-right");
          th.classList.remove("drop-left");
        }
      });

      th.addEventListener("dragleave", () => {
        th.classList.remove("drop-left", "drop-right");
      });

      th.addEventListener("drop", (e) => {
        e.preventDefault();
        const targetField = th.getAttribute("data-field-name");
        th.classList.remove("drop-left", "drop-right");

        if (!draggedField || targetField === draggedField) return;

        const rect = th.getBoundingClientRect();
        const midpoint = rect.left + rect.width / 2;
        const insertBefore = e.clientX < midpoint;

        // Clone current order and reorder elements
        const currentOrder = [...orderedColumnIds];
        const draggedIndex = currentOrder.indexOf(draggedField);
        if (draggedIndex === -1) return;

        currentOrder.splice(draggedIndex, 1);

        let targetIndex = currentOrder.indexOf(targetField);
        if (targetIndex === -1) return;

        if (!insertBefore) {
          targetIndex += 1;
        }

        currentOrder.splice(targetIndex, 0, draggedField);

        // Update Looker config to persist order across dashboard tiles and explore reloads.
        // We serialize the array as JSON string for robust cross-browser and URL serialization in Looker.
        self.trigger("updateConfig", [
          {
            metricColumnOrder: JSON.stringify(currentOrder),
            resetColumnOrder: false
          }
        ]);
      });
    });

    done();
  }
});

