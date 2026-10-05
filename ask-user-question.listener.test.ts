import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createMockPi } from "./test/utils/index.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerAskUserQuestionTool } from "./ask-user-question.js";
import type { AskUserQuestionConfig } from "./config.js";

/**
 * Integration tests for the raw `ctx.ui.onTerminalInput` collapse listener.
 * The factory tests drive the component `handleInput` path (the fallback when
 * no raw listener is available); these drive the listener path that pi-tui
 * needs while the overlay is hidden, using the real QuestionnaireSession via
 * the `ctx.ui.custom` factory and a fake OverlayHandle.
 */

const identityTheme = {
	fg: (_c: string, s: string) => s,
	bg: (_c: string, s: string) => s,
	bold: (s: string) => s,
	strikethrough: (s: string) => s,
};

const CTRL_RBRACKET = "\x1d"; // GS byte — what legacy terminals send for Ctrl+]
const KITTY_CTRL_RBRACKET_PRESS = "\x1b[93;5u";
const KITTY_CTRL_RBRACKET_REPEAT = "\x1b[93;5:2u";
const KITTY_CTRL_RBRACKET_RELEASE = "\x1b[93;5:3u";
const ALT_O = "\x1bo"; // ESC-prefixed 'o' — legacy encoding for Alt+O
const PAGE_UP = "\x1b[5~";
const PAGE_DOWN = "\x1b[6~";
const WHEEL_UP = "\x1b[<64;1;1M";
const WHEEL_DOWN = "\x1b[<65;1;1M";

/**
 * Minimal keybindings: the alt-screen transcript bindings plus the dialog's own
 * select bindings, both on PgUp/PgDn like Pi's defaults — so tests can tell which
 * layer consumed the key.
 */
const scrollKeybindings = {
	matches(data: string, name: string): boolean {
		if (name === "tui.altScreen.pageUp" || name === "tui.select.pageUp") return data === PAGE_UP;
		if (name === "tui.altScreen.pageDown" || name === "tui.select.pageDown") return data === PAGE_DOWN;
		if (name === "tui.select.confirm") return data === "\r";
		return false;
	},
};

const params = {
	questions: [
		{
			question: "Pick one",
			header: "Choice",
			options: [{ label: "Alpha" }, { label: "Beta" }],
		},
	],
};

interface FakeHandle {
	hide(): void;
	setHidden(hidden: boolean): void;
	isHidden(): boolean;
	focus(): void;
	unfocus(): void;
	isFocused(): boolean;
}

function makeHandle(over: { isFocused?: () => boolean } = {}): FakeHandle {
	let hidden = false;
	return {
		hide: () => {},
		focus: () => {},
		unfocus: () => {},
		setHidden: (h: boolean) => {
			hidden = h;
		},
		isHidden: () => hidden,
		// Mirrors pi-tui: a visible questionnaire overlay normally has focus;
		// a hidden one never does. Overridable for the other-overlay-on-top case.
		isFocused: over.isFocused ?? (() => !hidden),
	};
}

type RawListener = (data: string) => { consume?: boolean } | undefined;
type SessionComponent = { render(width: number): string[]; handleInput(data: string): void };

function register() {
	const { pi, captured } = createMockPi();
	registerAskUserQuestionTool(pi);
	return captured.tools.get("ask_user_question")!;
}

/**
 * Fake `ctx.ui` that mimics interactive-mode wiring: `onTerminalInput` captures
 * the raw listener, `custom` runs the real factory then hands out the overlay
 * handle via `onHandle`, and `script` drives the interaction before resolving.
 */
interface DriveOptions {
	/**
	 * Fake a fullscreen host: expose `scrollBy` plus a 20-row transcript viewport
	 * (`getPrimaryScrollView`). Default true; false mimics a main-screen TUI.
	 */
	scrollable?: boolean;
}

