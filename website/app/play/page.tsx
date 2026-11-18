import { Game } from "./game";

export default async function PlayPage({ searchParams }: {
  searchParams: Promise<{ name?: string | string[] }>;
}) {
  const { name } = await searchParams;
  const playerName = typeof name === "string" ? name.trim().slice(0, 24) : "";
  return <Game playerName={playerName || "Player"} />;
}
