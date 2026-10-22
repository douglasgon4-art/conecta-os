import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: { default: "CONECTA OS", template: "%s · CONECTA OS" }, description: "Sistema operativo integral de la agencia CONECTA" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-NI">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
