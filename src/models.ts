// Canonical selection + display order for the model picker.
// `resolveModel` returns the first partial match, so `opus` resolves to the first-listed opus entry.
// Extracted from index.ts so tests can import without activating the extension.

export const MODEL_IDS_IN_ORDER = ["claude-opus-5-5", "claude-fable-5-1", "claude-sonnet-5", "claude-haiku-4-5"];

// Claude Code exposes xhigh and max separately for the adaptive-thinking models.
const DEFAULT_THINKING_LEVEL_MAPS: Record<string, Record<string, string>> = {
	"claude-opus-5-5": { xhigh: "xhigh" },
	"claude-fable-5-1": { xhigh: "xhigh" },
	"claude-sonnet-5": { xhigh: "xhigh" },
};

// Project pi-ai's model entries down to the fields OMP's registerProvider expects,
// and keep MODEL_IDS_IN_ORDER ordering. IDs missing from pi-ai are silently dropped.
// Context-dependent display labels are applied after plan/long-context config is known.
export function buildModels<T extends { id: string; [key: string]: any }>(piAiModels: T[]) {
	return MODEL_IDS_IN_ORDER
		.map((id) => piAiModels.find((m) => m.id === id))
		.filter((m) => m != null)
		// Forward per-model overrides so the bridge can preserve Claude Code's
		// distinct xhigh and max effort tiers.
		.map(({ id, name, reasoning, input, contextWindow, maxTokens, thinkingLevelMap }) => ({
			id,
			name,
			reasoning, input, contextWindow, maxTokens,
			thinkingLevelMap: thinkingLevelMap ?? DEFAULT_THINKING_LEVEL_MAPS[id],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		}));
}

// User-selectable context-window policy (see provider.contextWindow in config).
//   "auto"  - per-model default policy (measured SDK behavior).
//   "1m"    - force 1M: only register 1M-capable models, request [1m] where needed.
//   "200k"  - force 200K: only register 200K-capable models, request bare model ids.
export type ContextWindowMode = "auto" | "1m" | "200k";

export type LongContextSettings = {
	plan: "pro" | "max";
	longContextExtraUsage: boolean;
	contextWindow: ContextWindowMode;
};

export type ClaudeCodeRuntimeModel = {
	cliModelId: string;
	contextWindow: number;
};

const TWO_HUNDRED_K_CONTEXT = 200_000;
const ONE_M_CONTEXT = 1_000_000;

// Claude Code's supportedModels API is authoritative for the runtime aliases and
// context windows below. Returns null when the requested window is unavailable.
export function resolveClaudeCodeRuntimeModel(modelId: string, settings: LongContextSettings): ClaudeCodeRuntimeModel | null {
	switch (settings.contextWindow) {
		case "1m":
			return resolveForcedOneMRuntimeModel(modelId);
		case "200k":
			return resolveForcedTwoHundredKRuntimeModel(modelId);
		case "auto":
			return resolveAutoRuntimeModel(modelId, settings);
	}
}

function resolveAutoRuntimeModel(modelId: string, _settings: LongContextSettings): ClaudeCodeRuntimeModel {
	switch (modelId) {
		case "claude-opus-5-5":
			return { cliModelId: "opus[1m]", contextWindow: ONE_M_CONTEXT };
		case "claude-fable-5-1":
			return { cliModelId: "claude-fable-5-1[1m]", contextWindow: ONE_M_CONTEXT };
		case "claude-sonnet-5":
			return { cliModelId: "sonnet", contextWindow: ONE_M_CONTEXT };
		case "claude-haiku-4-5":
			return { cliModelId: "haiku", contextWindow: TWO_HUNDRED_K_CONTEXT };
		default:
			console.error(`claude-bridge: encountered model ${modelId} with no known context size, defaulting to 200K`);
			return { cliModelId: modelId, contextWindow: TWO_HUNDRED_K_CONTEXT };
	}
}

function resolveForcedOneMRuntimeModel(modelId: string): ClaudeCodeRuntimeModel | null {
	switch (modelId) {
		case "claude-opus-5-5":
			return { cliModelId: "opus[1m]", contextWindow: ONE_M_CONTEXT };
		case "claude-fable-5-1":
			return { cliModelId: "claude-fable-5-1[1m]", contextWindow: ONE_M_CONTEXT };
		case "claude-sonnet-5":
			return { cliModelId: "sonnet", contextWindow: ONE_M_CONTEXT };
		case "claude-haiku-4-5":
			return null;
		default:
			console.error(`claude-bridge: encountered model ${modelId} with no known 1M runtime, hiding it`);
			return null;
	}
}

