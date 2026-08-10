import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Work OS",
  description: "Capa de atencion y seguimiento sobre tu trabajo.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
