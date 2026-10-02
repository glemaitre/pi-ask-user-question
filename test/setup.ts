import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach } from "vitest";

// Isolate every test run from the developer's real ~/.config.
const TEST_HOME = mkdtempSync(join(tmpdir(), "pi-auq-test-home-"));
process.env.HOME = TEST_HOME;
process.env.USERPROFILE = TEST_HOME;
delete process.env.PI_CODING_AGENT_DIR;
delete process.env.XDG_CONFIG_HOME;

const I18N_SYMBOL = Symbol.for("rpiv-i18n");

beforeEach(() => {
	delete process.env.PI_CODING_AGENT_DIR;
	delete process.env.XDG_CONFIG_HOME;
	delete (globalThis as Record<symbol, unknown>)[I18N_SYMBOL];
	rmSync(join(TEST_HOME, ".pi", "agent"), { recursive: true, force: true });
	rmSync(join(TEST_HOME, ".config", "pi-ask-user-question", "config.json"), { force: true });
	rmSync(join(TEST_HOME, ".config", "rpiv-ask-user-question", "config.json"), { force: true });
});
