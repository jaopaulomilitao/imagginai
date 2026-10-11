import { describe, expect, it } from 'vitest';

import { parseLandmarkSession } from '../replay/landmark-session';
import { ReplayPlayer } from '../replay/replay-player';
import { PoseClassifier } from './pose-classifier';

// sessões sintéticas versionadas em fixtures/landmark-sessions (geradas por scripts/generate-landmark-sessions.ts)
const sessionFiles = import.meta.glob<unknown>('../../../../fixtures/landmark-sessions/*.json', {
  eager: true,
  import: 'default',
});
const sessions = Object.values(sessionFiles).map(parseLandmarkSession);

function replayTransitions(session: ReturnType<typeof parseLandmarkSession>): string[] {
  const classifier = new PoseClassifier();
  const transitions: string[] = [];
  new ReplayPlayer(session).playAll((hand, timestampMs) => {
    const update = classifier.update(hand, timestampMs);
    for (const event of update.events) {
      if (event.phase !== 'move') transitions.push(`${event.pose}:${event.phase}`);
    }
    if (update.handLost) transitions.push('hand:lost');
  });
  return transitions;
}

describe('PoseClassifier replay', () => {
  it('finds at least two recorded sessions', () => {
    expect(sessions.length).toBeGreaterThanOrEqual(2);
  });

  it.each(sessions.map((session) => [session.name, session] as const))(
    'reproduces the expected transitions for %s',
    (_name, session) => {
      expect(replayTransitions(session)).toEqual(session.expectedEvents);
    },
  );
});
