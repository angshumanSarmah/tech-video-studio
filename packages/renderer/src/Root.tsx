import { Still } from 'remotion';
import { getTheme } from './theme/index.ts';
import { ThemeSwatchBoard, themeSwatchBoardDefaults } from './stills/ThemeSwatchBoard.tsx';

const { canvas } = getTheme(themeSwatchBoardDefaults.themeId);

/** Remotion root. `VideoFromSpec` and `BeatFromSpec` arrive in P1A.3. */
export function Root() {
  return (
    <Still
      id="ThemeSwatchBoard"
      component={ThemeSwatchBoard}
      width={canvas.width}
      height={canvas.height}
      defaultProps={themeSwatchBoardDefaults}
    />
  );
}
