/**
 * Who is calling, in server code. The platform checks the person's access before forwarding a
 * request to this app and replaces these headers; the app never sees the platform's session.
 */
export interface Caller {
  id: string;
  name: string;
  /** System role ids. */
  roles: string[];
}

export function caller(headers: Headers): Caller | null {
  const id = headers.get("x-rsi-user-id");
  if (!id) return null;
  return { id, name: decodeURIComponent(headers.get("x-rsi-user-name") ?? id), roles: (headers.get("x-rsi-user-roles") ?? "").split(",").filter(Boolean) };
}
