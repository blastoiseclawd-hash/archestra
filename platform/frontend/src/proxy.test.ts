import { NextRequest } from "next/server";
import { proxy } from "./proxy";

/**
 * Helper to create a mock NextRequest
 */
function createMockRequest(options: {
  method?: string;
  url: string;
  headers?: Record<string, string>;
}): NextRequest {
  const { method = "GET", url, headers = {} } = options;
  const request = new NextRequest(new URL(url, "http://localhost:3000"), {
    method,
    headers: new Headers(headers),
  });
  return request;
}

describe("proxy", () => {
  const originalEnv = {
    ARCHESTRA_API_BASE_URL: process.env.ARCHESTRA_API_BASE_URL,
  };

  beforeEach(() => {
    // Reset env vars before each test
    delete process.env.ARCHESTRA_API_BASE_URL;
    // Suppress console.log during tests
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore original env vars
    if (originalEnv.ARCHESTRA_API_BASE_URL) {
      process.env.ARCHESTRA_API_BASE_URL = originalEnv.ARCHESTRA_API_BASE_URL;
    } else {
      delete process.env.ARCHESTRA_API_BASE_URL;
    }
    vi.restoreAllMocks();
  });

  describe("backend API proxying", () => {
    it("should rewrite /api/* requests to backend (default URL)", () => {
      const request = createMockRequest({
        method: "GET",
        url: "/api/profiles",
      });

      const response = proxy(request);

      expect(response.headers.get("x-middleware-rewrite")).toContain(
        "localhost:9000/api/profiles",
      );
    });

    it("should rewrite /api/* requests to backend (custom URL)", () => {
      process.env.ARCHESTRA_API_BASE_URL = "http://backend-service:9000";

      const request = createMockRequest({
        method: "GET",
        url: "/api/profiles",
      });

      const response = proxy(request);

      expect(response.headers.get("x-middleware-rewrite")).toContain(
        "backend-service:9000/api/profiles",
      );
    });

    it("should rewrite /v1/* requests to backend", () => {
      const request = createMockRequest({
        method: "POST",
        url: "/v1/chat/completions",
      });

      const response = proxy(request);

      expect(response.headers.get("x-middleware-rewrite")).toContain(
        "localhost:9000/v1/chat/completions",
      );
    });

    it("should rewrite /health requests to backend", () => {
      const request = createMockRequest({
        method: "GET",
        url: "/health",
      });

      const response = proxy(request);

      expect(response.headers.get("x-middleware-rewrite")).toContain(
        "localhost:9000/health",
      );
    });

    it("should preserve query parameters in rewrite", () => {
      const request = createMockRequest({
        method: "GET",
        url: "/api/profiles?page=1&limit=10",
      });

      const response = proxy(request);

      const rewriteUrl = response.headers.get("x-middleware-rewrite");
      expect(rewriteUrl).toContain("page=1");
      expect(rewriteUrl).toContain("limit=10");
    });
  });

  describe("routes passed through to other handlers", () => {
    it("should pass through /api/auth/* requests (handled by route handler)", () => {
      const request = createMockRequest({
        method: "POST",
        url: "/api/auth/sign-in/email",
      });

      const response = proxy(request);

      // NextResponse.next() returns a response that continues the middleware chain
      expect(response.headers.get("x-middleware-next")).toBe("1");
    });

    it("should pass through /api/auth/sso/* requests", () => {
      const request = createMockRequest({
        method: "POST",
        url: "/api/auth/sso/saml2/sp/acs/MyProvider",
        headers: { Origin: "null" },
      });

      const response = proxy(request);

      expect(response.headers.get("x-middleware-next")).toBe("1");
    });

    it("should pass through /api/archestra-catalog/* requests (handled by static rewrite)", () => {
      const request = createMockRequest({
        method: "GET",
        url: "/api/archestra-catalog/servers",
      });

      const response = proxy(request);

      expect(response.headers.get("x-middleware-next")).toBe("1");
    });
  });

  describe("non-API requests", () => {
    it("should pass through page requests", () => {
      const request = createMockRequest({
        method: "GET",
        url: "/settings",
      });

      const response = proxy(request);

      expect(response.headers.get("x-middleware-next")).toBe("1");
    });

    it("should pass through static asset requests", () => {
      const request = createMockRequest({
        method: "GET",
        url: "/_next/static/chunk.js",
      });

      const response = proxy(request);

      expect(response.headers.get("x-middleware-next")).toBe("1");
    });
  });

  describe("API request logging", () => {
    it("should log /api requests", () => {
      const consoleSpy = vi.spyOn(console, "log");
      const request = createMockRequest({
        method: "GET",
        url: "/api/profiles",
      });

      proxy(request);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("API Request: GET"),
      );
    });

    it("should log /v1 requests", () => {
      const consoleSpy = vi.spyOn(console, "log");
      const request = createMockRequest({
        method: "POST",
        url: "/v1/chat/completions",
      });

      proxy(request);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("API Request: POST"),
      );
    });

    it("should log /health requests", () => {
      const consoleSpy = vi.spyOn(console, "log");
      const request = createMockRequest({
        method: "GET",
        url: "/health",
      });

      proxy(request);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("API Request: GET"),
      );
    });

    it("should not log /_next requests", () => {
      const consoleSpy = vi.spyOn(console, "log");
      const request = createMockRequest({
        method: "GET",
        url: "/_next/static/chunk.js",
      });

      proxy(request);

      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it("should not log non-API requests", () => {
      const consoleSpy = vi.spyOn(console, "log");
      const request = createMockRequest({
        method: "GET",
        url: "/settings",
      });

      proxy(request);

      expect(consoleSpy).not.toHaveBeenCalled();
    });
  });
});