function driveWithListener(
	handle: FakeHandle,
	script: (done: (v: unknown) => void) => void,
	driveOptions: DriveOptions = {},
) {
	const notify = vi.fn();
	const scrollBy = vi.fn();
	const listeners: RawListener[] = [];
	// One remover per registration, so teardown of each listener is observable.
	const removers: Array<ReturnType<typeof vi.fn>> = [];
	const fakeTui: Record<string, unknown> = { requestRender: vi.fn(), terminal: { columns: 120, rows: 24 } };
	if (driveOptions.scrollable !== false) {
		fakeTui.scrollBy = scrollBy;
		fakeTui.getPrimaryScrollView = () => ({ viewportHeight: 20 });
	}
	const componentRef: { current: SessionComponent | undefined } = { current: undefined };
	// Mirror TUI.handleInput: feed the keystroke through every registered raw
	// listener in registration order and stop at the first consumer. `execute()`
	// registers the collapse listener and the transcript-scroll listener, so a
	// single-listener stub would hide one of them.
	const press: RawListener = (data) => {
		for (const listener of listeners) {
			const result = listener(data);
			if (result?.consume) return result;
		}
		return undefined;
	};
	const listenerRef: { current: RawListener | undefined } = { current: press };
	const onTerminalInput = vi.fn((h: RawListener) => {
		listeners.push(h);
		const remove = vi.fn();
		removers.push(remove);
		return remove;
	});
	const custom = vi.fn(
		(
			factory: (
				tui: Record<string, unknown>,
				theme: typeof identityTheme,
				kb: { matches(data: string, name: string): boolean },
				done: (v: unknown) => void,
			) => unknown,
			options?: { onHandle?: (handle: FakeHandle) => void },
		) => {
			return new Promise((resolve) => {
				componentRef.current = factory(
					fakeTui,
					identityTheme,
					scrollKeybindings,
					resolve,
				) as SessionComponent;
				options?.onHandle?.(handle);
				script(resolve);
			});
		},
	);
	const ctx = { hasUI: true, ui: { custom, onTerminalInput, notify } } as never;
	return { ctx, notify, onTerminalInput, removers, listenerRef, componentRef, scrollBy };
}

const home = process.env.HOME ?? "";
const configDir = join(home, ".config", "pi-ask-user-question");
const configPath = join(configDir, "config.json");

function writeCollapseKeyConfig(collapseKey: string): void {
	mkdirSync(configDir, { recursive: true });
	writeFileSync(configPath, JSON.stringify({ collapseKey } satisfies AskUserQuestionConfig));
}

afterEach(() => {
	if (existsSync(configPath)) rmSync(configPath);
});

