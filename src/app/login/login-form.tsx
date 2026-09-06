"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, LogIn } from "lucide-react";
import { type LoginInput, LoginSchema } from "@/schemas/auth";
import {
  type ApiError,
  apiFetch,
  SESSION_EXPIRED_FLAG,
} from "@/app/_lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RevealableInput } from "@/components/ui/revealable-input";

export function LoginForm() {
  const t = useTranslations("login");
  const router = useRouter();
  const searchParams = useSearchParams();
  const { register, handleSubmit, formState } = useForm<LoginInput>({
    resolver: zodResolver(LoginSchema),
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    let expired = false;
    try {
      if (sessionStorage.getItem(SESSION_EXPIRED_FLAG) === "1") {
        sessionStorage.removeItem(SESSION_EXPIRED_FLAG);
        expired = true;
      }
    } catch {
      /* sessionStorage can throw in private tabs - ignore */
    }
    if (searchParams.get("expired") === "1") expired = true;
    if (expired) toast.warning(t("sessionExpired"));
  }, [t, searchParams]);

  const onSubmit = async (values: LoginInput) => {
    try {
      await apiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(values),
      });
      const next = searchParams.get("next");
      const target =
        next && next.startsWith("/") && !next.startsWith("//")
          ? next
          : "/dashboard";
      router.push(target);
    } catch (err) {
      const e = err as ApiError;
      if (e.status === 429) toast.error(t("rateLimited"));
      else toast.error(t("invalid"));
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="username">{t("username")}</Label>
        <Input
          id="username"
          autoComplete="username"
          autoFocus
          aria-invalid={!!formState.errors.username}
          {...register("username")}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">{t("password")}</Label>
        <RevealableInput
          id="password"
          autoComplete="current-password"
          aria-invalid={!!formState.errors.password}
          showLabel={t("showPassword")}
          hideLabel={t("hidePassword")}
          {...register("password")}
        />
      </div>
      <Button
        type="submit"
        className="w-full"
        disabled={formState.isSubmitting}
      >
        {formState.isSubmitting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <LogIn className="h-4 w-4" />
        )}
        {t("submit")}
      </Button>
    </form>
  );
}

export function LoginFormSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="space-y-2">
        <div className="h-4 w-20 animate-pulse rounded bg-muted" />
        <div className="h-9 w-full animate-pulse rounded bg-muted" />
      </div>
      <div className="space-y-2">
        <div className="h-4 w-20 animate-pulse rounded bg-muted" />
        <div className="h-9 w-full animate-pulse rounded bg-muted" />
      </div>
      <div className="h-9 w-full animate-pulse rounded bg-muted" />
    </div>
  );
}
