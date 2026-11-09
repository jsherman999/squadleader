import { useRoute } from './router';
import { FxAudio } from './fx/FxAudio';
import { HomePage } from './pages/HomePage';
import { MapLabPage } from './pages/MapLabPage';
import { EditorPage } from './pages/EditorPage';
import { PlayPage } from './pages/PlayPage';
import { BattlePage } from './pages/BattlePage';
import { ReviewPage } from './pages/ReviewPage';
import { DyoPage } from './pages/DyoPage';
import { CampaignPage } from './pages/CampaignPage';

export function App() {
  return (
    <>
      <FxAudio />
      <Page />
    </>
  );
}

function Page() {
  const [page] = useRoute();
  if (page === 'lab') return <MapLabPage />;
  if (page === 'editor') return <EditorPage />;
  if (page === 'play') return <PlayPage />;
  if (page === 'battle') return <BattlePage />;
  if (page === 'review') return <ReviewPage />;
  if (page === 'dyo') return <DyoPage />;
  if (page === 'campaign') return <CampaignPage />;
  return <HomePage />;
}
