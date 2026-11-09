import { useRoute } from './router';
import { HomePage } from './pages/HomePage';
import { MapLabPage } from './pages/MapLabPage';
import { EditorPage } from './pages/EditorPage';
import { PlayPage } from './pages/PlayPage';
import { BattlePage } from './pages/BattlePage';

export function App() {
  const [page] = useRoute();
  if (page === 'lab') return <MapLabPage />;
  if (page === 'editor') return <EditorPage />;
  if (page === 'play') return <PlayPage />;
  if (page === 'battle') return <BattlePage />;
  return <HomePage />;
}
