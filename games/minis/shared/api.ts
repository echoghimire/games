/** Arena Worker APIs used by the mini-games (same origin, session cookie). */

export interface Me {
  name: string;
  landingUrl: string;
}

export interface Board {
  top: { name: string; best: number }[];
  me: { best: number; rank: number } | null;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  if (res.status === 401 || res.status === 402) {
    location.reload(); // the Worker sends logged-out / unpaid players to the landing site
    throw new Error('auth');
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

export const getMe = (): Promise<Me> => call<Me>('/api/me');

export const getBoard = (game: string): Promise<Board> => call<Board>(`/api/scores/${game}`);

export const submitScore = (game: string, score: number): Promise<Board> =>
  call<Board>(`/api/scores/${game}`, { method: 'POST', body: JSON.stringify({ score: Math.floor(score) }) });

export const createRoom = (game: string): Promise<{ code: string }> =>
  call<{ code: string }>('/api/party/rooms', { method: 'POST', body: JSON.stringify({ game }) });

export interface RoomInfo {
  code: string;
  game: string;
  hostName: string;
  hostOnline: boolean;
  players: { slot: number; name: string; host: boolean }[];
  max: number;
  full: boolean;
}

export const getRoom = (code: string): Promise<RoomInfo> => call<RoomInfo>(`/api/party/rooms/${code}`);
