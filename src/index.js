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
          border-bottom: 1px solid #e0e0e0;
          white-space: nowrap;
        }
        .custom-table th {
          font-weight: 600;
          position: sticky;
          top: 0;
          z-index: 10;
          border-bottom: 2px solid #d0d7de;
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
          color: #1a73e8;
          font-size: 9px;
          vertical-align: middle;
        }
        .custom-table .number {
          text-align: right;
        }
        .custom-table .subtotal-row {
          background-color: #f1f5f9;
          font-weight: 600;
          border-top: 1px solid #cbd5e1;
          border-bottom: 2px solid #cbd5e1;
          cursor: pointer;
        }
        .collapse-chevron {
          display: inline-block;
          width: 12px;
          margin-right: 6px;
          color: #64748b;
          font-size: 9px;
        }
        .custom-table tr.group-detail.is-collapsed {
          display: none;
        }
        .custom-table .grand-total-row {
          background-color: #e2e8f0;
          font-weight: bold;
          border-top: 2px solid #64748b;
        }
        .custom-table .indent-cell {
          padding-left: 24px;
          color: #64748b;
        }
        .is-bold {
          font-weight: bold !important;
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

    if (dimensions.length < 2 || metrics.length < 1) {
      this.addError({
        title: "Insufficient Fields",
        message: "This visualization requires at least 2 dimensions (Level 1, Level 2) and 1 measure."
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

    // Column Order Reconciliation:
    // Determine the active display order of metrics. Reconciles saved custom order from config
    // with current query metrics so added/removed fields are handled gracefully.
    const queryMetricNames = metrics.map(m => m.name);
    let savedOrder = config.metricColumnOrder;
    if (typeof savedOrder === "string") {
      try {
        savedOrder = JSON.parse(savedOrder);
      } catch (e) {
        savedOrder = savedOrder.split(",").map(s => s.trim()).filter(Boolean);
      }
    }

    let orderedMetricNames = [];
    if (Array.isArray(savedOrder)) {
      orderedMetricNames = savedOrder.filter(name => queryMetricNames.includes(name));
    }
    queryMetricNames.forEach(name => {
      if (!orderedMetricNames.includes(name)) {
        orderedMetricNames.push(name);
      }
    });

    const hasCustomOrder = orderedMetricNames.some((name, idx) => name !== queryMetricNames[idx]);

    // Handle Reset action from the Plot tab toggle
    if (config.resetColumnOrder) {
      this.trigger('updateConfig', [
        {
          metricColumnOrder: "",
          resetColumnOrder: false
        }
      ]);
      orderedMetricNames = [...queryMetricNames];
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

    const metricMap = {};
    metrics.forEach(m => { metricMap[m.name] = m; });
    const orderedMetrics = orderedMetricNames.map(name => metricMap[name]).filter(Boolean);

    // Sort field: first query metric by default. A header click can override this
    // after the query has already run; we only re-sort the existing result.
    const defaultSortMetric = queryMetricNames[0];
    const sortMetric = (typeof config.sortMetric === "string" && queryMetricNames.includes(config.sortMetric))
      ? config.sortMetric
      : defaultSortMetric;
    const sortDirection = config.sortDirection === "asc" ? "asc" : "desc";

    // 1. DYNAMIC OPTIONS CONFIGURATION
    const plotOptions = {
      showSubtotals: { section: "Plot", type: "boolean", label: "Show Subtotals", default: true, order: 1 },
      hideRepeatedLabels: { section: "Plot", type: "boolean", label: "Hide Repeated Labels", default: false, order: 2 }
    };

    // Only expose the "Show Totals" toggle if totals were computed in the query
    if (hasTotals) {
      plotOptions.showTotal = { section: "Plot", type: "boolean", label: "Show Totals", default: true, order: 3 };
    }

    // Expose "Revert Original Column Order" toggle in Plot tab when columns are reordered
    plotOptions.resetColumnOrder = {
      section: "Plot",
      type: "boolean",
      label: "Revert Original Column Order",
      default: false,
      order: 4,
      hidden: !hasCustomOrder
    };

    plotOptions.resetCollapsedGroups = {
      section: "Plot",
      type: "boolean",
      label: "Revert to Uncollapsed View",
      default: false,
      order: 5,
      hidden: !hasCollapsedGroups
    };

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
        label: `Bold`,
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
      headerFontColor: { section: "Formatting", type: "string", display: "color", label: "Header Font Color", default: "#555555", order: 1 },
      headerBgColor: { section: "Formatting", type: "string", display: "color", label: "Header Background Color", default: "#f6f8fa", order: 2 },
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
        order: 3
      }
    };

    const options = {
      ...plotOptions,
      ...internalOptions,
      ...seriesOptions,
      ...formattingOptions
    };

    this.trigger('registerOptions', options);

    // 2. DATA PROCESSING & GROUPING
    const level1Key = dimensions[0].name;
    const level2Key = dimensions[1].name;

    // Map native Looker subtotals from queryResponse.subtotals_data by Level 1 value
    // Looker provides subtotals_data keyed by grouping depth (e.g. "1" for Level 1)
    const nativeSubtotalsMap = {};
    const subtotalsArray = queryResponse.subtotals_data && (
      queryResponse.subtotals_data["1"] ||
      queryResponse.subtotals_data[1] ||
      Object.values(queryResponse.subtotals_data)[0]
    );

    if (Array.isArray(subtotalsArray)) {
      subtotalsArray.forEach(subRow => {
        const keyCell = subRow[level1Key];
        const keyValue = keyCell ? keyCell.value : null;
        if (keyValue !== undefined && keyValue !== null) {
          nativeSubtotalsMap[keyValue] = subRow;
        }
      });
    }

    const groups = {};
    const grandTotals = {};
    metrics.forEach(m => grandTotals[m.name] = 0);

    data.forEach(row => {
      const cat1ValHtml = LookerCharts.Utils.htmlForCell(row[level1Key]);
      const cat1Raw = row[level1Key].value;

      if (!groups[cat1Raw]) {
        groups[cat1Raw] = {
          rawKey: cat1Raw,
          renderedLabel: cat1ValHtml,
          totals: {},
          rows: []
        };
        metrics.forEach(m => groups[cat1Raw].totals[m.name] = 0);
      }

      // Aggregate fallback totals
      metrics.forEach(m => {
        const val = (row[m.name] && row[m.name].value) || 0;
        groups[cat1Raw].totals[m.name] += val;
        grandTotals[m.name] += val;
      });

      groups[cat1Raw].rows.push(row);
    });

    // Sort groups by the active metric (first query metric by default, or the header the user last clicked).
    // Prefer Looker's native subtotal for that metric; otherwise fall back to the JS-aggregated sum.
    const getGroupSortValue = (group) => {
      const nativeRow = nativeSubtotalsMap[group.rawKey];
      if (nativeRow && nativeRow[sortMetric] && typeof nativeRow[sortMetric].value === 'number') {
        return nativeRow[sortMetric].value;
      }
      return group.totals[sortMetric] || 0;
    };

    const compareNumeric = (a, b) => {
      const cmp = a - b;
      return sortDirection === "asc" ? cmp : -cmp;
    };

    const sortedGroups = Object.values(groups).sort((a, b) => compareNumeric(getGroupSortValue(a), getGroupSortValue(b)));

    // Level 1 values become object keys above, so the stored key is that string.
    const groupKey = (raw) => (raw === null || raw === undefined ? "null" : String(raw));
    const escapeAttr = (value) => String(value)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");

    const collapsedSet = new Set(expandAllGroups ? [] : readCollapsedKeys(config.collapsedGroups));

    // Sort rows within groups by the same active metric and direction
    sortedGroups.forEach(group => {
      group.rows.sort((a, b) => {
        const valA = (a[sortMetric] && a[sortMetric].value) || 0;
        const valB = (b[sortMetric] && b[sortMetric].value) || 0;
        return compareNumeric(valA, valB);
      });
    });

    // 3. APPLY CONFIG & RENDER
    const headerBg = config.headerBgColor || "#f6f8fa";
    const headerFont = config.headerFontColor || "#555555";
    const boldL1 = config[`bold_${level1Key}`] ? 'is-bold' : '';
    const boldL2 = config[`bold_${level2Key}`] ? 'is-bold' : '';

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
    const NULL_DISPLAY = `<span style="color: #94a3b8;">&#8709;</span>`;

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

    let html = `<table class="custom-table"><thead><tr>`;
    
    // Render Dimension Headers
    [dimensions[0], dimensions[1]].forEach(field => {
      const customLabel = config[`label_${field.name}`] || field.label_short || field.label;
      const colCss = getHeaderInlineCss(field.name, 'left');
      html += `<th style="background-color: ${headerBg}; color: ${headerFont}; ${colCss}">${customLabel}</th>`;
    });

    // Render Metric Headers dynamically with drag-and-drop support
    orderedMetrics.forEach(field => {
      const customLabel = config[`label_${field.name}`] || field.label_short || field.label;
      const colCss = getHeaderInlineCss(field.name, 'right');
      const isActiveSort = field.name === sortMetric;
      const sortArrow = isActiveSort
        ? `<span class="sort-indicator" aria-hidden="true">${sortDirection === "asc" ? "▲" : "▼"}</span>`
        : "";
      const sortTitle = isActiveSort
        ? `Sorted ${sortDirection === "asc" ? "ascending" : "descending"}. Click to reverse.`
        : "Click to sort by this metric";
      html += `<th class="number draggable-metric" draggable="true" data-field-name="${field.name}" title="${sortTitle}" style="background-color: ${headerBg}; color: ${headerFont}; ${colCss}"><span class="drag-handle" title="Drag to reorder column">⠿</span>${customLabel}${sortArrow}</th>`;
    });
    
    html += `</tr></thead><tbody>`;

    // Render Rows & Subtotals
    sortedGroups.forEach(group => {
      if (config.showSubtotals !== false) {
        const l1Css = getColumnInlineCss(level1Key);
        const l2Css = getColumnInlineCss(level2Key);
        const nativeSubRow = nativeSubtotalsMap[group.rawKey];

        const collapsed = collapsedSet.has(groupKey(group.rawKey));
        const chevron = collapsed ? "&#9654;" : "&#9660;";
        const collapseTitle = collapsed ? "Click to expand" : "Click to collapse";

        html += `<tr class="subtotal-row${collapsed ? " is-collapsed" : ""}" data-group-key="${escapeAttr(groupKey(group.rawKey))}" title="${collapseTitle}">
                   <td class="${boldL1}" style="${l1Css}"><span class="collapse-chevron" aria-hidden="true">${chevron}</span>${group.renderedLabel || NULL_DISPLAY}</td>
                   <td style="${l2Css}"><em>Subtotal</em></td>`;
        
        orderedMetrics.forEach(m => {
          const boldM = config[`bold_${m.name}`] ? 'is-bold' : '';
          const mCss = getColumnInlineCss(m.name, 'right');

          // Check if Looker provided a pre-calculated subtotal cell
          const nativeCell = nativeSubRow ? nativeSubRow[m.name] : null;
          let formattedSubtotal;

          if (nativeCell && (nativeCell.value !== undefined || nativeCell.rendered !== undefined)) {
            // Use native cell with formatMetricValue (handles custom formatting overrides or defaults to native rendered)
            formattedSubtotal = formatMetricValue(nativeCell.value, m.name, nativeCell);
          } else {
            // Fallback to JS-aggregated total
            formattedSubtotal = formatMetricValue(group.totals[m.name], m.name);
          }

          html += `<td class="number ${boldM}" style="${mCss}">${formattedSubtotal}</td>`;
        });
        html += `</tr>`;
      }

      group.rows.forEach((row, rowIndex) => {
        const cat2Cell = row[level2Key];
        const cat2ValHtml = (cat2Cell && cat2Cell.value !== null && cat2Cell.value !== undefined)
          ? LookerCharts.Utils.htmlForCell(cat2Cell)
          : NULL_DISPLAY;
        const l1Css = getColumnInlineCss(level1Key);
        const l2Css = getColumnInlineCss(level2Key);

        const isSubtotalsVisible = config.showSubtotals !== false;
        let l1Content = '';
        let l1IndentClass = '';

        if (!config.hideRepeatedLabels) {
          l1Content = group.renderedLabel || NULL_DISPLAY;
          l1IndentClass = 'indent-cell';
        } else if (!isSubtotalsVisible && rowIndex === 0) {
          l1Content = group.renderedLabel || NULL_DISPLAY;
        }

        const l1ClassNames = [l1IndentClass, boldL1].filter(Boolean).join(' ');
        const l1ClassAttr = l1ClassNames ? ` class="${l1ClassNames}"` : '';
        
        const detailCollapsed = isSubtotalsVisible && collapsedSet.has(groupKey(group.rawKey));

        html += `<tr class="group-detail${detailCollapsed ? " is-collapsed" : ""}" data-group-key="${escapeAttr(groupKey(group.rawKey))}">
                   <td${l1ClassAttr} style="${l1Css}">${l1Content}</td>
                   <td class="${boldL2}" style="${l2Css}">${cat2ValHtml}</td>`;
        
        orderedMetrics.forEach(m => {
          const mFormatted = formatMetricValue(row[m.name].value, m.name, row[m.name]);
          const boldM = config[`bold_${m.name}`] ? 'is-bold' : '';
          const mCss = getColumnInlineCss(m.name, 'right');
          html += `<td class="number ${boldM}" style="${mCss}">${mFormatted}</td>`;
        });
        html += `</tr>`;
      });
    });

    // Render Grand Total dynamically (only if totals exist in query and showTotal is not disabled)
    if (hasTotals && config.showTotal !== false) {
      html += `<tr class="grand-total-row"><td colspan="2">Total</td>`;
      const nativeTotalsData = queryResponse.totals_data || {};

      orderedMetrics.forEach(m => {
        const mCss = getColumnInlineCss(m.name, 'right');
        const nativeTotalCell = nativeTotalsData[m.name];
        let formattedTotal;

        if (nativeTotalCell && (nativeTotalCell.value !== undefined || nativeTotalCell.rendered !== undefined)) {
          formattedTotal = formatMetricValue(nativeTotalCell.value, m.name, nativeTotalCell);
        } else {
          formattedTotal = formatMetricValue(grandTotals[m.name], m.name);
        }

        html += `<td class="number" style="${mCss}">${formattedTotal}</td>`;
      });
      html += `</tr>`;
    }

    html += `</tbody></table>`;

    const container = document.getElementById("table-container");
    container.innerHTML = html;

    // A click updates viz config the same way a sort click does.
    // Looker writes that config only when someone saves the Look or dashboard.
    // A dashboard viewer cannot save, so their clicks last until reload.
    const self = this;
    container.querySelectorAll("tr.subtotal-row").forEach(tr => {
      tr.addEventListener("click", () => {
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
        if (!fieldName || !queryMetricNames.includes(fieldName)) return;

        // New column starts descending (same as the default first-metric sort).
        // Clicking the already-active header flips direction, like a normal Looker table.
        const nextDirection = (fieldName === sortMetric && sortDirection === "desc")
          ? "asc"
          : "desc";

        self.trigger("updateConfig", [
          {
            sortMetric: fieldName,
            sortDirection: nextDirection
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
        const currentOrder = [...orderedMetricNames];
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

