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
          z-index: 10;
          border-bottom: 2px solid var(--table-border, #d0d7de);
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
        .is-italic {
          font-style: italic !important;
        }
        .is-underline {
          text-decoration: underline !important;
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
      rowBgColor: {
        section: "Formatting",
        type: "string",
        display: "color",
        label: "Row Background",
        display_size: "half",
        default: "#ffffff",
        order: 8
      },
      borderColor: {
        section: "Formatting",
        type: "string",
        display: "color",
        label: "Border Color",
        display_size: "half",
        default: "#e0e0e0",
        order: 9
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
        order: 10
      }
    };

    const maxFieldsPerRule = Math.max(metrics.length, 5);
    const staleCfConfigUpdates = {};

    const cfPresetDefaults = [
      { op: "gt", val: 0, bg: "#dcfce7", font: "#166534" }, // Rule 1: Green (> 0)
      { op: "lt", val: 0, bg: "#fee2e2", font: "#991b1b" }, // Rule 2: Red (< 0)
      { op: "gt", val: 0, bg: "#fef3c7", font: "#92400e" }, // Rule 3: Amber
      { op: "gt", val: 0, bg: "#e0f2fe", font: "#0369a1" }, // Rule 4: Blue
      { op: "gt", val: 0, bg: "#f3e8ff", font: "#6b21a8" }  // Rule 5: Purple
    ];

    let cfOrder = 11;
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

      const hasBg = config[`cf_use_bg_${i}`] !== false;
      const hasFont = config[`cf_use_font_${i}`] !== false;

      cfOptions[`cf_use_bg_${i}`] = {
        section: "Formatting",
        type: "boolean",
        label: `Rule ${i} Color Background`,
        default: true,
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
        default: true,
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
    const headerFontSize = Number(config.headerFontSize) > 0 ? Number(config.headerFontSize) : 12;
    const rowFontSize = Number(config.rowFontSize) > 0 ? Number(config.rowFontSize) : 12;
    const asColor = (value, fallback) => (
      typeof value === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim())
        ? value.trim()
        : fallback
    );
    const subtotalFont = asColor(config.subtotalFontColor, "#333333");
    const subtotalBg = asColor(config.subtotalBgColor, "#f1f5f9");
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
          const useBg = config[`cf_use_bg_${i}`] !== false;
          const useFont = config[`cf_use_font_${i}`] !== false;

          let bg = null;
          if (useBg) {
            const rawBg = config[`cf_bg_${i}`];
            bg = rawBg === "" ? "" : asColor(rawBg, defaultPreset.bg);
          }

          let font = null;
          if (useFont) {
            const rawFont = config[`cf_font_${i}`];
            font = rawFont === "" ? "" : asColor(rawFont, defaultPreset.font);
          }

          return { bg, font };
        }
      }

      return null;
    };

    // Series color wins on that column. An empty series color falls through to the row color.
    // Conditional formatting (if matched) takes highest precedence for that cell.
    const cellColorCss = (fieldName, kind, rawValue) => {
      const rowFont = kind === "subtotal" ? subtotalFont : "#333333";
      const rowBackground = kind === "subtotal" ? subtotalBg : (kind === "total" ? "#e2e8f0" : rowBg);

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
    const styleL1 = textStyleClass(level1Key);
    const styleL2 = textStyleClass(level2Key);

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
      html += `<th style="background-color: ${headerBg}; color: ${headerFont}; font-size: ${headerFontSize}px; ${borderMatchCss(field.name)} ${colCss}">${customLabel}</th>`;
    });

    // Render Metric Headers dynamically with drag-and-drop support
    orderedMetrics.forEach(field => {
      const customLabel = config[`label_${field.name}`] || field.label_short || field.label;
      const colCss = getHeaderInlineCss(field.name, 'right');
      const isActiveSort = field.name === sortMetric;
      const sortArrow = isActiveSort
        ? `<span class="sort-indicator" aria-hidden="true" style="color: ${headerFont};">${sortDirection === "asc" ? "▲" : "▼"}</span>`
        : "";
      const sortTitle = isActiveSort
        ? `Sorted ${sortDirection === "asc" ? "ascending" : "descending"}. Click to reverse.`
        : "Click to sort by this metric";
      html += `<th class="number draggable-metric" draggable="true" data-field-name="${field.name}" title="${sortTitle}" style="background-color: ${headerBg}; color: ${headerFont}; font-size: ${headerFontSize}px; ${borderMatchCss(field.name)} ${colCss}"><span class="drag-handle" title="Drag to reorder column">⠿</span>${customLabel}${sortArrow}</th>`;
    });
    
    html += `</tr></thead><tbody style="font-size: ${rowFontSize}px;">`;

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
                   <td class="${styleL1}" style="${cellColorCss(level1Key, "subtotal")} ${l1Css}"><span class="collapse-chevron" aria-hidden="true">${chevron}</span>${group.renderedLabel || NULL_DISPLAY}</td>
                   <td class="${styleL2}" style="${cellColorCss(level2Key, "subtotal")} ${l2Css}"><em>Subtotal</em></td>`;
        
        orderedMetrics.forEach(m => {
          const styleM = textStyleClass(m.name);
          const mCss = getColumnInlineCss(m.name, 'right');

          // Check if Looker provided a pre-calculated subtotal cell
          const nativeCell = nativeSubRow ? nativeSubRow[m.name] : null;
          let formattedSubtotal;
          let rawSubtotalVal;

          if (nativeCell && (nativeCell.value !== undefined || nativeCell.rendered !== undefined)) {
            // Use native cell with formatMetricValue (handles custom formatting overrides or defaults to native rendered)
            formattedSubtotal = formatMetricValue(nativeCell.value, m.name, nativeCell);
            rawSubtotalVal = nativeCell.value;
          } else {
            // Fallback to JS-aggregated total
            formattedSubtotal = formatMetricValue(group.totals[m.name], m.name);
            rawSubtotalVal = group.totals[m.name];
          }

          html += `<td class="number ${styleM}" style="${cellColorCss(m.name, "subtotal", rawSubtotalVal)} ${mCss}">${formattedSubtotal}</td>`;
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

        const l1ClassNames = [l1IndentClass, styleL1].filter(Boolean).join(' ');
        const l1ClassAttr = l1ClassNames ? ` class="${l1ClassNames}"` : '';
        
        const detailCollapsed = isSubtotalsVisible && collapsedSet.has(groupKey(group.rawKey));

        html += `<tr class="group-detail${detailCollapsed ? " is-collapsed" : ""}" data-group-key="${escapeAttr(groupKey(group.rawKey))}">
                   <td${l1ClassAttr} style="${cellColorCss(level1Key, "detail")} ${l1Css}">${l1Content}</td>
                   <td class="${styleL2}" style="${cellColorCss(level2Key, "detail")} ${l2Css}">${cat2ValHtml}</td>`;
        
        orderedMetrics.forEach(m => {
          const mCell = row[m.name];
          const rawRowVal = mCell ? mCell.value : undefined;
          const mFormatted = formatMetricValue(rawRowVal, m.name, mCell);
          const styleM = textStyleClass(m.name);
          const mCss = getColumnInlineCss(m.name, 'right');
          html += `<td class="number ${styleM}" style="${cellColorCss(m.name, "detail", rawRowVal)} ${mCss}">${mFormatted}</td>`;
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
        let rawTotalVal;

        if (nativeTotalCell && (nativeTotalCell.value !== undefined || nativeTotalCell.rendered !== undefined)) {
          formattedTotal = formatMetricValue(nativeTotalCell.value, m.name, nativeTotalCell);
          rawTotalVal = nativeTotalCell.value;
        } else {
          formattedTotal = formatMetricValue(grandTotals[m.name], m.name);
          rawTotalVal = grandTotals[m.name];
        }

        html += `<td class="number ${textStyleClass(m.name)}" style="${cellColorCss(m.name, "total", rawTotalVal)} ${mCss}">${formattedTotal}</td>`;
      });
      html += `</tr>`;
    }

    html += `</tbody></table>`;

    const container = document.getElementById("table-container");
    container.style.setProperty("--table-border", borderColor);
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

