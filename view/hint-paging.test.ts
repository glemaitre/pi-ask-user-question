import { describe, expect, it } from "vitest";
import { PAGE_STEP } from "../state/key-router.js";
import { makeQuestionnaireState } from "../test-fixtures.js";
import type { QuestionData } from "../tool/types.js";
import { HINT_PART_CANCEL } from "./dialog-builder.js";
import { buildHintText } from "./tab-content-strategy.js";

function q(n: number): QuestionData {
	return {
		question: "Pick?",
		header: "H",
		options: Array.from({ length: n }, (_, i) => ({ label: `O${i}`, description: "" })),
	};
}

describe("buildHintText — no option-list paging hint", () => {
	// On Pi's fullscreen host PgUp/PgDn scroll the transcript behind the dialog
	// (state/transcript-scroll.ts), so advertising "PgUp/PgDn to page" would lie.
	it.each([PAGE_STEP, PAGE_STEP + 1, 20])("omits the paging hint with %i options", (n) => {
		const hint = buildHintText(q(n), false, makeQuestionnaireState(), "ctrl+]");
		expect(hint).not.toMatch(/PgUp|PgDn/);
		expect(hint).toContain(HINT_PART_CANCEL);
	});
});
