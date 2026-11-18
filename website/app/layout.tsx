import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./style.css";

export const metadata: Metadata = {
  title: "CSJS",
  icons: { icon: "/csjs.svg" },
  description: "Play Counter-Strike 1.6 in your browser.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