describe("ask_user_question — raw terminal collapse listener", () => {
	it("hides via OverlayHandle.setHidden, notifies once, and unhides on the second press", async () => {
		const tool = register();
		const handle = makeHandle();
		const { ctx, notify, removers, listenerRef } = driveWithListener(handle, (done) => {
			// First press: hide + one-shot notification with the reopen key.
			expect(listenerRef.current?.(CTRL_RBRACKET)).toEqual({ consume: true });
			expect(handle.isHidden()).toBe(true);
			expect(notify).toHaveBeenCalledTimes(1);
			expect(notify).toHaveBeenCalledWith(expect.stringContaining("press Ctrl+] to reopen"), "info");
			// Second press: unhide, and the notification stays one-shot.
			expect(listenerRef.current?.(CTRL_RBRACKET)).toEqual({ consume: true });
			expect(handle.isHidden()).toBe(false);
			// Third round-trip re-hides without a second announcement.
			expect(listenerRef.current?.(CTRL_RBRACKET)).toEqual({ consume: true });
			expect(handle.isHidden()).toBe(true);
			expect(notify).toHaveBeenCalledTimes(1);
			done({ answers: [], cancelled: true });
		});
		await tool.execute?.("tc", params as never, undefined as never, undefined as never, ctx);
		// execute's finally must tear down both raw listeners (collapse + transcript
		// scroll) once the tool resolves.
		expect(removers).toHaveLength(2);
		for (const remove of removers) expect(remove).toHaveBeenCalledTimes(1);
	});

	it("toggles once for Kitty keyboard press, repeat, and release events", async () => {
		const tool = register();
		const handle = makeHandle();
		const { ctx, listenerRef } = driveWithListener(handle, (done) => {
			expect(listenerRef.current?.(KITTY_CTRL_RBRACKET_PRESS)).toEqual({ consume: true });
			expect(handle.isHidden()).toBe(true);

			// Repeat and release still belong to the collapse binding, so consume them
			// without toggling or leaking them into the newly focused chat editor.
			expect(listenerRef.current?.(KITTY_CTRL_RBRACKET_REPEAT)).toEqual({ consume: true });
			expect(handle.isHidden()).toBe(true);
			expect(listenerRef.current?.(KITTY_CTRL_RBRACKET_RELEASE)).toEqual({ consume: true });
			expect(handle.isHidden()).toBe(true);

			expect(listenerRef.current?.(KITTY_CTRL_RBRACKET_PRESS)).toEqual({ consume: true });
			expect(handle.isHidden()).toBe(false);
			done({ answers: [], cancelled: true });
		});
		await tool.execute?.("tc", params as never, undefined as never, undefined as never, ctx);
	});

	it("ignores non-matching keys", async () => {
		const tool = register();
		const handle = makeHandle();
		const { ctx, notify, listenerRef } = driveWithListener(handle, (done) => {
			expect(listenerRef.current?.("x")).toBeUndefined();
			expect(listenerRef.current?.(ALT_O)).toBeUndefined();
			expect(handle.isHidden()).toBe(false);
			expect(notify).not.toHaveBeenCalled();
			done({ answers: [], cancelled: true });
		});
		await tool.execute?.("tc", params as never, undefined as never, undefined as never, ctx);
	});

	it("leaves the key to another focused overlay (visible but unfocused questionnaire)", async () => {
		const tool = register();
		// e.g. `/btw` opened on top: the questionnaire is visible underneath but
		// not focused — the listener must not toggle it from under the top overlay.
		const handle = makeHandle({ isFocused: () => false });
		const { ctx, listenerRef } = driveWithListener(handle, (done) => {
			expect(listenerRef.current?.(CTRL_RBRACKET)).toBeUndefined();
			expect(handle.isHidden()).toBe(false);
			done({ answers: [], cancelled: true });
		});
		await tool.execute?.("tc", params as never, undefined as never, undefined as never, ctx);
	});

	it("host with an overlay handle but no raw input keeps the overlay visible on collapse (fallback row, no trap)", async () => {
		// A host that delivers onHandle but not onTerminalInput has exactly one input
		// path: the component's handleInput — which pi-tui does not deliver to a hidden
		// overlay. If collapsing hid the overlay here, nothing could ever reopen it, so
		// the session must suppress setHidden and rely on the one-line collapsed row.
		const tool = register();
		const handle = makeHandle();
		const componentRef: { current: SessionComponent | undefined } = { current: undefined };
		const custom = vi.fn(
			(
				factory: (
					tui: { requestRender: () => void; terminal: { columns: number; rows: number } },
					theme: typeof identityTheme,
					kb: undefined,
					done: (v: unknown) => void,
				) => unknown,
				options?: { onHandle?: (handle: FakeHandle) => void },
			) => {
				return new Promise((resolve) => {
					componentRef.current = factory(
						{ requestRender: vi.fn(), terminal: { columns: 120, rows: 24 } },
						identityTheme,
						undefined,
						resolve,
					) as SessionComponent;
					options?.onHandle?.(handle);
					componentRef.current.handleInput(CTRL_RBRACKET);
					expect(handle.isHidden()).toBe(false);
					const collapsed = componentRef.current.render(120);
					expect(collapsed).toHaveLength(1);
					expect(collapsed[0]).toContain("Ctrl+] to expand");
					// The visible row still routes input, so the same key expands it again.
					componentRef.current.handleInput(CTRL_RBRACKET);
					expect(componentRef.current.render(120).length).toBeGreaterThan(1);
					resolve({ answers: [], cancelled: true });
				});
			},
		);
		const ctx = { hasUI: true, ui: { custom } } as never;
		await tool.execute?.("tc", params as never, undefined as never, undefined as never, ctx);
	});

	it("honours a configured collapseKey (alt+o toggles, ctrl+] does not)", async () => {
		writeCollapseKeyConfig("alt+o");
		const tool = register();
		const handle = makeHandle();
		const { ctx, listenerRef } = driveWithListener(handle, (done) => {
			expect(listenerRef.current?.(CTRL_RBRACKET)).toBeUndefined();
			expect(handle.isHidden()).toBe(false);
			expect(listenerRef.current?.(ALT_O)).toEqual({ consume: true });
			expect(handle.isHidden()).toBe(true);
			done({ answers: [], cancelled: true });
		});
		await tool.execute?.("tc", params as never, undefined as never, undefined as never, ctx);
	});

	it("footer hint and collapsed row name the configured collapseKey (#176)", async () => {
		writeCollapseKeyConfig("alt+o");
		const tool = register();
		const handle = makeHandle();
		const { ctx, componentRef } = driveWithListener(handle, (done) => {
			const expanded = componentRef.current!.render(120).join("\n");
			expect(expanded).toContain("Alt+O to collapse");
			expect(expanded).not.toContain("Ctrl+]");
			// Collapse via the component input path — the one-line footer must name
			// the same key the router actually honours.
			componentRef.current!.handleInput(ALT_O);
			const collapsed = componentRef.current!.render(120);
			expect(collapsed).toHaveLength(1);
			expect(collapsed[0]).toContain("Alt+O to expand");
			done({ answers: [], cancelled: true });
		});
		await tool.execute?.("tc", params as never, undefined as never, undefined as never, ctx);
	});

	it("keeps collapse disabled when collapseKey is 'off'", async () => {
		writeCollapseKeyConfig("off");
		const tool = register();
		const handle = makeHandle();
		const { ctx, listenerRef, componentRef } = driveWithListener(handle, (done) => {
			// The footer must not advertise a collapse shortcut that cannot fire (#176).
			const rendered = componentRef.current!.render(120).join("\n");
			expect(rendered).not.toContain("to collapse");
			expect(rendered).toContain("Esc to cancel");
			// The transcript-scroll listener is still registered, but the collapse key
			// must not hide the overlay when the shortcut is disabled.
			expect(listenerRef.current?.(CTRL_RBRACKET)).toBeUndefined();
			expect(handle.isHidden()).toBe(false);
			done({ answers: [], cancelled: true });
		});
		await tool.execute?.("tc", params as never, undefined as never, undefined as never, ctx);
	});
});

