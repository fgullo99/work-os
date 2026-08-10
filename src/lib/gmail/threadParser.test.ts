import { describe, expect, it } from "vitest";
import { determineDirection } from "./threadParser";

const USER_ADDRESSES = ["felipe@tmcsudamerica.com.ar", "felipe.alias@tmcsudamerica.com.ar"];

describe("determineDirection", () => {
  it("un mensaje del propio usuario es OUTBOUND", () => {
    expect(determineDirection("felipe@tmcsudamerica.com.ar", USER_ADDRESSES)).toBe("OUTBOUND");
  });

  it("es case-insensitive", () => {
    expect(determineDirection("Felipe@TMCSudamerica.com.ar", USER_ADDRESSES)).toBe("OUTBOUND");
  });

  it("reconoce un alias corporativo configurado", () => {
    expect(determineDirection("felipe.alias@tmcsudamerica.com.ar", USER_ADDRESSES)).toBe("OUTBOUND");
  });

  it("un mensaje de un tercero es INBOUND", () => {
    expect(determineDirection("cliente@techint.com", USER_ADDRESSES)).toBe("INBOUND");
  });

  it("una direccion que solo se parece pero no matchea exacto es INBOUND", () => {
    expect(determineDirection("notfelipe@tmcsudamerica.com.ar", USER_ADDRESSES)).toBe("INBOUND");
  });
});
