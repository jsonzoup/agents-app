import { forward } from "@/server/core";

/** Apps' own web applications, proxied by the platform after it checks who may use them. */
export const GET = forward;
export const HEAD = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
export const OPTIONS = forward;
