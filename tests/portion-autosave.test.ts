import { afterEach, describe, expect, it, vi } from "vitest";
import { PortionAutosave } from "@/lib/portion-autosave";
import type { ActionResult } from "@/lib/domain";

const success: ActionResult = { ok: true, data: undefined };
afterEach(() => vi.useRealTimers());

describe("enregistrement automatique des portions", () => {
  it("regroupe une saisie rapide en une seule sauvegarde", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => success);
    const draft = new PortionAutosave(2, save);
    draft.setValue("1");
    draft.setValue("12");
    draft.setValue("120");
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(350);
    expect(save).toHaveBeenCalledExactlyOnceWith(120);
    expect(draft.getSnapshot().status).toBe("saved");
  });

  it("la génération peut sauvegarder immédiatement sans attendre le délai", async () => {
    const save = vi.fn(async () => success);
    const draft = new PortionAutosave(2, save);
    draft.setValue("4");
    expect(await draft.flush()).toBe(true);
    expect(save).toHaveBeenCalledExactlyOnceWith(4);
  });

  it("ordonne les requêtes et conserve une saisie faite pendant une sauvegarde", async () => {
    let finish!: (result: ActionResult) => void;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<ActionResult>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(success);
    const draft = new PortionAutosave(2, save);
    draft.setValue("3");
    const saving = draft.flush();
    draft.setValue("10");
    draft.reconcile(3);
    expect(draft.getSnapshot().value).toBe("10");
    expect(save).toHaveBeenCalledTimes(1);
    finish(success);
    expect(await saving).toBe(true);
    expect(save.mock.calls.map((call) => call[0])).toEqual([3, 10]);
    expect(draft.getSnapshot()).toMatchObject({ value: "10", status: "saved" });
  });

  it("enregistre le retour à la valeur initiale après une requête déjà partie", async () => {
    let finish!: (result: ActionResult) => void;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<ActionResult>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(success);
    const draft = new PortionAutosave(2, save);
    draft.setValue("3");
    const saving = draft.flush();
    draft.setValue("2");
    finish(success);
    await saving;
    expect(save.mock.calls.map((call) => call[0])).toEqual([3, 2]);
  });

  it("bloque les valeurs vides, fractionnelles et hors limites", async () => {
    const save = vi.fn(async () => success);
    const draft = new PortionAutosave(2, save);
    for (const value of ["", "0", "-1", "1.5", "1001"]) {
      draft.setValue(value);
      expect(await draft.flush()).toBe(false);
      expect(draft.getSnapshot().status).toBe("invalid");
    }
    expect(save).not.toHaveBeenCalled();
  });

  it("conserve la saisie échouée et permet de la réessayer", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValue(success);
    const draft = new PortionAutosave(2, save);
    draft.setValue("4");
    expect(await draft.flush()).toBe(false);
    expect(draft.getSnapshot()).toMatchObject({ value: "4", status: "error" });
    draft.reconcile(2);
    expect(draft.getSnapshot().value).toBe("4");
    expect(await draft.flush()).toBe(true);
    expect(draft.getSnapshot().status).toBe("saved");
  });

  it("applique un changement distant sans écraser une modification locale", async () => {
    const draft = new PortionAutosave(2, async () => success);
    draft.reconcile(5);
    expect(draft.getSnapshot().value).toBe("5");
    draft.setValue("6");
    draft.reconcile(8);
    expect(draft.getSnapshot().value).toBe("6");
    await draft.flush();
  });

  it("réenregistre la valeur initiale après une réponse perdue, même si la première écriture a pu réussir", async () => {
    let stored = 2;
    const save = vi.fn(async (servings: number) => {
      stored = servings;
      if (servings === 4) throw new Error("response lost after commit");
      return success;
    });
    const draft = new PortionAutosave(2, save);
    draft.setValue("4");
    expect(await draft.flush()).toBe(false);
    expect(stored).toBe(4);
    draft.setValue("2");
    expect(await draft.flush()).toBe(true);
    expect(stored).toBe(2);
    expect(save.mock.calls.map((call) => call[0])).toEqual([4, 2]);
  });

  it("enregistre une modification faite juste avant de quitter l’écran", async () => {
    const save = vi.fn(async () => success);
    const draft = new PortionAutosave(2, save);
    draft.setValue("7");
    draft.leave();
    await vi.waitFor(() => expect(draft.getSnapshot().status).toBe("saved"));
    expect(save).toHaveBeenCalledExactlyOnceWith(7);
  });
});
