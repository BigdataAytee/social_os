"use client";

import { createBrowserClient } from "@supabase/ssr";

import { supabaseEnv } from "./env";

/** Supabase client for Client Components (login/signup forms, sign-out). */
export function createClient() {
  const { url, anonKey } = supabaseEnv();
  return createBrowserClient(url, anonKey);
}
