import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Divisual · Edición automática",
  description: "Sube tu vídeo en bruto y recíbelo editado: recorte de fillers, subtítulos quemados y color grade automático.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
