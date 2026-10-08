import { normalizeIngredientName, type Aisle } from "@/lib/domain";
import {
  classificationRequestSchema,
  classificationResponseSchema,
  type IngredientClassification,
} from "@/lib/ingredient-classification";
import type { IngredientLine } from "@/lib/recipe-draft";

export type IngredientClassificationStatus =
  "pending" | "suggested" | "catalog" | "manual" | "unavailable";

type Classify = (name: string) => Promise<IngredientClassification>;

const REQUEST_TIMEOUT_MS = 7_000;

export async function requestIngredientClassification(
  name: string,
  fetcher: typeof fetch = fetch,
): Promise<IngredientClassification> {
  const request = classificationRequestSchema.safeParse({ name });
  if (!request.success) return { aisle: null, source: "unavailable" };

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutResult = new Promise<IngredientClassification>((resolve) => {
      timeout = setTimeout(() => {
        controller.abort();
        resolve({ aisle: null, source: "unavailable" });
      }, REQUEST_TIMEOUT_MS);
    });
    const requestResult = (async () => {
      const response = await fetcher("/api/ingredients/classify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request.data),
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) return { aisle: null, source: "unavailable" } as const;
      const parsed = classificationResponseSchema.safeParse(await response.json());
      return parsed.success ? parsed.data : ({ aisle: null, source: "unavailable" } as const);
    })();
    return await Promise.race([requestResult, timeoutResult]);
  } catch {
    return { aisle: null, source: "unavailable" };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

type LineState = {
  name: string;
  requestName: string;
  generation: number;
  knownAisle?: Aisle;
  manual: boolean;
};

type ControllerOptions = {
  classify?: Classify;
  onSuggestion: (key: string, name: string, aisle: Aisle) => void;
  onStatus: (key: string, status: IngredientClassificationStatus | null) => void;
};

/** Coordinates deduplicated requests and ignores results for an outdated line. */
export class IngredientClassificationController {
  private readonly classify: Classify;
  private readonly onSuggestion: ControllerOptions["onSuggestion"];
  private readonly onStatus: ControllerOptions["onStatus"];
  private readonly lines = new Map<string, LineState>();
  private readonly responses = new Map<string, IngredientClassification>();
  private readonly requests = new Map<string, Promise<IngredientClassification>>();
  private disposed = false;
  private generation = 0;

  constructor({
    classify = requestIngredientClassification,
    onSuggestion,
    onStatus,
  }: ControllerOptions) {
    this.classify = classify;
    this.onSuggestion = onSuggestion;
    this.onStatus = onStatus;
  }

  replaceLines(lines: IngredientLine[]) {
    const nextKeys = new Set(lines.map((line) => line.key));
    for (const key of this.lines.keys()) {
      if (!nextKeys.has(key)) this.onStatus(key, null);
    }
    this.lines.clear();
    // A reload starts a new draft epoch: outstanding requests cannot apply to it.
    this.responses.clear();
    this.requests.clear();
    for (const line of lines) {
      const knownAisle = line.ingredient_id ? line.aisle : undefined;
      this.lines.set(line.key, {
        name: normalizeIngredientName(line.name),
        requestName: line.name.trim(),
        generation: ++this.generation,
        knownAisle,
        manual: false,
      });
      this.onStatus(line.key, knownAisle ? "catalog" : null);
    }
  }

  updateLine(key: string, name: string, knownAisle?: Aisle) {
    const normalized = normalizeIngredientName(name);
    const previous = this.lines.get(key);
    if (!previous) {
      this.lines.set(key, {
        name: normalized,
        requestName: name.trim(),
        generation: ++this.generation,
        knownAisle,
        manual: false,
      });
      this.onStatus(key, knownAisle ? "catalog" : null);
      return;
    }

    if (previous.name !== normalized || previous.knownAisle !== knownAisle) {
      previous.name = normalized;
      previous.requestName = name.trim();
      previous.knownAisle = knownAisle;
      previous.manual = false;
      previous.generation = ++this.generation;
      this.onStatus(key, knownAisle ? "catalog" : null);
    }
  }

  markManual(key: string) {
    const state = this.lines.get(key);
    if (!state) return;
    state.manual = true;
    state.generation = ++this.generation;
    this.onStatus(key, "manual");
  }

  removeLine(key: string) {
    const state = this.lines.get(key);
    if (state) state.generation = ++this.generation;
    this.lines.delete(key);
    this.onStatus(key, null);
  }

  async classifyLine(key: string, name: string, knownAisle?: Aisle) {
    this.updateLine(key, name, knownAisle);
    const state = this.lines.get(key);
    if (!state || !state.name || state.knownAisle || state.manual || this.disposed) return;
    await this.classifyCurrent(key, state);
  }

  async prepareSubmit(lines: IngredientLine[]) {
    for (const line of lines) {
      this.updateLine(line.key, line.name, line.ingredient_id ? line.aisle : undefined);
    }
    const pending = lines
      .map((line) => {
        const state = this.lines.get(line.key);
        return state && state.name && !state.knownAisle && !state.manual
          ? this.classifyCurrent(line.key, state)
          : undefined;
      })
      .filter((request): request is Promise<void> => request !== undefined);
    await Promise.all(pending);
  }

  dispose() {
    this.disposed = true;
    this.lines.clear();
  }

  activate() {
    this.disposed = false;
  }

  private async classifyCurrent(key: string, state: LineState) {
    const name = state.name;
    const generation = state.generation;
    if (this.responses.has(name)) {
      this.applyResponse(key, name, generation, this.responses.get(name)!);
      return;
    }

    this.onStatus(key, "pending");
    let request = this.requests.get(name);
    if (!request) {
      request = this.classify(state.requestName).catch(() => ({
        aisle: null,
        source: "unavailable",
      }));
      this.requests.set(name, request);
      void request.then((response) => {
        if (this.requests.get(name) === request) {
          this.responses.set(name, response);
          this.requests.delete(name);
        }
      });
    }
    const response = await request;
    this.applyResponse(key, name, generation, response);
  }

  private applyResponse(
    key: string,
    name: string,
    generation: number,
    response: IngredientClassification,
  ) {
    const current = this.lines.get(key);
    if (
      this.disposed ||
      !current ||
      current.generation !== generation ||
      current.name !== name ||
      current.knownAisle ||
      current.manual
    )
      return;

    if (response.aisle) {
      this.onSuggestion(key, name, response.aisle);
      this.onStatus(key, response.source === "catalog" ? "catalog" : "suggested");
    } else {
      this.onStatus(key, "unavailable");
    }
  }
}
