import { app } from "@/server/app";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = (request: Request) => app.fetch(request);

export { handler as GET, handler as POST, handler as DELETE, handler as PUT, handler as PATCH };
