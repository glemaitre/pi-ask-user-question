import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createMockPi } from "./test/utils/index.js";
import { beforeEach, describe, expect, it } from "vitest";
import {
	buildPromptGuidelines,
	buildPromptSnippet,
	DEFAULT_PROMPT_GUIDELINES,
	DEFAULT_PROMPT_SNIPPET,
	DEFAULT_TOOL_DESCRIPTION,
	registerAskUserQuestionTool,
} from "./ask-user-question.js";

const TOOL_NAME = "ask_user_question";
const CONFIG_PATH = join(process.env.HOME!, ".config", "pi-ask-user-question", "config.json");
const DEFAULT_GUIDELINES_LENGTH = DEFAULT_PROMPT_GUIDELINES.length;

function writeConfig(data: Record<string, unknown>): void {
	mkdirSync(dirname(CONFIG_PATH), { recursive: true });
	writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), "utf-8");
}

beforeEach(() => {
	// test/setup.ts rmSyncs CONFIG_PATH in shared beforeEach
});

describe("DEFAULT_PROMPT_GUIDELINES — custom-answer contract", () => {
	it("describes the Type something row as appended to every question without stale fallback terms", () => {
		const joined = DEFAULT_PROMPT_GUIDELINES.join("\n");
		expect(joined).toContain('automatically appended "Type something." row on every question');
		expect(joined).toContain("Esc to abandon");
		expect(joined).not.toContain('"Other" free-text fallback');
		expect(joined).not.toContain("Chat about this");
	});
});
it("describes the all-question custom-answer contract in the registered tool", () => {
	const { pi, captured } = createMockPi();
	registerAskUserQuestionTool(pi);
	const tool = captured.tools.get(TOOL_NAME)!;
	expect(tool.description).toContain('automatically appended "Type something." row on every question');
	expect(tool.description).toContain("reserved labels are rejected at runtime");
});

describe("registerAskUserQuestionTool — guidance overrides", () => {
	it("uses built-in defaults when no config file exists", () => {
		const { pi, captured } = createMockPi();
		registerAskUserQuestionTool(pi);
		const tool = captured.tools.get(TOOL_NAME)!;
		expect(tool.promptSnippet).toBe(DEFAULT_PROMPT_SNIPPET);
		expect((tool.promptGuidelines as string[]).length).toBe(DEFAULT_GUIDELINES_LENGTH);
	});

	it("uses built-in defaults when config has no guidance field", () => {
		writeConfig({ otherField: true });
		const { pi, captured } = createMockPi();
		registerAskUserQuestionTool(pi);
		const tool = captured.tools.get(TOOL_NAME)!;
		expect(tool.promptSnippet).toBe(DEFAULT_PROMPT_SNIPPET);
	});

	it("overrides promptSnippet with valid value", () => {
		writeConfig({ guidance: { promptSnippet: "Custom ask snippet" } });
		const { pi, captured } = createMockPi();
		registerAskUserQuestionTool(pi);
		const tool = captured.tools.get(TOOL_NAME)!;
		expect(tool.promptSnippet).toBe("Custom ask snippet");
		expect((tool.promptGuidelines as string[]).length).toBe(DEFAULT_GUIDELINES_LENGTH);
	});

	it("overrides promptGuidelines with valid value", () => {
		writeConfig({ guidance: { promptGuidelines: ["Rule one", "Rule two"] } });
		const { pi, captured } = createMockPi();
		registerAskUserQuestionTool(pi);
		const tool = captured.tools.get(TOOL_NAME)!;
		expect(tool.promptSnippet).toBe(DEFAULT_PROMPT_SNIPPET);
		expect(tool.promptGuidelines).toEqual(["Rule one", "Rule two"]);
	});

	it("overrides both promptSnippet and promptGuidelines", () => {
		writeConfig({ guidance: { promptSnippet: "Custom", promptGuidelines: ["Rule"] } });
		const { pi, captured } = createMockPi();
		registerAskUserQuestionTool(pi);
		const tool = captured.tools.get(TOOL_NAME)!;
		expect(tool.promptSnippet).toBe("Custom");
		expect(tool.promptGuidelines).toEqual(["Rule"]);
	});

	it("falls back to defaults on empty promptSnippet", () => {
		writeConfig({ guidance: { promptSnippet: "" } });
		const { pi, captured } = createMockPi();
		registerAskUserQuestionTool(pi);
		const tool = captured.tools.get(TOOL_NAME)!;
		expect(tool.promptSnippet).toBe(DEFAULT_PROMPT_SNIPPET);
	});

	it("falls back to defaults on wrong types", () => {
		writeConfig({ guidance: { promptSnippet: 123, promptGuidelines: "not-array" } });
		const { pi, captured } = createMockPi();
		registerAskUserQuestionTool(pi);
		const tool = captured.tools.get(TOOL_NAME)!;
		expect(tool.promptSnippet).toBe(DEFAULT_PROMPT_SNIPPET);
		expect((tool.promptGuidelines as string[]).length).toBe(DEFAULT_GUIDELINES_LENGTH);
	});

	it("falls back to defaults on promptGuidelines with empty string item", () => {
		writeConfig({ guidance: { promptGuidelines: ["valid", ""] } });
		const { pi, captured } = createMockPi();
		registerAskUserQuestionTool(pi);
		const tool = captured.tools.get(TOOL_NAME)!;
		expect((tool.promptGuidelines as string[]).length).toBe(DEFAULT_GUIDELINES_LENGTH);
	});

	it("overrides tool description with valid value", () => {
		writeConfig({ guidance: { description: "Custom ask tool description" } });
		const { pi, captured } = createMockPi();
		registerAskUserQuestionTool(pi);
		const tool = captured.tools.get(TOOL_NAME)!;
		expect(tool.description).toBe("Custom ask tool description");
		expect(tool.promptSnippet).toBe(DEFAULT_PROMPT_SNIPPET);
	});

	it("uses the built-in tool description when no config file exists", () => {
		const { pi, captured } = createMockPi();
		registerAskUserQuestionTool(pi);
		const tool = captured.tools.get(TOOL_NAME)!;
		expect(tool.description).toBe(DEFAULT_TOOL_DESCRIPTION);
	});

	it("falls back to the built-in tool description on empty description", () => {
		writeConfig({ guidance: { description: "" } });
		const { pi, captured } = createMockPi();
		registerAskUserQuestionTool(pi);
		const tool = captured.tools.get(TOOL_NAME)!;
		expect(tool.description).toBe(DEFAULT_TOOL_DESCRIPTION);
	});

	it("falls back to the built-in tool description on non-string description", () => {
		writeConfig({ guidance: { description: 123 } });
		const { pi, captured } = createMockPi();
		registerAskUserQuestionTool(pi);
		const tool = captured.tools.get(TOOL_NAME)!;
		expect(tool.description).toBe(DEFAULT_TOOL_DESCRIPTION);
	});
});

