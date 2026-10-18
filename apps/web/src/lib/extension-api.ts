import { z } from "zod";

export async function extensionRequest<T>(
  action: string,
  body: unknown,
  schema: z.ZodType<T>,
): Promise<T> {
  const response = await fetch(`/api/extensions/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const value: unknown = await response.json();
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(value);
    throw new Error(
      error.success
        ? error.data.error
        : "Couldn't reach Kitchenbinder. Please try again.",
    );
  }
  return schema.parse(value);
}