function resolveForcedTwoHundredKRuntimeModel(modelId: string): ClaudeCodeRuntimeModel | null {
	switch (modelId) {
		case "claude-haiku-4-5":
			return { cliModelId: "haiku", contextWindow: TWO_HUNDRED_K_CONTEXT };
		case "claude-opus-5-5":
		case "claude-fable-5-1":
		case "claude-sonnet-5":
			return null;
		default:
			console.error(`claude-bridge: encountered model ${modelId} with no known 200K runtime, hiding it`);
			return null;
	}
}

// Split a registered picker id into its base model id and the forced window it
// encodes. Variant ids carry a "-1m"/"-200k" suffix (see buildVariantModels); the
// unsuffixed id maps to the config default. Base ids never end in those suffixes,
// so the split is unambiguous.
export function parseVariantId(id: string): { baseId: string; forced?: "1m" | "200k" } {
	if (id.endsWith("-1m")) return { baseId: id.slice(0, -3), forced: "1m" };
	if (id.endsWith("-200k")) return { baseId: id.slice(0, -5), forced: "200k" };
	return { baseId: id };
}

export function claudeCodeModelId(model: { id: string }, settings: LongContextSettings): string {
	const { baseId, forced } = parseVariantId(model.id);
	const runtimeModel = forced === "1m"
		? resolveForcedOneMRuntimeModel(baseId)
		: forced === "200k"
			? resolveForcedTwoHundredKRuntimeModel(baseId)
			: resolveClaudeCodeRuntimeModel(baseId, settings);
	if (runtimeModel == null) {
		const requested = forced ?? settings.contextWindow;
		throw new Error(`claude-bridge: model ${model.id} has no Claude Code runtime (contextWindow=${requested})`);
	}
	return runtimeModel.cliModelId;
}

export function resolveModel<T extends { id: string }>(models: T[], input: string): T | undefined {
	const lower = input.toLowerCase();
	return models.find((m) => m.id === lower || m.id.includes(lower));
}

function variantName(baseName: string, contextWindow: number): string {
	const label = contextWindow === ONE_M_CONTEXT ? "1M" : "200K";
	// Strip any window hint pi-ai already baked into the name so we don't double it.
	const base = baseName.replace(/\s*(?:\((?:1M|200K)\)|\b1M\b)\s*$/i, "").trimEnd();
	return `${base} (${label})`;
}

// Expand each model into one registered entry per context window it supports, so
// the user picks the window on demand from OMP's model picker. The unsuffixed id
// (e.g. claude-opus-4-8) maps to the config default window; every other available
// window gets a "-1m"/"-200k" suffixed id. Each entry's contextWindow must match
// the window the bridge actually requests (see claudeCodeModelId), or OMP's status
// bar and auto-compaction threshold will misreport. Both windows stay pickable
// regardless of provider.contextWindow, which only picks the default.
export function buildVariantModels<T extends { id: string; name: string; contextWindow?: number | null }>(
	models: T[],
	settings: LongContextSettings,
): T[] {
	const result: T[] = [];
	for (const m of models) {
		// Unknown model (not in the model tables): keep one default-path entry.
		// Done before the forced-resolver probes below, which log "hiding it" on
		// unknown ids — misleading noise for a model we actually keep.
		if (!MODEL_IDS_IN_ORDER.includes(m.id)) {
			const runtimeModel = resolveClaudeCodeRuntimeModel(m.id, settings);
			if (runtimeModel != null) result.push({ ...m, contextWindow: runtimeModel.contextWindow, name: variantName(m.name, runtimeModel.contextWindow) });
			continue;
		}

		// Known models always have at least one available window.
		const available: Array<{ kind: "1m" | "200k"; contextWindow: number }> = [];
		if (resolveForcedOneMRuntimeModel(m.id) != null) available.push({ kind: "1m", contextWindow: ONE_M_CONTEXT });
		if (resolveForcedTwoHundredKRuntimeModel(m.id) != null) available.push({ kind: "200k", contextWindow: TWO_HUNDRED_K_CONTEXT });

		// The config default decides which window is unsuffixed; fall back to the sole
		// available window when the preferred one has no runtime (e.g. Haiku under
		// "1m", Opus 4.7 under "200k").
		const defaultRuntime = resolveClaudeCodeRuntimeModel(m.id, settings);
		const preferredKind: "1m" | "200k" | undefined = defaultRuntime == null
			? undefined
			: defaultRuntime.contextWindow === ONE_M_CONTEXT ? "1m" : "200k";
		const defaultKind = preferredKind != null && available.some((a) => a.kind === preferredKind)
			? preferredKind
			: available[0].kind;

		const ordered = [
			...available.filter((a) => a.kind === defaultKind),
			...available.filter((a) => a.kind !== defaultKind),
		];
		for (const { kind, contextWindow } of ordered) {
			const id = kind === defaultKind ? m.id : `${m.id}-${kind}`;
			result.push({ ...m, id, contextWindow, name: variantName(m.name, contextWindow) });
		}
	}
	return result;
}
