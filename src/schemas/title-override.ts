import { z } from "zod";

export const MediaTypeSchema = z.enum(["tv", "movie", "audio", "book"]);

export const TitleOverridePutSchema = z.object({
  mediaType: MediaTypeSchema,
  externalId: z.string().min(1).max(256),
  germanTitle: z.string().trim().min(1).max(512),
});

export type TitleOverridePut = z.infer<typeof TitleOverridePutSchema>;
