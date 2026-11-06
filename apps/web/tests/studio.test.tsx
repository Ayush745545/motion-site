// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ServiceStatus } from "../src/components/service-status";
const health = { status: "ok", service: "motion-dna-ai-api", version: "0.1.0", environment: "test" };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("local service status", () => {
  it("shows an accessible loading state", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<ServiceStatus/>);
    expect(screen.getByRole("heading", { name: "Local services" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Checking…" }).hasAttribute("disabled")).toBe(true);
  });
  it("shows live API and database results, and rechecks on demand", async () => {
    const fetchMock = vi.fn((path: string) => Promise.resolve(Response.json(path === "/api/health" ? health : { status: "ok", database: "connected" })));
    vi.stubGlobal("fetch", fetchMock);
    render(<ServiceStatus/>);
    await screen.findByText("API connected");
    expect(screen.getAllByText("Connected")).toHaveLength(2);
    expect(screen.getByText(/API v0.1.0/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
  });
  it("reports an offline backend with an actionable local command", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
    render(<ServiceStatus/>);
    await screen.findByText("API offline");
    expect(screen.getByRole("status").textContent).toContain("pnpm dev:api");
    expect(screen.queryByText("Connected")).toBeNull();
  });
  it("keeps liveness separate from database readiness", async () => {
    vi.stubGlobal("fetch", vi.fn((path: string) => Promise.resolve(path === "/api/health" ? Response.json(health) : new Response(null, { status: 503 }))));
    render(<ServiceStatus/>);
    await screen.findByText("API connected");
    expect(screen.getByRole("status").textContent).toContain("pnpm db:up");
    expect(screen.getByText("Unavailable")).toBeTruthy();
  });
  it("recovers from an unavailable backend when the user retries", async () => {
    let online = false;
    const fetchMock = vi.fn((path: string) => online
      ? Promise.resolve(Response.json(path === "/api/health" ? health : { status: "ok", database: "connected" }))
      : Promise.reject(new Error("offline")));
    vi.stubGlobal("fetch", fetchMock);
    render(<ServiceStatus/>);
    await screen.findByText("API offline");
    online = true;
    fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
    await screen.findByText("API connected");
    expect(screen.getAllByText("Connected")).toHaveLength(2);
    expect(screen.queryByRole("status")).toBeNull();
  });

});
