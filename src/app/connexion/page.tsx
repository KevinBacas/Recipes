import { LoginForm } from "@/components/login-form";
import { isConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
export default async function Login() {
  if (isConfigured()) {
    const client = await createClient();
    const { data } = await client.auth.getClaims();
    if (data?.claims?.sub) redirect("/recettes");
  }
  return <LoginForm configured={isConfigured()}/>;
}
