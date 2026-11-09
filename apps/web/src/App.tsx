import { useRoute } from './router';
import { HomePage } from './pages/HomePage';
import { MapLabPage } from './pages/MapLabPage';
import { EditorPage } from './pages/EditorPage';

export function App() {
  const [page] = useRoute();
  if (page === 'lab') return <MapLabPage />;
  if (page === 'editor') return <EditorPage />;
  return <HomePage />;
}
