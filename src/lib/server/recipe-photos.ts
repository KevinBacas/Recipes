import "server-only";
import type { authenticatedClient } from "../data";

export async function removeRecipePhoto(
  client: Awaited<ReturnType<typeof authenticatedClient>>["client"],
  path: string,
  operation: string,
) {
  try {
    const { error } = await client.storage.from("recipe-photos").remove([path]);
    if (error)
      console.error(`[recipes] Nettoyage de photo impossible après ${operation}`, {
        code: error.name,
      });
  } catch {
    console.error(`[recipes] Nettoyage de photo impossible après ${operation}`);
  }
}

export function imageMime(bytes: Uint8Array): { mime: string; extension: string } | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return { mime: "image/jpeg", extension: "jpg" };
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte))
    return { mime: "image/png", extension: "png" };
  if (
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
  ) {
    return { mime: "image/webp", extension: "webp" };
  }
  return null;
}
