import "server-only";
import type { ActionResult } from "../domain";

export function errorDetails(error: unknown) {
  if (!error || typeof error !== "object") return { message: "", code: "UNKNOWN" };
  const details = error as { message?: unknown; code?: unknown; name?: unknown };
  return {
    message: typeof details.message === "string" ? details.message : "",
    code:
      typeof details.code === "string"
        ? details.code
        : typeof details.name === "string"
          ? details.name
          : "UNKNOWN",
  };
}

export function databaseRejectedMutation(error: unknown) {
  return /^(P\d{4}|23\d{3})$/.test(errorDetails(error).code);
}

export function failure(error: unknown, operation: string): ActionResult<never> {
  const { message, code } = errorDetails(error);
  console.error(`[recipes] Échec de ${operation}`, { code });

  if (message.includes("PLAN_CHANGED"))
    return {
      ok: false,
      error: "Les plats ont changé sur un autre appareil. Actualisez la page puis réessayez.",
    };
  if (message.includes("LIST_CHANGED"))
    return {
      ok: false,
      error: "La liste a changé sur un autre appareil. Actualisez la page avant de continuer.",
    };
  if (message.includes("RECIPE_CHANGED"))
    return {
      ok: false,
      error: "Cette recette a été modifiée sur un autre appareil. Rechargez-la avant de continuer.",
    };
  if (message.includes("CREATE_ATTEMPT_CHANGED"))
    return {
      ok: false,
      error:
        "Une première version a déjà été enregistrée. Rechargez le carnet pour la retrouver avant de la modifier.",
    };
  if (message.includes("NOT_FOUND"))
    return { ok: false, error: "Cet élément n’est plus disponible. Actualisez la page." };
  return { ok: false, error: "L’enregistrement a échoué. Vérifiez votre connexion et réessayez." };
}