describe("registerAskUserQuestionTool — maxQuestions", () => {
	function questions(n: number) {
		return Array.from({ length: n }, (_, i) => ({
			question: `Q${i}?`,
			header: `H${i}`,
			options: [
				{ label: "A", description: "a" },
				{ label: "B", description: "b" },
			],
		}));
	}

	it("advertises the default cap (12) in snippet, guidelines and schema", () => {
		const { pi, captured } = createMockPi();
		registerAskUserQuestionTool(pi);
		const tool = captured.tools.get(TOOL_NAME)!;
		expect(tool.promptSnippet).toContain("up to 12 structured questions");
		expect((tool.promptGuidelines as string[])[0]).toContain("up to 12 questions per invocation");
		const params = tool.parameters as { properties: { questions: { maxItems: number } } };
		expect(params.properties.questions.maxItems).toBe(12);
	});

	it("threads a configured cap through snippet, guidelines, schema and validation", async () => {
		writeConfig({ maxQuestions: 5 });
		const { pi, captured } = createMockPi();
		registerAskUserQuestionTool(pi);
		const tool = captured.tools.get(TOOL_NAME)!;
		expect(tool.promptSnippet).toBe(buildPromptSnippet(5));
		expect(tool.promptGuidelines).toEqual(buildPromptGuidelines(5));
		const params = tool.parameters as { properties: { questions: { maxItems: number } } };
		expect(params.properties.questions.maxItems).toBe(5);

		const ctx = { hasUI: true, ui: { custom: async () => null } };
		const r = (await tool.execute?.(
			"tc",
			{ questions: questions(6) } as never,
			undefined as never,
			undefined as never,
			ctx as never,
		)) as { details: { error?: string }; content: Array<{ text: string }> };
		expect(r.details.error).toBe("too_many_questions");
		expect(r.content[0]?.text).toContain("At most 5 questions");
	});

	it("keeps a user-supplied promptSnippet verbatim even with a custom cap", () => {
		writeConfig({ maxQuestions: 5, guidance: { promptSnippet: "Mine" } });
		const { pi, captured } = createMockPi();
		registerAskUserQuestionTool(pi);
		expect(captured.tools.get(TOOL_NAME)!.promptSnippet).toBe("Mine");
	});
});
