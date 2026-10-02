import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { makeTheme } from "../../test/utils/index.js";
import { describe, expect, it, vi } from "vitest";
import { computeTabWindow, TabBar, type TabBarProps } from "./tab-bar.js";

const theme = makeTheme() as unknown as Theme;

interface PropsOver {
	questions?: ReadonlyArray<{ header?: string; question: string }>;
	answeredIndices?: ReadonlyArray<number>;
	activeTabIndex?: number;
	totalTabs?: number;
}

function makeBar(initial: TabBarProps): TabBar {
	const bar = new TabBar(theme);
	bar.setProps(initial);
	return bar;
}

function buildProps(over: PropsOver = {}): TabBarProps {
	const questions = over.questions ?? [
		{ header: "Scope", question: "Which scope?" },
		{ header: "Priority", question: "How urgent?" },
		{ header: "Tests", question: "Include tests?" },
	];
	const answeredSet = new Set(over.answeredIndices ?? []);
	const totalTabs = over.totalTabs ?? questions.length + 1;
	const activeTabIndex = over.activeTabIndex ?? 0;
	const submitIndex = totalTabs - 1;
	const tabs = questions.map((q, i) => ({
		label: q.header && q.header.length > 0 ? q.header : `Q${i + 1}`,
		answered: answeredSet.has(i),
		active: i === activeTabIndex,
	}));
	return {
		tabs,
		submit: {
			active: activeTabIndex === submitIndex,
			allAnswered: answeredSet.size === questions.length && questions.length > 0,
		},
	};
}

describe("TabBar.render", () => {
	it("emits exactly 2 lines (tab bar + blank spacer)", () => {
		const tb = makeBar(buildProps());
		const lines = tb.render(80);
		expect(lines.length).toBe(2);
		expect(lines[1]).toBe("");
	});

	it("renders one indicator per question + a Submit tab", () => {
		const tb = makeBar(buildProps());
		const line = tb.render(80)[0];
		const empties = (line.match(/□/g) ?? []).length;
		expect(empties).toBe(3);
		expect(line).toContain("Submit");
		expect(line).toContain("←");
		expect(line).toContain("→");
	});

	it("flips □ → ■ for answered questions", () => {
		const tb = makeBar(buildProps({ answeredIndices: [1] }));
		const line = tb.render(80)[0];
		expect(line.match(/■/g)?.length).toBe(1);
		expect(line.match(/□/g)?.length).toBe(2);
	});

	it("applies selectedBg styling to the active tab via theme.bg", () => {
		const spy = vi.spyOn(theme, "bg");
		const tb = makeBar(buildProps({ activeTabIndex: 1 }));
		tb.render(80);
		expect(spy).toHaveBeenCalledWith("selectedBg", expect.stringContaining("Priority"));
		spy.mockRestore();
	});

	it("Submit shows success color when all answered, dim otherwise", () => {
		const spy = vi.spyOn(theme, "fg");
		const tbAll = makeBar(buildProps({ answeredIndices: [0, 1, 2], activeTabIndex: 0 }));
		tbAll.render(80);
		expect(spy).toHaveBeenCalledWith("success", expect.stringContaining("Submit"));

		spy.mockClear();
		const tbPartial = makeBar(buildProps({ answeredIndices: [], activeTabIndex: 0 }));
		tbPartial.render(80);
		expect(spy).toHaveBeenCalledWith("dim", expect.stringContaining("Submit"));
		spy.mockRestore();
	});

	it("falls back to Q{n+1} when header is absent", () => {
		const tb = makeBar(
			buildProps({
				questions: [{ question: "first" }, { question: "second" }],
				totalTabs: 3,
			}),
		);
		const line = tb.render(80)[0];
		expect(line).toContain("Q1");
		expect(line).toContain("Q2");
	});

	it("truncates rather than overflowing when 4 long headers exceed width", () => {
		const tb = makeBar(
			buildProps({
				questions: [
					{ header: "VeryLongHeaderOne", question: "" },
					{ header: "VeryLongHeaderTwo", question: "" },
					{ header: "VeryLongHeaderThree", question: "" },
					{ header: "VeryLongHeaderFour", question: "" },
				],
				totalTabs: 5,
			}),
		);
		for (const w of [40, 60, 80, 120]) {
			const lines = tb.render(w);
			expect(visibleWidth(lines[0])).toBeLessThanOrEqual(w);
		}
	});

	it("setProps replaces props between renders", () => {
		const tb = makeBar(buildProps({ activeTabIndex: 0 }));
		const before = tb.render(80)[0];
		tb.setProps(buildProps({ activeTabIndex: 1, answeredIndices: [0] }));
		const after = tb.render(80)[0];
		expect(before).not.toBe(after);
		expect(after.match(/■/g)?.length).toBe(1);
	});
});

