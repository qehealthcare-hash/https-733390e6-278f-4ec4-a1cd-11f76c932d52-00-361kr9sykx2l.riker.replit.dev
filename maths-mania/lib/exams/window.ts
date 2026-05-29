/** Lobby opens this many minutes before `starts_at`. */
export const LOBBY_OPENS_MIN = 15;

export function examWindowMs(startsAtIso: string, endsAtIso: string) {
  const startsAt = new Date(startsAtIso).getTime();
  const endsAt = new Date(endsAtIso).getTime();
  const lobbyOpensAt = startsAt - LOBBY_OPENS_MIN * 60 * 1000;
  return { startsAt, endsAt, lobbyOpensAt };
}

export function examWindowPhase(
  nowMs: number,
  startsAtIso: string,
  endsAtIso: string,
): "before_lobby" | "lobby" | "live" | "ended" {
  const { startsAt, endsAt, lobbyOpensAt } = examWindowMs(
    startsAtIso,
    endsAtIso,
  );
  if (nowMs > endsAt) return "ended";
  if (nowMs < lobbyOpensAt) return "before_lobby";
  if (nowMs < startsAt) return "lobby";
  if (nowMs <= endsAt) return "live";
  return "ended";
}
