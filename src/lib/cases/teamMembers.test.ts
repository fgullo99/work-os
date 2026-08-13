import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getInternalTeamMembers } from "./teamMembers";

const ORIGINAL = process.env.INTERNAL_TEAM_MEMBERS;

describe("getInternalTeamMembers", () => {
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.INTERNAL_TEAM_MEMBERS;
    else process.env.INTERNAL_TEAM_MEMBERS = ORIGINAL;
  });

  it("parsea nombre + email entre <>", () => {
    process.env.INTERNAL_TEAM_MEMBERS = "Felipe <felipe@tmcsudamerica.com.ar>,Thomas <thomas@tmcsudamerica.com.ar>";
    const members = getInternalTeamMembers();
    expect(members).toEqual([
      { name: "Felipe", email: "felipe@tmcsudamerica.com.ar" },
      { name: "Thomas", email: "thomas@tmcsudamerica.com.ar" },
    ]);
  });

  it("normaliza el email a minusculas", () => {
    process.env.INTERNAL_TEAM_MEMBERS = "Carolina <Carolina@TMCSudamerica.com.ar>";
    expect(getInternalTeamMembers()[0]?.email).toBe("carolina@tmcsudamerica.com.ar");
  });

  it("sin env var configurado devuelve array vacio, nunca inventa un roster", () => {
    delete process.env.INTERNAL_TEAM_MEMBERS;
    expect(getInternalTeamMembers()).toEqual([]);
  });

  it("ignora entradas vacias por comas de mas", () => {
    process.env.INTERNAL_TEAM_MEMBERS = "Felipe <felipe@x.com>,,Thomas <thomas@x.com>,";
    expect(getInternalTeamMembers()).toHaveLength(2);
  });
});
