import { describe, expect, it } from "vitest";
import { PAGE_STEP } from "../state/key-router.js";
import { makeQuestionnaireState } from "../test-fixtures.js";
import type { QuestionData } from "../tool/types.js";
import { HINT_PART_CANCEL, HINT_PART_NAV, HINT_PART_PAGE } from "./dialog-builder.js";
import { buildHintText } from "./tab-content-strategy.js";

function q(n: number): QuestionData {
	return {
		question: "Pick?",
		header: "H",
		options: Array.from({ length: n }, (_, i) => ({ label: `O${i}`, description: "" })),
	};
}

describe("buildHintText — paging hint", () => {
	it("is omitted on short questions", () => {
		expect(buildHintText(q(PAGE_STEP), false, makeQuestionnaireState(), "ctrl+]")).not.toContain(HINT_PART_PAGE);
	});

	it("follows cancel on long questions so the resting core is never clipped first", () => {
		const hint = buildHintText(q(PAGE_STEP + 1), false, makeQuestionnaireState(), "ctrl+]");
		expect(hint).toContain(`${HINT_PART_CANCEL} · ${HINT_PART_PAGE}`);
		expect(hint.indexOf(HINT_PART_NAV)).toBeLessThan(hint.indexOf(HINT_PART_PAGE));
	});
});
