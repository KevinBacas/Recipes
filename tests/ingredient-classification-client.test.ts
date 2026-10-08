import { describe, expect, it, vi } from "vitest";
import type { Aisle } from "@/lib/domain";
import {
  IngredientClassificationController,
  requestIngredientClassification,
  type IngredientClassificationStatus,
} from "@/lib/ingredient-classification-client";
import type { IngredientClassification } from "@/lib/ingredient-classification";
import { blankLine, type IngredientLine } from "@/lib/recipe-draft";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function harness(classify = vi.fn<(name: string) => Promise<IngredientClassification>>()) {
  const suggestions: Array<{ key: string; name: string; aisle: Aisle }> = [];
  const statuses = new Map<string, IngredientClassificationStatus | null>();
  const controller = new IngredientClassificationController({
    classify,
    onSuggestion: (key, name, aisle) => suggestions.push({ key, name, aisle }),
    onStatus: (key, status) => statuses.set(key, status),
  });
  return { controller, suggestions, statuses, classify };
}

describe("ingredient classification client", () => {
  it("validates response data and treats HTTP or schema errors as unavailable", async () => {
    const valid = await requestIngredientClassification(
      "Pois chiches",
      async () => new Response(JSON.stringify({ aisle: "pantry", source: "ai" }), { status: 200 }),
    );
    expect(valid).toEqual({ aisle: "pantry", source: "ai" });

    const invalid = await requestIngredientClassification(
      "Pois chiches",
      async () =>
        new Response(JSON.stringify({ aisle: "not-an-aisle", source: "ai" }), { status: 200 }),
    );
    expect(invalid).toEqual({ aisle: null, source: "unavailable" });

    const failed = await requestIngredientClassification(
      "Pois chiches",
      async () => new Response(null, { status: 503 }),
    );
    expect(failed).toEqual({ aisle: null, source: "unavailable" });
  });

  it("aborts a request after the client timeout and returns no suggestion", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetcher: typeof fetch = (_input, init) => {
      signal = init?.signal as AbortSignal | undefined;
      return new Promise<Response>(() => {});
    };
    try {
      const result = requestIngredientClassification("Pois chiches", fetcher);
      await vi.advanceTimersByTimeAsync(7_000);
      await expect(result).resolves.toEqual({ aisle: null, source: "unavailable" });
      expect(signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the catalog aisle without calling the classifier", async () => {
    const classify = vi.fn();
    const { controller, statuses, suggestions } = harness(classify);
    const line = {
      ...blankLine("known"),
      ingredient_id: "00000000-0000-4000-8000-000000000001",
      name: "Tomates",
      aisle: "produce" as const,
    };
    await controller.prepareSubmit([line]);

    expect(classify).not.toHaveBeenCalled();
    expect(statuses.get("known")).toBe("catalog");
    expect(suggestions).toEqual([]);
  });

  it("deduplicates normalized names when submitting unblurred lines", async () => {
    const pending = deferred<IngredientClassification>();
    const classify = vi.fn(() => pending.promise);
    const { controller, suggestions, statuses } = harness(classify);
    const lines = [
      { ...blankLine("one"), name: "Pois chiches" },
      { ...blankLine("two"), name: " pois   chiches " },
    ];

    const submission = controller.prepareSubmit(lines);
    expect(classify).toHaveBeenCalledTimes(1);
    expect(classify).toHaveBeenCalledWith("Pois chiches");
    expect(statuses.get("one")).toBe("pending");
    expect(statuses.get("two")).toBe("pending");
    pending.resolve({ aisle: "pantry", source: "ai" });
    await submission;

    expect(suggestions).toEqual([
      { key: "one", name: "pois chiches", aisle: "pantry" },
      { key: "two", name: "pois chiches", aisle: "pantry" },
    ]);
  });

  it("ignores a response after the name changes or the line is removed", async () => {
    const pending = deferred<IngredientClassification>();
    const { controller, suggestions } = harness(vi.fn(() => pending.promise));
    const staleRename = controller.classifyLine("renamed", "Pois chiches");
    const staleRemoval = controller.classifyLine("removed", "Pois chiches");
    controller.updateLine("renamed", "Haricots rouges");
    controller.removeLine("removed");
    pending.resolve({ aisle: "pantry", source: "ai" });
    await Promise.all([staleRename, staleRemoval]);

    expect(suggestions).toEqual([]);
  });

  it("keeps the user's manual aisle when a pending result arrives", async () => {
    const pending = deferred<IngredientClassification>();
    const { controller, suggestions, statuses } = harness(vi.fn(() => pending.promise));
    controller.updateLine("line", "Poivron rouge");
    const request = controller.classifyLine("line", "Poivron rouge");
    controller.markManual("line");
    pending.resolve({ aisle: "produce", source: "ai" });
    await request;

    expect(suggestions).toEqual([]);
    expect(statuses.get("line")).toBe("manual");
  });

  it("invalidates requests from a reloaded draft, even when a line key and name return", async () => {
    const older = deferred<IngredientClassification>();
    const current = deferred<IngredientClassification>();
    const classify = vi
      .fn()
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(current.promise);
    const { controller, suggestions } = harness(classify);
    const draftLine: IngredientLine = { ...blankLine("line"), name: "Poivron rouge" };
    const oldRequest = controller.classifyLine("line", draftLine.name);

    controller.replaceLines([draftLine]);
    const submission = controller.prepareSubmit([draftLine]);
    expect(classify).toHaveBeenCalledTimes(2);
    older.resolve({ aisle: "produce", source: "ai" });
    await oldRequest;
    expect(suggestions).toEqual([]);

    current.resolve({ aisle: "produce", source: "ai" });
    await submission;
    expect(suggestions).toEqual([{ key: "line", name: "poivron rouge", aisle: "produce" }]);
  });

  it("lets submission continue when the classifier rejects", async () => {
    const { controller, statuses } = harness(vi.fn().mockRejectedValue(new Error("offline")));
    await expect(
      controller.prepareSubmit([{ ...blankLine("line"), name: "Pois chiches" }]),
    ).resolves.toBeUndefined();
    expect(statuses.get("line")).toBe("unavailable");
  });

  it("ignores an outstanding response after the form is disposed", async () => {
    const pending = deferred<IngredientClassification>();
    const { controller, suggestions } = harness(vi.fn(() => pending.promise));
    const request = controller.classifyLine("line", "Tomates cerises");
    controller.dispose();
    pending.resolve({ aisle: "produce", source: "ai" });
    await request;

    expect(suggestions).toEqual([]);
  });
});
