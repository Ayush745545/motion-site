import { z } from "zod";
import { ProjectDocumentSchema } from "./project";
import { MotionConfigSchema } from "./schema";

/** Both render entry points validate the exact document used by the Player. */
export const RenderInputSchema = z.union([
  z.object({ document: ProjectDocumentSchema }).strict(),
  MotionConfigSchema,
]);
export type RenderInput = z.infer<typeof RenderInputSchema>;
