/**
 * Transcript scrolling driven from the questionnaire's raw terminal listener.
 *
 * While the questionnaire overlay is focused, pi-tui routes keyboard input to it and
 * Pi's fullscreen host deliberately defers its transcript scroll bindings and wheel
 * events to the focused overlay (`shouldDeferViewportInputToOverlay`). Without this
 * module the questionnaire's own PgUp/PgDn paging would swallow those keys and the
 * transcript behind the full-height overlay could never be scrolled — the "frozen
 * body" complaint.
 *
 * Instead, `execute()` registers a raw `ctx.ui.onTerminalInput` listener that
 * recognizes the host's transcript scroll bindings plus SGR/legacy mouse-wheel
 * sequences and drives the fullscreen TUI's public `scrollBy` /
 * `scrollToTop` / `scrollToBottom` surface directly. The overlay stays focused, so
 * arrows / Enter / Esc / typing keep editing the dialog while the scroll keys move
 * the transcript.
 *
 * All functions are pure/duck-typed so they typecheck against both the pinned
 * `@earendil-works/pi-tui` devDependency (which predates alt-screen TUIs) and the
 * newer fullscreen hosts.
 */

/** Host page-scroll overlap, mirrored from pi-coding-agent's `PAGE_SCROLL_OVERLAP`. */
export const PAGE_SCROLL_OVERLAP = 4;

/** Lines per mouse-wheel notch (the host default is 1 before its runtime acceleration). */
export const WHEEL_LINES_PER_NOTCH = 3;

/** Alt+wheel multiplier, mirroring the host's `ALT_WHEEL_SCROLL_MULTIPLIER`. */
export const ALT_WHEEL_MULTIPLIER = 5;

/** The public scroll surface of a fullscreen (alt-screen) TUI. */
export interface TranscriptScrollViewport {
	scrollBy(lines: number): void;
	scrollToTop?(): void;
	scrollToBottom?(): void;
}

/** A resolved transcript scroll request. */
export type TranscriptScrollIntent =
	| { kind: "lines"; lines: number }
	| { kind: "top" }
	| { kind: "bottom" };

/** Minimal keybinding contract; the session's `KeybindingsManager` satisfies it. */
export interface TranscriptScrollKeybindings {
	matches(data: string, name: string): boolean;
}

/**
 * Duck-type the fullscreen TUI's public scroll surface. Main-screen TUIs (and the
 * pinned pi-tui devDependency) expose no `scrollBy`, which is exactly the signal
 * that the host should keep its own PgUp/PgDn dialog paging instead.
 */
export function transcriptScrollViewport(tui: unknown): TranscriptScrollViewport | undefined {
	const candidate = tui as Partial<TranscriptScrollViewport> | null | undefined;
	return candidate && typeof candidate.scrollBy === "function" ? (candidate as TranscriptScrollViewport) : undefined;
}

/**
 * Rows reserved below the transcript when its real height is unknown. Pi's
 * fullscreen layout docks the editor (min 3 rows), status and footer under the
 * transcript, so the terminal height overstates the viewport. Over-reserving only
 * shortens a page; under-reserving would skip lines between pages.
 */
export const FALLBACK_DOCK_ROWS = 8;

type PrimaryScrollViewSource = { getPrimaryScrollView?: () => { viewportHeight?: unknown } | undefined };

/**
 * Height of the transcript viewport the host scrolls. Reads the primary scroll view
 * — the same view `scrollBy` drives — through a duck-typed lookup: the accessor is
 * TypeScript-private on `TuiAltScreen` but present at runtime. Returns `undefined`
 * when it is unavailable or throws, so callers fall back to an estimate.
 */
