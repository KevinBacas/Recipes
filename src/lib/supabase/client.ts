"use client";
import { createBrowserClient } from "@supabase/ssr";
import { getConfig } from "./config";
import type { AppDatabase } from "./database";
export function createClient() {
  const { url, key } = getConfig();
  return createBrowserClient<AppDatabase>(url, key);
}
