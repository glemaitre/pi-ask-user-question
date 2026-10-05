import { describe, expect, it, vi } from "vitest";
import {
	ALT_WHEEL_MULTIPLIER,
	applyTranscriptScroll,
	FALLBACK_DOCK_ROWS,
	PAGE_SCROLL_OVERLAP,
	parseWheelScroll,
	resolveTranscriptScroll,
	transcriptPageSize,
	transcriptScrollViewport,
	transcriptViewportHeight,
	WHEEL_LINES_PER_NOTCH,
} from "./transcript-scroll.js";

const PAGE_UP = "\x1b[5~";
const PAGE_DOWN = "\x1b[6~";

function keybindings(mapping: Record<string, string>) {
	return {
		matches(data: string, name: string): boolean {
			return mapping[name] === data;
		},
	};
}

/** Build a legacy X10 wheel sequence from its button code. */
function legacyWheel(button: number): string {
	return `\x1b[M${String.fromCharCode(button + 32)}${String.fromCharCode(33)}${String.fromCharCode(33)}`;
}

describe("transcript-scroll — viewport detection", () => {
	it("accepts an object exposing scrollBy and rejects the rest", () => {
		const viewport = { scrollBy: vi.fn() };
		expect(transcriptScrollViewport(viewport)).toBe(viewport);
		expect(transcriptScrollViewport({})).toBeUndefined();
		expect(transcriptScrollViewport(null)).toBeUndefined();
		expect(transcriptScrollViewport(undefined)).toBeUndefined();
	});
});

describe("transcript-scroll — viewport height", () => {
	it("reads the primary scroll view's viewport height", () => {
		const tui = { getPrimaryScrollView: () => ({ viewportHeight: 31 }) };
		expect(transcriptViewportHeight(tui)).toBe(31);
	});

	it("returns undefined when the accessor is missing, throws, or reports nonsense", () => {
		expect(transcriptViewportHeight({})).toBeUndefined();
		expect(transcriptViewportHeight(undefined)).toBeUndefined();
		expect(transcriptViewportHeight({ getPrimaryScrollView: () => undefined })).toBeUndefined();
		expect(transcriptViewportHeight({ getPrimaryScrollView: () => ({ viewportHeight: 0 }) })).toBeUndefined();
		expect(transcriptViewportHeight({ getPrimaryScrollView: () => ({ viewportHeight: "34" }) })).toBeUndefined();
		expect(
			transcriptViewportHeight({
				getPrimaryScrollView: () => {
					throw new Error("boom");
				},
			}),
		).toBeUndefined();
	});
});

describe("transcript-scroll — page size", () => {
	it("mirrors the host page (viewport height minus overlap) when the height is known", () => {
		// 40-row terminal, 6-row input dock → 34-row transcript → 30-line page, like Pi.
		expect(transcriptPageSize(34, 40)).toBe(34 - PAGE_SCROLL_OVERLAP);
	});

	it("never pages past the visible transcript when it falls back to the terminal rows", () => {
		expect(transcriptPageSize(undefined, 40)).toBe(40 - FALLBACK_DOCK_ROWS - PAGE_SCROLL_OVERLAP);
		expect(transcriptPageSize(undefined, undefined)).toBe(24 - FALLBACK_DOCK_ROWS - PAGE_SCROLL_OVERLAP);
		expect(transcriptPageSize(undefined, 0)).toBe(24 - FALLBACK_DOCK_ROWS - PAGE_SCROLL_OVERLAP);
	});

	it("floors at one line", () => {
		expect(transcriptPageSize(2, 40)).toBe(1);
		expect(transcriptPageSize(undefined, 3)).toBe(1);
	});
});