export function transcriptViewportHeight(tui: unknown): number | undefined {
	try {
		const height = (tui as PrimaryScrollViewSource | null | undefined)?.getPrimaryScrollView?.()?.viewportHeight;
		return typeof height === "number" && Number.isFinite(height) && height > 0 ? height : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Keyboard page size, matching the host's `viewportHeight - PAGE_SCROLL_OVERLAP`.
 * Without a known viewport height, estimate it from the terminal rows minus the
 * docked input area so a page never jumps past unseen lines.
 */
export function transcriptPageSize(viewportHeight: number | undefined, terminalRows: number | undefined): number {
	const height =
		viewportHeight ?? (typeof terminalRows === "number" && terminalRows > 0 ? terminalRows : 24) - FALLBACK_DOCK_ROWS;
	return Math.max(1, height - PAGE_SCROLL_OVERLAP);
}

const SGR_WHEEL_RE = /^\x1b\[<(\d+);\d+;\d+[Mm]$/;

/**
 * Decode a raw mouse-wheel sequence into signed transcript lines: negative scrolls
 * up (towards older content), positive scrolls down. Returns `undefined` when the
 * input is not a wheel event. Handles both SGR (`\x1b[<b;x;yM`) and legacy
 * (`\x1b[M` + three bytes) encodings; Alt+wheel is accelerated.
 */
export function parseWheelScroll(data: string): number | undefined {
	let button: number | undefined;
	if (data.startsWith("\x1b[<")) {
		const match = SGR_WHEEL_RE.exec(data);
		if (!match) return undefined;
		button = Number.parseInt(match[1] ?? "", 10);
	} else if (data.length === 6 && data.startsWith("\x1b[M")) {
		button = data.charCodeAt(3) - 32;
	}
	if (button === undefined || !Number.isFinite(button)) return undefined;
	// Bit 6 (64) marks wheel events; bits 0-1 carry the direction.
	if ((button & 64) === 0) return undefined;
	const direction = button & 3;
	if (direction !== 0 && direction !== 1) return undefined;
	const magnitude = (button & 8) !== 0 ? WHEEL_LINES_PER_NOTCH * ALT_WHEEL_MULTIPLIER : WHEEL_LINES_PER_NOTCH;
	return direction === 0 ? -magnitude : magnitude;
}

/**
 * Resolve raw terminal input into a transcript scroll request. Wheel events are
 * recognized before keybindings; keyboard scrolling mirrors the host's
 * `tui.altScreen.*` bindings so user remaps keep working.
 */
export function resolveTranscriptScroll(
	data: string,
	keybindings: TranscriptScrollKeybindings | undefined,
	pageSize: number,
): TranscriptScrollIntent | undefined {
	const wheel = parseWheelScroll(data);
	if (wheel !== undefined) return { kind: "lines", lines: wheel };
	if (!keybindings) return undefined;

	const matches = (name: string): boolean => keybindings.matches(data, name);
	if (matches("tui.altScreen.pageUp")) return { kind: "lines", lines: -pageSize };
	if (matches("tui.altScreen.pageDown")) return { kind: "lines", lines: pageSize };

	const half = Math.max(1, Math.floor(pageSize / 2));
	if (matches("tui.altScreen.halfPageUp")) return { kind: "lines", lines: -half };
	if (matches("tui.altScreen.halfPageDown")) return { kind: "lines", lines: half };
	if (matches("tui.altScreen.lineUp")) return { kind: "lines", lines: -1 };
	if (matches("tui.altScreen.lineDown")) return { kind: "lines", lines: 1 };
	if (matches("tui.altScreen.top")) return { kind: "top" };
	if (matches("tui.altScreen.bottom")) return { kind: "bottom" };
	return undefined;
}

/** Apply a resolved intent to the fullscreen viewport. */
export function applyTranscriptScroll(viewport: TranscriptScrollViewport, intent: TranscriptScrollIntent): void {
	switch (intent.kind) {
		case "lines":
			viewport.scrollBy(intent.lines);
			return;
		case "top":
			viewport.scrollToTop?.();
			return;
		case "bottom":
			viewport.scrollToBottom?.();
			return;
	}
}
