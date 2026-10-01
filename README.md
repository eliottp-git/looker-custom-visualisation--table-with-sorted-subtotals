# Table with Subtotal Sorting

A custom Looker visualization that looks like the built-in table, and sorts groups by their metric subtotals.

Looker’s **Table (Next)** can show subtotals, but it cannot sort by them. With subtotals on, the only available order is alphabetical on the group dimension, then the metric. That ranking is almost never what a business question asks for — “which category is largest?” — and the metric sort still applies to detail rows, not to the groups themselves.

This visualization groups the query, computes subtotals, then sorts:

1. Top-level groups by the subtotal of the metric (largest first).
2. Detail rows inside each group by that same metric.

Column order, labels, widths, alignment, bold, and number formats stay under your control, the same way they do on the native table.

## Features

**Sorting and totals**

- Subtotal rows, toggleable
- Grand total row, toggleable
- Hide repeated labels on the grouping dimension

**Columns**

- Drag-and-drop reordering of metric columns
- Column order saved with the tile (survives reloads and dashboard saves)
- One-click revert to the original column order
- Per-series label, width (px), text alignment, bold, and number format

**Header and cells**

- Header background color, font color, and text alignment
- Nulls shown as Looker’s standard empty marker (∅)

## Requirements

The Explore needs two dimensions (the group, then the detail) and at least one measure. Subtotals and sort order are calculated in the visualization from the query result.

## Development

```bash
npm install
npm run start:dev   # https://127.0.0.1:3443
npm run build       # production bundle
```

Point Looker’s custom visualization admin at the dev server (or the built bundle) and select **Table with Sorted Subtotals**.
