import { describe, expect, it } from "vitest";
import { assembleWindowedList, computeListWindow, LIST_INDICATOR_ROWS, windowIndicatorText } from "./list-window.js";

const ones = (n: number) => Array<number>(n).fill(1);

describe("computeListWindow", () => {
	it("is not windowed when every row fits", () => {
		expect(computeListWindow(ones(5), 2, 5)).toEqual({ start: 0, end: 5, windowed: false, padRows: 0 });
	});

	it("is never windowed for a single item, even one taller than the budget", () => {
		expect(computeListWindow([40], 0, 5).windowed).toBe(false);
	});

	it("centres the focused item and reserves the indicator rows", () => {
		const w = computeListWindow(ones(20), 10, 7);
		expect(w.windowed).toBe(true);
		expect(w.end - w.start).toBe(7 - LIST_INDICATOR_ROWS);
		expect(w.start).toBeLessThanOrEqual(10);
		expect(w.end).toBeGreaterThan(10);
		expect(10 - w.start).toBe(w.end - 1 - 10);
	});

	it("clamps at both ends and gives the slack to the other side", () => {
		expect(computeListWindow(ones(20), 0, 7)).toMatchObject({ start: 0, end: 5 });
		expect(computeListWindow(ones(20), 19, 7)).toMatchObject({ start: 15, end: 20 });
	});

	it("only includes whole items and pads the remainder", () => {
		const w = computeListWindow([3, 3, 3, 3], 1, 7); // content budget 5 → only one 3-row item fits
		expect(w).toMatchObject({ start: 1, end: 2, windowed: true, padRows: 2 });
	});

	it("always includes the focused item even when it alone exceeds the budget", () => {
		const w = computeListWindow([1, 30, 1], 1, 6);
		expect(w).toMatchObject({ start: 1, end: 2, windowed: true, padRows: 0 });
	});
});

describe("windowIndicatorText", () => {
	it("reports hidden counts and the 1-based position", () => {
		const t = windowIndicatorText({ start: 3, end: 8, windowed: true, padRows: 0 }, 20, 5);
		expect(t.top).toContain("↑ 3 more");
		expect(t.bottom).toContain("↓ 12 more · 6/20");
	});

	it("leaves the top blank at the start of the list", () => {
		expect(windowIndicatorText({ start: 0, end: 5, windowed: true, padRows: 0 }, 20, 0).top).toBe("");
	});
});

describe("assembleWindowedList", () => {
	const items = Array.from({ length: 30 }, (_, i) => (i % 4 === 0 ? [`item-${i}`, "  desc", "  more"] : [`item-${i}`]));

	it("emits exactly maxRows rows at every focus position and locates the focused item", () => {
		for (let f = 0; f < items.length; f++) {
			const { lines, focusedRange } = assembleWindowedList(items, f, 12, (s) => s);
			expect(lines.length).toBe(12);
			expect(lines[focusedRange[0]]).toBe(`item-${f}`);
			expect(focusedRange[1] - focusedRange[0]).toBe(items[f]!.length);
		}
	});

	it("returns the list verbatim when it fits", () => {
		const short = [["a"], ["b", "  b-desc"], ["c"]];
		expect(assembleWindowedList(short, 1, 20, (s) => `<${s}>`)).toEqual({
			lines: ["a", "b", "  b-desc", "c"],
			focusedRange: [1, 3],
		});
	});
});
