import { MotionGlobalConfig } from 'motion/react';

// Story tests run axe right after render. Storybook pauses CSS animations and
// transitions for that (`pauseAnimations`), but motion's entrance fades run on
// WAAPI/rAF and are untouched — so axe either skips content still at opacity 0
// or, on a slower runner, catches it a few percent into the fade and reports a
// bogus color-contrast failure (e.g. ItemsGrid's group headers). Jump every
// motion animation to its end state so axe checks what users actually see.
MotionGlobalConfig.skipAnimations = true;
