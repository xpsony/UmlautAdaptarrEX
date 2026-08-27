import type { FastifyInstance } from "fastify";
import { prisma } from "@/lib/db";
import { BUILTIN_PLUGINS, getPlugin } from "@/domain/plugins";
import { requireAuth } from "@/server/auth/middleware";
import { getAppState } from "@/server/state";
import { type PluginListEntry, PluginToggleSchema } from "@/schemas/plugins";
import { parseOrReply } from "./_helpers";

export async function pluginRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/admin/plugins", { preHandler: requireAuth }, async () => {
    const rows = await prisma.plugin.findMany();
    const enabledMap = new Map(rows.map((r) => [r.id, r.enabled]));
    const list: PluginListEntry[] = BUILTIN_PLUGINS.map((p) => ({
      id: p.id,
      nameKey: p.nameKey,
      descriptionKey: p.descriptionKey,
      language: p.language,
      enabled: enabledMap.get(p.id) ?? p.defaultEnabled,
      defaultEnabled: p.defaultEnabled,
    }));
    return list;
  });

  app.patch(
    "/api/admin/plugins/:id",
    { preHandler: requireAuth },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const plugin = getPlugin(id);
      if (!plugin) {
        return reply.code(404).send({ error: "unknown_plugin" });
      }
      const data = parseOrReply(req.body, PluginToggleSchema, reply);
      if (!data) return;
      // Block enabling a non-DE language plugin when no usable TMDB key is
      // configured - pcjones speaks only German, so without TMDB the plugin
      // would just emit no language-specific variations. Failing fast here
      // prevents the user from seeing an "active" plugin that secretly does
      // nothing.
      if (data.enabled && plugin.language !== "de") {
        const state = getAppState();
        if (!state.tmdbAvailable) {
          return reply.code(422).send({
            error: "tmdb_required",
            language: plugin.language,
            message:
              `Plugin "${plugin.id}" needs TMDB titles in '${plugin.language}'. ` +
              `Configure a TMDB v3 API key in Settings → Providers first.`,
          });
        }
      }
      const before = await prisma.plugin.findUnique({ where: { id } });
      const enabledBefore = before?.enabled ?? plugin.defaultEnabled;
      await prisma.plugin.upsert({
        where: { id },
        create: { id, enabled: data.enabled },
        update: { enabled: data.enabled },
      });
      const changed = enabledBefore !== data.enabled;
      if (changed) await getAppState().reloadPlugins();
      return { id, enabled: data.enabled, requiresResync: changed };
    },
  );
}
