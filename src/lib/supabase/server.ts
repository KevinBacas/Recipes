import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getConfig } from "./config";
import type { AppDatabase } from "./database";

export async function createClient() {
  const cookieStore = await cookies();
  const { url, key } = getConfig();
  return createServerClient<AppDatabase>(url, key, {
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(values) {
        try {
          values.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          /* Server Components are read-only; proxy refreshes the session. */
        }
      },
    },
  });
}
