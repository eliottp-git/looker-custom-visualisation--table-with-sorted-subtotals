# Table with Subtotal Sorting

A custom Looker visualization that looks like the built-in table, and sorts groups by their metric subtotals.

Looker’s **Table (Next)** can show subtotals, but it cannot sort by them. With subtotals on, the only available order is alphabetical on the group dimension, then the metric. That ranking is almost never what a business question asks for — “which category is largest?” — and the metric sort still applies to detail rows, not to the groups themselves.

This visualization groups the query, computes subtotals, then sorts:

1. Top-level groups by the subtotal of the metric (largest first).
2. With a third dimension, the Level 2 groups inside each top-level group by their own subtotal.
3. Detail rows inside each group by that same metric, or alphabetically by the detail dimension.

Column order, labels, widths, alignment, bold, and number formats stay under your control, the same way they do on the native table.

## Features

**Sorting and totals**

- Groups sorted by a metric subtotal, largest first by default
- Click a metric header to sort by that column; click again to reverse the direction. The choice is saved with the tile
- Shift+click the detail header (the last dimension) to sort detail rows alphabetically within each subtotal (Shift+click again to reverse). With three dimensions, Shift+click the Level 2 header to sort the Level 2 groups alphabetically within each Level 1 subtotal. A lighter arrow marks either sort; a metric header click clears both
- Two or three dimensions. With three, Level 1 and Level 2 both get subtotal rows, and Level 3 is the detail row. Both subtotal levels use Looker's own subtotal values
- Subtotal rows, on by default and toggleable from the Plot tab. With three dimensions, **Show Level 2 Subtotals** turns off only the Level 2 rows; the Level 2 groups are still sorted by their subtotal
- Grand total row, toggleable (shown when the query returns totals)
- Click a subtotal row to collapse or expand that group, at either level. Collapsing Level 1 hides its Level 2 groups; expanding it again restores each Level 2 group as it was. Collapsed groups are saved with the tile, with a one-click revert to the fully expanded view
- Hide repeated labels on the grouping dimensions
- **Freeze Current Row** (Plot tab, on by default): while scrolling, the current group's subtotal row stays pinned under the header until the next group's subtotal row takes its place. With three dimensions, the current Level 2 subtotal row is pinned just below the Level 1 row. With subtotals off, the first row of each group is pinned instead

**Columns**

- Drag-and-drop reordering of metric columns
- Column order saved with the tile (survives reloads and dashboard saves)
- One-click revert to the original column order and sorting
- Pivots become real columns: one per measure and pivot value, for however many values the query returns. A table calculation that uses `pivot_index`, `pivot_offset`, `pivot_row`, or `pivot_where` stays a single column after those pivot columns
- With a pivot, the header has two rows: the pivot value on top (Current, Previous, or whatever came back) and the measure name underneath. **Pivot Value in Brackets** in the Plot tab folds that into one label, such as `Gross Sales (Current)`
- Hiding works like the native table. **Hide from visualization** on a measure removes it from every pivot. Hiding a pivot value (such as Previous), or a single measure under one pivot value, removes only those columns, and the pivot header drops with them
- A pivot total column is included when Totals is checked in the Data panel
- Click a pivot column to sort groups by that column's subtotal. Drag to reorder pivot columns. The choice is saved with the tile
- **Freeze Level 1**, **Freeze Level 2**, and (with three dimensions) **Freeze Level 3** (Plot tab, off by default) keep the dimension columns pinned on the left while scrolling sideways. Freezing a level also freezes the visible levels before it, like freeze panes in a spreadsheet. **Hide Level 1/2/3** removes a dimension column from display only. Only measure columns can be dragged, so the dimensions always stay first and freezing never conflicts with column reordering
- Series settings and conditional formatting stay on the measure, so they apply to every pivot column of that measure
- Per-series label, width (px), text alignment, bold, italic, underline, font color, background color, and number format (currencies, decimals, percent, ID)
- Optional border color matched to the series background

**Header and cells**

- Header and row font size
- Header background color, font color, and text alignment
- Subtotal font color and background (with a separate Level 2 subtotal background when there are three dimensions), row background, and border color
- Nulls shown as Looker’s standard empty marker (∅)

**Conditional formatting**

- Up to five rules, revealed one at a time
- Each rule can target one or more measures
- Conditions: greater than, less than, greater or equal, less or equal, equal, not equal, and between
- Optional background and text color, with presets for the first five rules
- Each rule can apply to detail rows, subtotals, and the grand total independently

## Requirements

The Explore needs two or three dimensions (one or two group levels, then the detail) and at least one measure. More than three dimensions shows an error. A pivot is optional. It is not one of those dimensions: Looker keeps the measure and nests each pivot value inside it, and the visualization turns those values into columns. Subtotals and sort order still come from Looker's own subtotal and total cells, so a pivoted percent stays the group's share rather than a sum of row percents.

**Percent of total** measures do not work here. Looker already divides each row by the grand total, so summing those values for a group subtotal does not produce the group’s share of the total. Use a table calculation instead, for example `${measure} / sum(${measure})`, and format that column as a percent. The visualization then subtotals and sorts the calculated values.

## Development

```bash
npm install
npm run start:dev   # https://127.0.0.1:3443
npm run build       # production bundle
```

Point Looker’s custom visualization admin at the dev server (or the built bundle) and select **Table with Sorted Subtotals**.
