import { Navigate, Route, Routes } from 'react-router-dom';
import Setup from './routes/Setup';
import Scorer from './routes/Scorer';
import Viewer from './routes/Viewer';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Setup />} />
      <Route path="/score/:matchId" element={<Scorer />} />
      <Route path="/live/:matchId" element={<Viewer />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
