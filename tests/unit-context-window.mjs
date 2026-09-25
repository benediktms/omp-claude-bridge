import test from "node:test";
import assert from "node:assert/strict";

import { buildModels, buildVariantModels, claudeCodeModelId, parseVariantId } from "../src/models.ts";

const MODELS = [
	{ id: "claude-opus-5-5", name: "Opus 5.5", contextWindow: 1_000_000 },
	{ id: "claude-fable-5-1", name: "Fable 5.1", contextWindow: 1_000_000 },
	{ id: "claude-sonnet-5", name: "Sonnet 5", contextWindow: 1_000_000 },
	{ id: "claude-haiku-4-5", name: "Haiku 4.5", contextWindow: 200_000 },
];

const settings = (contextWindow) => ({ plan: "pro", longContextExtraUsage: false, contextWindow });

test("buildModels exposes only the current Claude Code model set in picker order", () => {
	const models = buildModels([
		{ id: "claude-opus-4-8", name: "Opus 4.8" },
		...MODELS.toReversed(),
	]);

	assert.deepEqual(models.map((model) => model.id), [
		"claude-opus-5-5",
		"claude-fable-5-1",
		"claude-sonnet-5",
		"claude-haiku-4-5",
	]);
});

test("each current model exposes its Claude Code context window", () => {
	const models = buildVariantModels(MODELS, settings("auto"));
	assert.deepEqual(
		models.map(({ id, name, contextWindow }) => ({ id, name, contextWindow })),
		[
			{ id: "claude-opus-5-5", name: "Opus 5.5 (1M)", contextWindow: 1_000_000 },
			{ id: "claude-fable-5-1", name: "Fable 5.1 (1M)", contextWindow: 1_000_000 },
			{ id: "claude-sonnet-5", name: "Sonnet 5 (1M)", contextWindow: 1_000_000 },
			{ id: "claude-haiku-4-5", name: "Haiku 4.5 (200K)", contextWindow: 200_000 },
		],
	);
});

test("model ids resolve to the aliases reported by Claude Code", () => {
	assert.equal(claudeCodeModelId({ id: "claude-opus-5-5" }, settings("auto")), "opus[1m]");
	assert.equal(claudeCodeModelId({ id: "claude-fable-5-1" }, settings("auto")), "claude-fable-5-1[1m]");
	assert.equal(claudeCodeModelId({ id: "claude-sonnet-5" }, settings("auto")), "sonnet");
	assert.equal(claudeCodeModelId({ id: "claude-haiku-4-5" }, settings("auto")), "haiku");
});

test("forced context windows reject models without that runtime", () => {
	assert.throws(() => claudeCodeModelId({ id: "claude-haiku-4-5-1m" }, settings("auto")));
	assert.throws(() => claudeCodeModelId({ id: "claude-opus-5-5-200k" }, settings("auto")));
	assert.throws(() => claudeCodeModelId({ id: "claude-fable-5-1" }, settings("200k")));
});

test("parseVariantId does not mistake Fable 5.1 for a context suffix", () => {
	assert.deepEqual(parseVariantId("claude-fable-5-1"), { baseId: "claude-fable-5-1" });
	assert.deepEqual(parseVariantId("claude-fable-5-1-1m"), { baseId: "claude-fable-5-1", forced: "1m" });
});
