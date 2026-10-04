import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_OPTIONS, DEFAULT_MAX_QUESTIONS, type QuestionParams } from "./types.js";
import {
	ERROR_TOO_MANY_OPTIONS,
	ERROR_TOO_MANY_QUESTIONS,
	tooManyOptionsMessage,
	tooManyQuestionsMessage,
	validateQuestionnaire,
} from "./validate-questionnaire.js";

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

function withOptions(n: number): QuestionParams {
	return {
		questions: [
			{
				question: "Q?",
				header: "H",
				options: Array.from({ length: n }, (_, i) => ({ label: `O${i}`, description: `d${i}` })),
			},
		],
	};
}

describe("validateQuestionnaire — option cap", () => {
	it("defaults to DEFAULT_MAX_OPTIONS", () => {
		expect(validateQuestionnaire(withOptions(DEFAULT_MAX_OPTIONS))).toEqual({ ok: true });
		expect(validateQuestionnaire(withOptions(DEFAULT_MAX_OPTIONS + 1))).toEqual({
			ok: false,
			error: "too_many_options",
			message: ERROR_TOO_MANY_OPTIONS,
		});
	});

	it("honours an explicit cap", () => {
		expect(validateQuestionnaire(withOptions(40), undefined, 40)).toEqual({ ok: true });
		expect(validateQuestionnaire(withOptions(5), undefined, 4)).toEqual({
			ok: false,
			error: "too_many_options",
			message: tooManyOptionsMessage(4),
		});
	});

	it("checks the minimum before the maximum", () => {
		expect(validateQuestionnaire(withOptions(1), undefined, 4).ok).toBe(false);
		expect(validateQuestionnaire(withOptions(1), undefined, 4)).toMatchObject({ error: "empty_options" });
	});
});
