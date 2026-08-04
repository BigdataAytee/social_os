import { Suspense } from "react";
import type { Metadata } from "next";

import { AuthForm } from "@/components/auth/auth-form";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Sign in · SocialOS" };

export default function LoginPage() {
  return (
    <Suspense fallback={<Skeleton className="h-72 w-full" />}>
      <AuthForm mode="login" />
    </Suspense>
  );
}
