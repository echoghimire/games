import { Game } from './game/Game';
import './style.css';

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
const uiRoot = document.querySelector<HTMLElement>('#ui');
if (!canvas || !uiRoot) throw new Error('Missing #scene canvas or #ui root');

const params = new URLSearchParams(window.location.search);

if (import.meta.env.DEV && params.has('poses')) {
  void import('./debug/PoseViewer').then(({ runPoseViewer }) => runPoseViewer(canvas, params));
} else {
  const game = new Game(canvas, uiRoot);
  if (import.meta.env.DEV) Object.assign(window, { __game: game });
  Object.assign(window, { __fighterDebug: () => game.debugSnapshot() });
  game
    .init()
    .then(() => {
      // Invite links look like /f/ABC234: join that room straight away.
      const invite = /^\/f\/([A-Za-z0-9]{6})$/.exec(window.location.pathname);
      if (invite?.[1]) game.joinInvite(invite[1]);
    })
    .catch((err: unknown) => {
      console.error(err);
      uiRoot.textContent = 'Failed to load the game. Check the console for details.';
    });
}
