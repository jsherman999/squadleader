import { useRoute } from './router';
import { HomePage } from './pages/HomePage';
import { MapLabPage } from './pages/MapLabPage';
import { EditorPage } from './pages/EditorPage';
import { PlayPage } from './pages/PlayPage';
import { BattlePage } from './pages/BattlePage';
import { ReviewPage } from './pages/ReviewPage';

export function App() {
  const [page] = useRoute();
  if (page === 'lab') return <MapLabPage />;
  if (page === 'editor') return <EditorPage />;
  if (page === 'play') return <PlayPage />;
  if (page === 'battle') return <BattlePage />;
  if (page === 'review') return <ReviewPage />;
  return <HomePage />;
}
