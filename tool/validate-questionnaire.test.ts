import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_QUESTIONS, type QuestionParams } from "./types.js";
import { ERROR_TOO_MANY_QUESTIONS, tooManyQuestionsMessage, validateQuestionnaire } from "./validate-questionnaire.js";

function params(n: number): QuestionParams {
	return {
		questions: Array.from({ length: n }, (_, i) => ({
			question: `Q${i}?`,
			header: `H${i}`,
			options: [
				{ label: "A", description: "a" },
				{ label: "B", description: "b" },
			],
		})),
	};
}

describe("validateQuestionnaire — question cap", () => {
	it("defaults to DEFAULT_MAX_QUESTIONS", () => {
		expect(validateQuestionnaire(params(DEFAULT_MAX_QUESTIONS))).toEqual({ ok: true });
		expect(validateQuestionnaire(params(DEFAULT_MAX_QUESTIONS + 1))).toEqual({
			ok: false,
			error: "too_many_questions",
			message: ERROR_TOO_MANY_QUESTIONS,
		});
	});

	it("honours an explicit cap", () => {
		expect(validateQuestionnaire(params(30), 30)).toEqual({ ok: true });
		expect(validateQuestionnaire(params(4), 3)).toEqual({
			ok: false,
			error: "too_many_questions",
			message: tooManyQuestionsMessage(3),
		});
	});
});
