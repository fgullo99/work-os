// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import DashboardError from "./error";

afterEach(cleanup);

describe("DashboardError (dashboard/error.tsx)", () => {
  it("muestra un mensaje recuperable en vez de la pantalla en blanco, con el digest si esta presente", () => {
    const error = Object.assign(new Error("getDashboardData fallo"), { digest: "1612785857" });
    render(<DashboardError error={error} reset={() => {}} />);

    expect(screen.getByText("No se pudo cargar el Dashboard")).toBeInTheDocument();
    expect(screen.getByText("1612785857")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("sin digest, muestra el fallback en vez de undefined", () => {
    const error = new Error("fallo sin digest");
    render(<DashboardError error={error} reset={() => {}} />);
    expect(screen.getByText("sin digest")).toBeInTheDocument();
  });

  it("el boton Reintentar llama a reset()", () => {
    const reset = vi.fn();
    const error = new Error("fallo");
    render(<DashboardError error={error} reset={reset} />);

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("loguea el error (digest/message/stack) para poder localizarlo en los logs de Vercel", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = Object.assign(new Error("boom"), { digest: "abc123" });
    render(<DashboardError error={error} reset={() => {}} />);

    expect(consoleSpy).toHaveBeenCalledWith(
      "[dashboard/error]",
      expect.objectContaining({ digest: "abc123", message: "boom" })
    );
    consoleSpy.mockRestore();
  });
});
