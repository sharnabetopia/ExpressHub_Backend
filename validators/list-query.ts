import { z } from "zod";

const positiveInteger = (maximum: number) => z.string().regex(/^[1-9]\d*$/)
  .transform(Number).pipe(z.number().int().max(maximum));

export const paginationFields = {
  page: positiveInteger(1_000_000).default(1),
  limit: positiveInteger(100).default(20),
};
export const searchQuery = z.string().trim().min(1).max(100).optional();
export const sortOrder = z.enum(["asc", "desc"]).default("desc");
export const dateRangeFields = {
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
};
export function validDateRange(value: { from?: string; to?: string }) {
  return !value.from || !value.to || Date.parse(value.from) <= Date.parse(value.to);
}
export const dateRangeError = { message: "from must be no later than to", path: ["from"] };
