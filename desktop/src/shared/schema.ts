import { z } from "zod";

const FolderSchema = z
  .object({ id: z.string().uuid(), path: z.string().min(1).max(4096) })
  .strict();
export const ProfileSchema = z
  .object({
    baselineName: z.string().trim().min(1).max(80),
    protectedVolumeIds: z.array(z.string().min(1).max(2048)).max(32),
    exclusions: z.array(FolderSchema).max(100),
  })
  .strict();
export const SettingsSchema = z
  .object({
    version: z.literal(1),
    revision: z.number().int().nonnegative(),
    profile: ProfileSchema,
    activity: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            time: z.string().datetime(),
            title: z.string().max(200),
            detail: z.string().max(2000),
            kind: z.enum(["info", "success", "warning"]),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
