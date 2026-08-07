import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function ok<T>(data: T): Response {
  return json(data, 200);
}

export function created<T>(data: T): Response {
  return json(data, 201);
}

export function json<T>(data: T, status = 200): Response {
  return Response.json(data, { status });
}

export function badRequest(message: string): Response {
  return json({ error: message }, 400);
}

export function notFound(message = "Not found"): Response {
  return json({ error: message }, 404);
}

export function unauthorized(message = "Authentication required"): Response {
  return json({ error: message }, 401);
}

export function forbidden(message = "Forbidden"): Response {
  return json({ error: message }, 403);
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

export function handleError(e: unknown): Response {
  if (e instanceof HttpError) return json({ error: e.message }, e.status);
  if (e instanceof ZodError) {
    return json({ error: "Invalid request", issues: e.issues }, 400);
  }
  if (e instanceof Error) {
    console.error(e);
    return json({ error: e.message }, 500);
  }
  console.error(e);
  return json({ error: "Internal server error" }, 500);
}