describe("ask_user_question — raw transcript scroll listener", () => {
	it("scrolls a full page on PgUp/PgDn and keeps the dialog focused and rendered", async () => {
		const tool = register();
		const handle = makeHandle();
		const { ctx, scrollBy, listenerRef, componentRef } = driveWithListener(handle, (done) => {
			// 20-row transcript viewport - 4 (host page overlap).
			expect(listenerRef.current?.(PAGE_UP)).toEqual({ consume: true });
			expect(listenerRef.current?.(PAGE_DOWN)).toEqual({ consume: true });
			expect(scrollBy).toHaveBeenNthCalledWith(1, -16);
			expect(scrollBy).toHaveBeenNthCalledWith(2, 16);
			// The overlay stayed focused: the dialog is still the rendered component.
			expect(componentRef.current!.render(120).length).toBeGreaterThan(1);
			done({ answers: [], cancelled: true });
		});
		await tool.execute?.("tc", params as never, undefined as never, undefined as never, ctx);
	});

	it("scrolls the transcript on SGR wheel events", async () => {
		const tool = register();
		const handle = makeHandle();
		const { ctx, scrollBy, listenerRef } = driveWithListener(handle, (done) => {
			expect(listenerRef.current?.(WHEEL_UP)).toEqual({ consume: true });
			expect(listenerRef.current?.(WHEEL_DOWN)).toEqual({ consume: true });
			expect(scrollBy).toHaveBeenNthCalledWith(1, -3);
			expect(scrollBy).toHaveBeenNthCalledWith(2, 3);
			done({ answers: [], cancelled: true });
		});
		await tool.execute?.("tc", params as never, undefined as never, undefined as never, ctx);
	});

	it("leaves scroll keys to another focused overlay (visible but unfocused questionnaire)", async () => {
		const tool = register();
		const handle = makeHandle({ isFocused: () => false });
		const { ctx, scrollBy, listenerRef } = driveWithListener(handle, (done) => {
			expect(listenerRef.current?.(PAGE_UP)).toBeUndefined();
			expect(listenerRef.current?.(WHEEL_UP)).toBeUndefined();
			expect(scrollBy).not.toHaveBeenCalled();
			done({ answers: [], cancelled: true });
		});
		await tool.execute?.("tc", params as never, undefined as never, undefined as never, ctx);
	});

	it("stops scrolling once the overlay is hidden", async () => {
		const tool = register();
		const handle = makeHandle();
		const { ctx, scrollBy, listenerRef } = driveWithListener(handle, (done) => {
			handle.setHidden(true);
			expect(listenerRef.current?.(PAGE_UP)).toBeUndefined();
			expect(scrollBy).not.toHaveBeenCalled();
			done({ answers: [], cancelled: true });
		});
		await tool.execute?.("tc", params as never, undefined as never, undefined as never, ctx);
	});

	it("registers the scroll listener even with collapseKey 'off' and tears it down", async () => {
		writeCollapseKeyConfig("off");
		const tool = register();
		const handle = makeHandle();
		const { ctx, onTerminalInput, removers, scrollBy, listenerRef } = driveWithListener(handle, (done) => {
			expect(listenerRef.current?.(PAGE_UP)).toEqual({ consume: true });
			expect(scrollBy).toHaveBeenCalledWith(-16);
			done({ answers: [], cancelled: true });
		});
		await tool.execute?.("tc", params as never, undefined as never, undefined as never, ctx);
		// Only the scroll listener exists when collapse is disabled.
		expect(onTerminalInput).toHaveBeenCalledTimes(1);
		expect(removers).toHaveLength(1);
		expect(removers[0]).toHaveBeenCalledTimes(1);
	});

	it("leaves PgUp/PgDn to the dialog's option-list paging on a host without a scrollable viewport", async () => {
		const tool = register();
		const handle = makeHandle();
		const manyOptions = {
			questions: [
				{
					question: "Pick one",
					header: "Choice",
					options: Array.from({ length: 8 }, (_, i) => ({ label: `Option ${i + 1}` })),
				},
			],
		};
		const { ctx, scrollBy, listenerRef, componentRef } = driveWithListener(
			handle,
			(done) => {
				// Not consumed by the raw listener, so pi-tui forwards it to the dialog.
				expect(listenerRef.current?.(PAGE_DOWN)).toBeUndefined();
				componentRef.current!.handleInput(PAGE_DOWN);
				componentRef.current!.handleInput("\r");
				expect(scrollBy).not.toHaveBeenCalled();
			},
			{ scrollable: false },
		);
		const result = (await tool.execute?.(
			"tc",
			manyOptions as never,
			undefined as never,
			undefined as never,
			ctx,
		)) as { details: { answers: Array<{ answer: unknown }> } };
		// PAGE_STEP (5) rows down from the first option.
		expect(result.details.answers[0]?.answer).toBe("Option 6");
	});
});
