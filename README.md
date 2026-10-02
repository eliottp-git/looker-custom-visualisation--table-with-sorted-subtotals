# Table with Subtotal Sorting

A custom Looker visualization that looks like the built-in table, and sorts groups by their metric subtotals.

Looker’s **Table (Next)** can show subtotals, but it cannot sort by them. With subtotals on, the only available order is alphabetical on the group dimension, then the metric. That ranking is almost never what a business question asks for — “which category is largest?” — and the metric sort still applies to detail rows, not to the groups themselves.

This visualization groups the query, computes subtotals, then sorts:

1. Top-level groups by the subtotal of the metric (largest first).
2. Detail rows inside each group by that same metric.

Column order, labels, widths, alignment, bold, and number formats stay under your control, the same way they do on the native table.

## Features

**Sorting and totals**

- Groups sorted by a metric subtotal, largest first by default
- Click a metric header to sort by that column; click again to reverse the direction. The choice is saved with the tile
- Subtotal rows, on by default and toggleable from the Plot tab
- Grand total row, toggleable (shown when the query returns totals)
- Click a subtotal row to collapse or expand that group. Collapsed groups are saved with the tile, with a one-click revert to the fully expanded view
- Hide repeated labels on the grouping dimension

**Columns**

- Drag-and-drop reordering of metric columns
- Column order saved with the tile (survives reloads and dashboard saves)
- One-click revert to the original column order
- Pivots become real columns: one per measure and pivot value, for however many values the query returns. A table calculation that uses `pivot_index`, `pivot_offset`, `pivot_row`, or `pivot_where` stays a single column after those pivot columns
- With a pivot, the header has two rows: the pivot value on top (Current, Previous, or whatever came back) and the measure name underneath. **Pivot Value in Brackets** in the Plot tab folds that into one label, such as `Gross Sales (Current)`
- A pivot total column is included when Totals is checked in the Data panel
- Click a pivot column to sort groups by that column's subtotal. Drag to reorder pivot columns. The choice is saved with the tile
- Series settings and conditional formatting stay on the measure, so they apply to every pivot column of that measure
- Per-series label, width (px), text alignment, bold, italic, underline, font color, background color, and number format (currencies, decimals, percent, ID)
- Optional border color matched to the series background

**Header and cells**

- Header and row font size
- Header background color, font color, and text alignment
- Subtotal font color and background, row background, and border color
- Nulls shown as Looker’s standard empty marker (∅)

**Conditional formatting**

- Up to five rules, revealed one at a time
- Each rule can target one or more measures
- Conditions: greater than, less than, greater or equal, less or equal, equal, not equal, and between
- Optional background and text color, with presets for the first five rules
- Each rule can apply to detail rows, subtotals, and the grand total independently

## Requirements

The Explore needs two dimensions (the group, then the detail) and at least one measure. A pivot is optional. It is not one of those two dimensions: Looker keeps the measure and nests each pivot value inside it, and the visualization turns those values into columns. Subtotals and sort order still come from Looker's own subtotal and total cells, so a pivoted percent stays the group's share rather than a sum of row percents.

**Percent of total** measures do not work here. Looker already divides each row by the grand total, so summing those values for a group subtotal does not produce the group’s share of the total. Use a table calculation instead, for example `${measure} / sum(${measure})`, and format that column as a percent. The visualization then subtotals and sorts the calculated values.

## Development

```bash
npm install
npm run start:dev   # https://127.0.0.1:3443
npm run build       # production bundle
```

Point Looker’s custom visualization admin at the dev server (or the built bundle) and select **Table with Sorted Subtotals**.
