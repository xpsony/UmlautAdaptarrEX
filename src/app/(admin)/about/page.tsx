import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ExternalLink, Heart, Star } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { ChangelogSection } from "@/components/changelog-section";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatAppVersionLabel, resolveAppVersion } from "@/lib/version";
import pkg from "../../../../package.json";

// Forks override these via build-time env vars (e.g. NEXT_PUBLIC_GITHUB_OWNER
// in `.env.production`). The defaults match the upstream repository.
const GITHUB_OWNER = process.env.NEXT_PUBLIC_GITHUB_OWNER ?? "xpsony";
const GITHUB_REPO = process.env.NEXT_PUBLIC_GITHUB_REPO ?? "UmlautAdaptarrEX";
const REPO_SLUG = `${GITHUB_OWNER}/${GITHUB_REPO}`;
const REPO_URL = `https://github.com/${REPO_SLUG}`;
const DISCORD_URL = "https://discord.gg/src6zcH4rr";
const PCJONES_REPO_URL = "https://github.com/PCJones/UmlautAdaptarr";
const XOPEZ_URL = "https://github.com/xopez";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("about");
  return { title: t("title") };
}

export default async function AboutPage() {
  const t = await getTranslations("about");
  const version = resolveAppVersion(process.env.APP_VERSION, pkg.version);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <BrandMark variant="mark" height={56} />
            <div className="leading-tight">
              <CardTitle className="text-lg">UmlautAdaptarrEX</CardTitle>
              <CardDescription>{t("tagline")}</CardDescription>
              <div className="mt-1 text-[11px] tracking-wider text-muted-foreground">
                {formatAppVersionLabel(version)}
              </div>
            </div>
          </div>
          <div className="text-sm text-muted-foreground sm:text-right">
            <span className="text-muted-foreground/70">{t("authorLabel")}</span>{" "}
            <span className="font-medium text-foreground">Lexfi</span>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("linksTitle")}</CardTitle>
          <CardDescription>{t("linksHint")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="group flex items-start gap-3 rounded-lg border bg-card p-4 transition-colors hover:bg-accent/60"
          >
            <GithubIcon className="mt-0.5 h-6 w-6 shrink-0 text-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <span className="truncate">{t("githubTitle")}</span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{REPO_SLUG}</p>
              <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Star className="h-3.5 w-3.5 text-amber-500" />
                <span>{t("githubStars")}</span>
              </p>
            </div>
          </a>

          <a
            href={DISCORD_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="group flex items-start gap-3 rounded-lg border bg-card p-4 transition-colors hover:bg-accent/60"
          >
            <DiscordIcon className="mt-0.5 h-6 w-6 shrink-0 text-[#5865F2]" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <span className="truncate">{t("discordTitle")}</span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{t("discordHint")}</p>
            </div>
          </a>
        </CardContent>
      </Card>

      <ChangelogSection prominent />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Heart className="h-4 w-4 text-rose-500" />
            {t("creditsTitle")}
          </CardTitle>
          <CardDescription>{t("creditsHint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">{t("creditsBody")}</p>
          <a
            href={PCJONES_REPO_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="group inline-flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm transition-colors hover:bg-accent/60"
          >
            <GithubIcon className="h-4 w-4 text-foreground" />
            <span className="font-medium">PCJones/UmlautAdaptarr</span>
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-foreground" />
          </a>
          <p className="text-xs text-muted-foreground">{t("creditsApi")}</p>
          <p className="text-muted-foreground">{t("creditsTruenas")}</p>
          <a
            href={XOPEZ_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="group inline-flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm transition-colors hover:bg-accent/60"
          >
            <GithubIcon className="h-4 w-4 text-foreground" />
            <span className="font-medium">xopez</span>
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-foreground" />
          </a>
        </CardContent>
      </Card>
    </div>
  );
}

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 256 199" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M216.856 16.597A208.502 208.502 0 0 0 164.042 0c-2.275 4.113-4.933 9.645-6.766 14.046c-19.692-2.961-39.203-2.961-58.533 0c-1.832-4.4-4.55-9.933-6.846-14.046a207.809 207.809 0 0 0-52.855 16.638C5.618 67.147-3.443 116.4 1.087 164.956c22.169 16.555 43.653 26.612 64.775 33.193A158.404 158.404 0 0 0 79.735 175.3a136.413 136.413 0 0 1-21.846-10.632c1.833-1.356 3.626-2.772 5.358-4.229c42.122 19.702 87.89 19.702 129.51 0c1.751 1.457 3.544 2.873 5.357 4.229a136.07 136.07 0 0 1-21.886 10.652c4.006 8.02 8.638 15.67 13.873 22.848c21.142-6.58 42.646-16.637 64.815-33.213c5.316-56.288-9.08-105.09-38.056-148.36ZM85.474 135.095c-12.645 0-23.015-11.805-23.015-26.18s10.149-26.2 23.015-26.2c12.867 0 23.236 11.804 23.015 26.2c.02 14.375-10.148 26.18-23.015 26.18Zm85.051 0c-12.645 0-23.014-11.805-23.014-26.18s10.148-26.2 23.014-26.2c12.867 0 23.236 11.804 23.015 26.2c0 14.375-10.148 26.18-23.015 26.18Z" />
    </svg>
  );
}
