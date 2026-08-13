export interface InternalTeamMember {
  name: string;
  email: string;
}

/** Formato: "Felipe <felipe@tmcsudamerica.com.ar>,Thomas <thomas@tmcsudamerica.com.ar>" — mismo
 * patron que getUserAddresses() en src/lib/gmail/sync.ts. Se le muestra al AI Case Analyzer
 * para que distinga actividad del equipo interno de accion de Felipe (item 30 del pedido). */
export function getInternalTeamMembers(): InternalTeamMember[] {
  const raw = process.env.INTERNAL_TEAM_MEMBERS ?? "";
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const match = entry.match(/^(.+?)\s*<(.+?)>$/);
      if (!match) return { name: entry, email: "" };
      return { name: match[1]!.trim(), email: match[2]!.trim().toLowerCase() };
    });
}
