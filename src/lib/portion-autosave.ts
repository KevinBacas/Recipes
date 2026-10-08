import { SERVINGS_MAX, SERVINGS_MIN, type ActionResult } from "./domain";

type Save = (servings: number) => Promise<ActionResult>;
export type PortionSnapshot = {
  value: string;
  status: "saved" | "waiting" | "saving" | "invalid" | "error";
  error: string;
};

function parseServings(value: string): number | null {
  const number = Number(value);
  return value.trim() && Number.isInteger(number) && number >= SERVINGS_MIN && number <= SERVINGS_MAX ? number : null;
}

/** One ordered save queue per dish, shared by typing, blur and list generation. */
export class PortionAutosave {
  private confirmed: number;
  private snapshot: PortionSnapshot;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private request: Promise<boolean> | undefined;
  private needsConfirmation = false;

  constructor(servings: number, private save: Save, private delay = 350) {
    this.confirmed = servings;
    this.snapshot = { value: String(servings), status: "saved", error: "" };
  }

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(snapshot: PortionSnapshot) {
    this.snapshot = snapshot;
    this.listeners.forEach(listener => listener());
  }

  setValue(value: string) {
    clearTimeout(this.timer);
    const servings = parseServings(value);
    if (servings === null) {
      this.publish({ value, status: "invalid", error: "Indiquez un nombre entier de 1 à 1 000." });
    } else if (servings === this.confirmed && !this.request && !this.needsConfirmation) {
      this.publish({ value, status: "saved", error: "" });
    } else {
      this.publish({ value, status: this.request ? "saving" : "waiting", error: "" });
      this.timer = setTimeout(() => { void this.flush(); }, this.delay);
    }
  }

  reconcile(servings: number) {
    // Background refreshes must not overwrite a local edit or a save in progress.
    if (this.snapshot.status !== "saved" || this.request || this.confirmed === servings) return;
    this.confirmed = servings;
    this.publish({ value: String(servings), status: "saved", error: "" });
  }

  async flush(): Promise<boolean> {
    clearTimeout(this.timer);
    if (this.request) return this.request;
    if (parseServings(this.snapshot.value) === null) return false;
    this.request = this.drain();
    try { return await this.request; }
    finally { this.request = undefined; }
  }

  private async drain(): Promise<boolean> {
    while (true) {
      const value = this.snapshot.value;
      const servings = parseServings(value);
      if (servings === null) return false;
      if (servings === this.confirmed && !this.needsConfirmation) {
        this.publish({ value: String(servings), status: "saved", error: "" });
        return true;
      }
      this.publish({ value, status: "saving", error: "" });
      let result: ActionResult;
      try { result = await this.save(servings); }
      catch { result = { ok: false, error: "Les portions n’ont pas été enregistrées. Vérifiez votre connexion puis réessayez." }; }
      if (result.ok) { this.confirmed = servings; this.needsConfirmation = false; }
      else this.needsConfirmation = true;
      if (!result.ok && this.snapshot.value === value) {
        this.publish({ value, status: "error", error: result.error });
        return false;
      }
      // A newer value may have been entered during the request. Save it next.
      clearTimeout(this.timer);
    }
  }

  discard() {
    clearTimeout(this.timer);
    this.publish({ value: String(this.confirmed), status: this.needsConfirmation ? "error" : "saved", error: this.needsConfirmation ? "Les portions n’ont pas été confirmées. Réessayez l’enregistrement." : "" });
  }

  leave() {
    // Navigation should also commit a valid edit made just before leaving.
    void this.flush();
  }
}
