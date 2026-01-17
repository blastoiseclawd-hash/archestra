import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const DEFAULT_BACKEND_URL = "http://localhost:9000";

/**
 * Get the backend API base URL at runtime.
 *
 * Priority:
 * 1. ARCHESTRA_API_BASE_URL (server-side env var)
 * 2. Default: http://localhost:9000
 */
function getBackendBaseUrl(): string {
  return process.env.ARCHESTRA_API_BASE_URL || DEFAULT_BACKEND_URL;
}

/**
 * Next.js proxy handler for routing API requests to the backend.
 *
 * This replaces static rewrites in next.config.ts which are baked in at build time.
 * By using the proxy file, we can read ARCHESTRA_API_BASE_URL at runtime, enabling
 * split deployments where the backend URL is only known at deployment time (e.g., K8s service discovery).
 *
 * Routes handled:
 * - /api/* -> backend /api/* (except /api/auth/* which uses a dedicated route handler)
 * - /v1/* -> backend /v1/*
 * - /health -> backend /health
 *
 * Note: /api/auth/* is handled by app/api/auth/[...path]/route.ts for proper Origin header handling.
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (shouldLogApiRequest(req)) {
    // biome-ignore lint/suspicious/noConsole: Intentional console log of API requests
    console.log(`API Request: ${req.method} ${req.nextUrl.href}`);
  }

  // Skip /api/auth/* - handled by dedicated route handler for SAML Origin header handling
  if (pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  // Skip /api/archestra-catalog/* - handled by static rewrite to external MCP catalog service
  if (pathname.startsWith("/api/archestra-catalog")) {
    return NextResponse.next();
  }

  // Proxy /api/* requests to backend
  if (pathname.startsWith("/api/")) {
    return proxyToBackend(req, pathname);
  }

  // Proxy /v1/* requests to backend
  if (pathname.startsWith("/v1/")) {
    return proxyToBackend(req, pathname);
  }

  // Proxy /health requests to backend
  if (pathname === "/health") {
    return proxyToBackend(req, pathname);
  }

  return NextResponse.next();
}

/**
 * Rewrite the request to the backend URL.
 */
function proxyToBackend(request: NextRequest, pathname: string): NextResponse {
  const backendUrl = getBackendBaseUrl();
  const url = new URL(pathname, backendUrl);
  url.search = request.nextUrl.search;

  return NextResponse.rewrite(url);
}

const shouldLogApiRequest = (req: NextRequest) => {
  const { pathname } = req.nextUrl;
  // ignore nextjs internal requests
  if (pathname.startsWith("/_next")) {
    return false;
  }
  // log request before it is proxied via nextjs rewrites
  return (
    pathname.startsWith("/api") ||
    pathname.startsWith("/v1") ||
    pathname === "/health"
  );
};
