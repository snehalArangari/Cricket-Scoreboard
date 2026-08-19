import type { ComponentType } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import Setup from './routes/Setup';
import Scorer from './routes/Scorer';
import Viewer from './routes/Viewer';

/**
 * Keying on matchId forces a full remount when moving between matches — which a
 * rematch does without leaving the route. Without it the stale-broadcast guard
 * (which only accepts a version higher than the last one seen) would reject the
 * new match's state, since a fresh match starts back at version 0.
 */
function PerMatch({ Component }: { Component: ComponentType }) {
  const { matchId } = useParams();
  return <Component key={matchId} />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Setup />} />
      <Route path="/score/:matchId" element={<PerMatch Component={Scorer} />} />
      <Route path="/live/:matchId" element={<PerMatch Component={Viewer} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
