import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** Keep the client-side workspace router addressable at stable nested paths. */
export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname === "/" || pathname.startsWith("/api/") || pathname.startsWith("/_next/") || pathname.startsWith("/media/"))
    return NextResponse.next();
  return NextResponse.rewrite(new URL("/", request.url));
}

export const config = {
  matcher: ["/((?!favicon.ico).*)"],
};