describe("transcript-scroll — wheel parsing", () => {
	it("decodes SGR wheel up and down", () => {
		expect(parseWheelScroll("\x1b[<64;10;5M")).toBe(-WHEEL_LINES_PER_NOTCH);
		expect(parseWheelScroll("\x1b[<65;10;5M")).toBe(WHEEL_LINES_PER_NOTCH);
	});

	it("accelerates Alt+wheel", () => {
		expect(parseWheelScroll("\x1b[<72;10;5M")).toBe(-WHEEL_LINES_PER_NOTCH * ALT_WHEEL_MULTIPLIER);
		expect(parseWheelScroll("\x1b[<73;10;5M")).toBe(WHEEL_LINES_PER_NOTCH * ALT_WHEEL_MULTIPLIER);
	});

	it("decodes the legacy X10 encoding", () => {
		expect(parseWheelScroll(legacyWheel(64))).toBe(-WHEEL_LINES_PER_NOTCH);
		expect(parseWheelScroll(legacyWheel(65))).toBe(WHEEL_LINES_PER_NOTCH);
	});

	it("accepts the SGR lowercase terminator like the host does", () => {
		expect(parseWheelScroll("\x1b[<64;10;5m")).toBe(-WHEEL_LINES_PER_NOTCH);
	});

	it("ignores non-wheel mouse buttons, malformed sequences, and ordinary keys", () => {
		expect(parseWheelScroll("\x1b[<0;10;5M")).toBeUndefined();
		expect(parseWheelScroll("\x1b[<66;10;5M")).toBeUndefined();
		expect(parseWheelScroll("\x1b[<64;10M")).toBeUndefined();
		expect(parseWheelScroll(legacyWheel(0))).toBeUndefined();
		expect(parseWheelScroll("x")).toBeUndefined();
		expect(parseWheelScroll(PAGE_UP)).toBeUndefined();
	});
});

describe("transcript-scroll — intent resolution", () => {
	const kb = keybindings({
		"tui.altScreen.pageUp": PAGE_UP,
		"tui.altScreen.pageDown": PAGE_DOWN,
		"tui.altScreen.halfPageUp": "halfup",
		"tui.altScreen.halfPageDown": "halfdown",
		"tui.altScreen.lineUp": "lineup",
		"tui.altScreen.lineDown": "linedown",
		"tui.altScreen.top": "top",
		"tui.altScreen.bottom": "bottom",
	});

	it("maps page bindings to full-page deltas", () => {
		expect(resolveTranscriptScroll(PAGE_UP, kb, 30)).toEqual({ kind: "lines", lines: -30 });
		expect(resolveTranscriptScroll(PAGE_DOWN, kb, 30)).toEqual({ kind: "lines", lines: 30 });
	});

	it("maps half-page and line bindings", () => {
		expect(resolveTranscriptScroll("halfup", kb, 30)).toEqual({ kind: "lines", lines: -15 });
		expect(resolveTranscriptScroll("halfdown", kb, 30)).toEqual({ kind: "lines", lines: 15 });
		expect(resolveTranscriptScroll("lineup", kb, 30)).toEqual({ kind: "lines", lines: -1 });
		expect(resolveTranscriptScroll("linedown", kb, 30)).toEqual({ kind: "lines", lines: 1 });
	});

	it("maps top/bottom bindings", () => {
		expect(resolveTranscriptScroll("top", kb, 30)).toEqual({ kind: "top" });
		expect(resolveTranscriptScroll("bottom", kb, 30)).toEqual({ kind: "bottom" });
	});

	it("returns undefined for unrelated keys", () => {
		expect(resolveTranscriptScroll("x", kb, 30)).toBeUndefined();
		expect(resolveTranscriptScroll(PAGE_UP, undefined, 30)).toBeUndefined();
	});

	it("recognizes wheel events even without keybindings", () => {
		expect(resolveTranscriptScroll("\x1b[<64;1;1M", undefined, 30)).toEqual({
			kind: "lines",
			lines: -WHEEL_LINES_PER_NOTCH,
		});
	});
});

describe("transcript-scroll — apply", () => {
	it("drives the viewport surface", () => {
		const scrollBy = vi.fn();
		const scrollToTop = vi.fn();
		const scrollToBottom = vi.fn();
		const viewport = { scrollBy, scrollToTop, scrollToBottom };
		applyTranscriptScroll(viewport, { kind: "lines", lines: -12 });
		applyTranscriptScroll(viewport, { kind: "top" });
		applyTranscriptScroll(viewport, { kind: "bottom" });
		expect(scrollBy).toHaveBeenCalledWith(-12);
		expect(scrollToTop).toHaveBeenCalledTimes(1);
		expect(scrollToBottom).toHaveBeenCalledTimes(1);
	});

	it("tolerates a viewport without top/bottom helpers", () => {
		const scrollBy = vi.fn();
		expect(() => applyTranscriptScroll({ scrollBy }, { kind: "top" })).not.toThrow();
		expect(scrollBy).not.toHaveBeenCalled();
	});
});
