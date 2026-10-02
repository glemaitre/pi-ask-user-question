import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { StatefulView } from "../stateful-view.js";

/**
 * Per-tick projection of TabBar state. The selector
 * (`selectTabBarProps`) hoists every render-time derivation
 * (`allAnswered`, `answered`, `isActive`, `submitActive`) into props so
 * `render()` is pure styling.
 */
export interface TabBarProps {
	/** One per author-defined question, in order. */
	tabs: ReadonlyArray<{ label: string; answered: boolean; active: boolean }>;
	/** Submit-tab state. `allAnswered` drives the success/dim color picker. */
	submit: { active: boolean; allAnswered: boolean };
}

const LEFT_EDGE = " ← ";
const RIGHT_EDGE = " →";
const SUBMIT_TEXT = " ✓ Submit ";
/** Separator emitted after every question segment. */
const GAP = " ";

/** `‹N ` — N question tabs hidden to the left of the window. */
function leftMarkerText(hidden: number): string {
	return `‹${hidden} `;
}

/** ` N›` — N question tabs hidden to the right of the window (before Submit). */
function rightMarkerText(hidden: number): string {
	return `${hidden}› `;
}

/** `[3/12] ` — position counter shown only while the strip is windowed. */
function counterText(position: number, total: number): string {
	return `[${position}/${total}] `;
}

/** Visible window of question tabs: half-open range `[start, end)`. */
export interface TabWindow {
	start: number;
	end: number;
}

/**
 * Pick the widest contiguous run of question tabs that fits in `budget` columns
 * while always containing `anchor`. Overflow markers are charged against the
 * budget as soon as they become necessary, so the result is exact.
 *
 * Growth alternates right-then-left around the anchor so the active tab stays
 * roughly centered; once one side is exhausted (or blocked), the other side
 * keeps absorbing the remaining space.
 *
 * Exported for unit tests.
 */
export function computeTabWindow(segmentWidths: readonly number[], anchor: number, budget: number): TabWindow {
	const n = segmentWidths.length;
	if (n === 0) return { start: 0, end: 0 };
	const a = Math.max(0, Math.min(anchor, n - 1));

	const cost = (start: number, end: number): number => {
		let w = 0;
		for (let i = start; i < end; i++) w += segmentWidths[i] ?? 0;
		if (start > 0) w += visibleWidth(leftMarkerText(start));
		if (end < n) w += visibleWidth(rightMarkerText(n - end));
		return w;
	};

	let start = a;
	let end = a + 1;
	let canGrowRight = true;
	let canGrowLeft = true;
	let preferRight = true;
	while (canGrowRight || canGrowLeft) {
		const tryRight = (preferRight && canGrowRight) || !canGrowLeft;
		if (tryRight) {
			if (end < n && cost(start, end + 1) <= budget) end++;
			else canGrowRight = false;
		} else {
			if (start > 0 && cost(start - 1, end) <= budget) start--;
			else canGrowLeft = false;
		}
		preferRight = !preferRight;
	}
	return { start, end };
}

export class TabBar implements StatefulView<TabBarProps> {
	private props: TabBarProps;

	constructor(private readonly theme: Theme) {
		this.props = { tabs: [], submit: { active: false, allAnswered: false } };
	}

	setProps(props: TabBarProps): void {
		this.props = props;
	}

	handleInput(_data: string): void {}

	invalidate(): void {}

	render(width: number): string[] {
		const { tabs, submit } = this.props;
		const rawSegments = tabs.map((tab) => ` ${tab.answered ? "■" : "□"} ${tab.label} `);
		const segmentWidths = rawSegments.map((s) => visibleWidth(s) + visibleWidth(GAP));
		const chromeWidth = visibleWidth(LEFT_EDGE) + visibleWidth(SUBMIT_TEXT) + visibleWidth(RIGHT_EDGE);
		const naturalWidth = chromeWidth + segmentWidths.reduce((acc, w) => acc + w, 0);

		let window: TabWindow = { start: 0, end: tabs.length };
		let counter = "";
		if (naturalWidth > width && tabs.length > 1) {
			// Windowed mode: keep the active tab (or the last question when Submit is
			// focused) visible, pin Submit on the right, and summarize what is hidden.
			const activeIndex = tabs.findIndex((t) => t.active);
			const anchor = activeIndex >= 0 ? activeIndex : tabs.length - 1;
			const position = submit.active ? tabs.length + 1 : anchor + 1;
			counter = counterText(position, tabs.length + 1);
			const budget = width - chromeWidth - visibleWidth(counter);
			window = computeTabWindow(segmentWidths, anchor, budget);
		}

		const pieces: string[] = [LEFT_EDGE];
		if (counter) pieces.push(this.theme.fg("dim", counter));
		if (window.start > 0) {
			const hidden = tabs.slice(0, window.start);
			pieces.push(this.styleMarker(leftMarkerText(window.start), hidden));
		}
		for (let i = window.start; i < window.end; i++) {
			const tab = tabs[i];
			const rawSeg = rawSegments[i];
			if (!tab || rawSeg === undefined) continue;
			const styled = tab.active
				? this.theme.bg("selectedBg", this.theme.fg("text", rawSeg))
				: this.theme.fg(tab.answered ? "success" : "muted", rawSeg);
			pieces.push(styled);
			pieces.push(GAP);
		}
		if (window.end < tabs.length) {
			const hidden = tabs.slice(window.end);
			pieces.push(this.styleMarker(rightMarkerText(tabs.length - window.end), hidden));
		}

		const submitStyled = submit.active
			? this.theme.bg("selectedBg", this.theme.fg("text", SUBMIT_TEXT))
			: this.theme.fg(submit.allAnswered ? "success" : "dim", SUBMIT_TEXT);
		pieces.push(submitStyled);
		pieces.push(RIGHT_EDGE);

		// Final clamp still applies: on extremely narrow terminals even the active
		// tab alone may not fit next to the chrome.
		const tabLine = truncateToWidth(pieces.join(""), width, "");
		return [tabLine, ""];
	}

	/** Overflow marker: warning-colored while any hidden tab is unanswered, success otherwise. */
	private styleMarker(text: string, hidden: TabBarProps["tabs"]): string {
		const anyUnanswered = hidden.some((t) => !t.answered);
		return this.theme.fg(anyUnanswered ? "warning" : "success", text);
	}
}
