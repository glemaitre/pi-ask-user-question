/**
 * Row-budget windowing shared by the single-select (`WrappingSelect`) and
 * multi-select (`MultiSelectView`) option lists.
 *
 * Lists are windowed by terminal ROWS, not item count: an option whose label
 * and description wrap to five rows costs five rows of budget. When every item
 * fits inside `maxRows` the list renders verbatim (no indicators, no padding).
 * Otherwise the output is exactly `maxRows` rows tall:
 *
 *   row 0            `↑ N more` indicator (blank when nothing is above)
 *   rows 1..maxRows-2 whole items around the focused one, padded with blanks
 *   row maxRows-1    `↓ N more · i/n` indicator
 *
 * The fixed height keeps the dialog footprint stable while the user scrolls,
 * regardless of how unevenly descriptions wrap. The only exception is a
 * focused item taller than the content area (e.g. a long multi-line custom
 * answer in the inline editor): it is always rendered whole and the list grows.
 */

/**
 * Default row budget for an option list. Sized so the pre-windowing footprint
 * (10 options × label + one description row) is preserved; lists that fit are
 * never windowed, so short questionnaires render exactly as before.
 */
export const MAX_LIST_ROWS = 20;

/** Rows reserved for the top and bottom overflow indicators. */
export const LIST_INDICATOR_ROWS = 2;

export interface ListWindow {
	/** First visible item index (inclusive). */
	start: number;
	/** Last visible item index (exclusive). */
	end: number;
	/** True when some items are hidden — indicators + padding apply. */
	windowed: boolean;
	/** Blank rows appended after the visible items so the list fills its budget exactly. */
	padRows: number;
}

/**
 * Pick the whole-item window around `focused` that fits `maxRows`.
 *
 * Grows outward from the focused item, always extending the side that currently
 * holds fewer rows so the focus stays visually centred; when one side runs out
 * of items (or room), the other side absorbs the remaining budget. Pure and
 * width-agnostic — callers pass the per-item row heights for the width they
 * render at, so `render` and `focusedItemRowRange` always agree.
 */
export function computeListWindow(itemHeights: readonly number[], focused: number, maxRows: number): ListWindow {
	const n = itemHeights.length;
	if (n === 0) return { start: 0, end: 0, windowed: false, padRows: 0 };
	const total = itemHeights.reduce((a, b) => a + b, 0);
	if (total <= maxRows || n === 1) return { start: 0, end: n, windowed: false, padRows: 0 };

	const f = Math.max(0, Math.min(focused, n - 1));
	const budget = Math.max(1, maxRows - LIST_INDICATOR_ROWS);
	let start = f;
	let end = f + 1;
	let used = itemHeights[f] ?? 1;
	let above = 0;
	let below = 0;

	for (;;) {
		const upH = start > 0 ? (itemHeights[start - 1] ?? 1) : undefined;
		const downH = end < n ? (itemHeights[end] ?? 1) : undefined;
		const canUp = upH !== undefined && used + upH <= budget;
		const canDown = downH !== undefined && used + downH <= budget;
		if (!canUp && !canDown) break;
		const preferUp = canUp && (!canDown || above <= below);
		if (preferUp) {
			start--;
			used += upH as number;
			above += upH as number;
		} else {
			used += downH as number;
			below += downH as number;
			end++;
		}
	}

	if (start === 0 && end === n) return { start: 0, end: n, windowed: false, padRows: 0 };
	return { start, end, windowed: true, padRows: Math.max(0, budget - used) };
}

export interface WindowIndicatorText {
	top: string;
	bottom: string;
}

/** Plain-text indicator copy for a windowed list (caller applies theme styling). */
export function windowIndicatorText(window: ListWindow, itemCount: number, focused: number): WindowIndicatorText {
	const hiddenAbove = window.start;
	const hiddenBelow = itemCount - window.end;
	const position = `${Math.max(0, Math.min(focused, itemCount - 1)) + 1}/${itemCount}`;
	return {
		top: hiddenAbove > 0 ? `  ↑ ${hiddenAbove} more` : "",
		bottom: hiddenBelow > 0 ? `  ↓ ${hiddenBelow} more · ${position}` : `  ${position}`,
	};
}

/**
 * Assemble a windowed list from per-item rendered rows. Returns the output lines
 * and the focused item's `[startRow, endRow)` range within them.
 */
export function assembleWindowedList(
	itemLines: readonly (readonly string[])[],
	focused: number,
	maxRows: number,
	styleIndicator: (text: string) => string,
): { lines: string[]; focusedRange: [number, number] } {
	const heights = itemLines.map((l) => l.length);
	const window = computeListWindow(heights, focused, maxRows);
	const lines: string[] = [];
	let focusedRange: [number, number] = [0, 0];
	const indicators = window.windowed ? windowIndicatorText(window, itemLines.length, focused) : undefined;
	if (indicators) lines.push(indicators.top ? styleIndicator(indicators.top) : "");
	for (let i = window.start; i < window.end; i++) {
		const rows = itemLines[i] ?? [];
		if (i === focused) focusedRange = [lines.length, lines.length + rows.length];
		lines.push(...rows);
	}
	if (indicators) {
		for (let i = 0; i < window.padRows; i++) lines.push("");
		lines.push(styleIndicator(indicators.bottom));
	}
	return { lines, focusedRange };
}