function manyQuestions(n: number) {
	return Array.from({ length: n }, (_, i) => ({ header: `Header${i + 1}`, question: `q${i + 1}` }));
}

describe("computeTabWindow", () => {
	it("returns the full range when everything fits", () => {
		expect(computeTabWindow([5, 5, 5], 1, 100)).toEqual({ start: 0, end: 3 });
	});

	it("always contains the anchor, even when the budget is too small", () => {
		expect(computeTabWindow([10, 10, 10], 2, 0)).toEqual({ start: 2, end: 3 });
	});

	it("grows around the anchor and charges overflow markers against the budget", () => {
		// 10 segments of width 10; markers "‹N " / "N› " are 3 cols each for N < 10.
		const widths = Array<number>(10).fill(10);
		const w = computeTabWindow(widths, 5, 36);
		expect(w.start).toBeLessThanOrEqual(5);
		expect(w.end).toBeGreaterThan(5);
		expect(w.end - w.start).toBe(3); // 3*10 + 3 + 3 = 36
	});

	it("spends the whole budget on one side when the anchor sits at an edge", () => {
		const widths = Array<number>(10).fill(10);
		expect(computeTabWindow(widths, 0, 43)).toEqual({ start: 0, end: 4 }); // 40 + right marker 3
		expect(computeTabWindow(widths, 9, 43)).toEqual({ start: 6, end: 10 }); // 40 + left marker 3
	});

	it("handles an empty tab list", () => {
		expect(computeTabWindow([], 0, 50)).toEqual({ start: 0, end: 0 });
	});
});

describe("TabBar.render — windowed strip for many questions", () => {
	it("renders the classic strip (no counter, no markers) when everything fits", () => {
		const tb = makeBar(buildProps());
		const line = tb.render(200)[0];
		expect(line).not.toMatch(/\[\d+\/\d+\]/);
		expect(line).not.toContain("‹");
		expect(line).not.toContain("›");
	});

	it("keeps every active tab visible and within width, for every width", () => {
		const questions = manyQuestions(12);
		for (const width of [40, 60, 80, 100, 120]) {
			for (let active = 0; active <= questions.length; active++) {
				const tb = makeBar(buildProps({ questions, activeTabIndex: active }));
				const line = tb.render(width)[0];
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
				expect(line).toContain("Submit");
				if (active < questions.length) expect(line).toContain(`Header${active + 1} `);
				else expect(line).toContain("Header12 "); // Submit focus anchors on the last question
				expect(line).toContain(`[${active + 1}/13]`);
			}
		}
	});

	it("shows only a right marker on the first tab and only a left marker on Submit", () => {
		const questions = manyQuestions(12);
		const first = makeBar(buildProps({ questions, activeTabIndex: 0 })).render(80)[0];
		expect(first).not.toContain("‹");
		expect(first).toMatch(/\d+› /);

		const submit = makeBar(buildProps({ questions, activeTabIndex: 12 })).render(80)[0];
		expect(submit).toMatch(/‹\d+ /);
		expect(submit).not.toContain("›");
	});

	it("hidden counts plus visible tabs add up to the total", () => {
		const questions = manyQuestions(20);
		const line = makeBar(buildProps({ questions, activeTabIndex: 10 })).render(80)[0];
		const left = Number(/‹(\d+) /.exec(line)?.[1] ?? 0);
		const right = Number(/(\d+)› /.exec(line)?.[1] ?? 0);
		const visible = (line.match(/[□■]/g) ?? []).length;
		expect(left + visible + right).toBe(20);
		expect(left).toBeGreaterThan(0);
		expect(right).toBeGreaterThan(0);
	});

	it("colors a marker warning while any hidden tab is unanswered, success once all are answered", () => {
		const questions = manyQuestions(12);
		const spy = vi.spyOn(theme, "fg");
		makeBar(buildProps({ questions, activeTabIndex: 0 })).render(60);
		expect(spy).toHaveBeenCalledWith("warning", expect.stringMatching(/\d+› /));

		spy.mockClear();
		const all = questions.map((_, i) => i);
		makeBar(buildProps({ questions, activeTabIndex: 0, answeredIndices: all })).render(60);
		expect(spy).toHaveBeenCalledWith("success", expect.stringMatching(/\d+› /));
		expect(spy).not.toHaveBeenCalledWith("warning", expect.anything());
		spy.mockRestore();
	});
});
