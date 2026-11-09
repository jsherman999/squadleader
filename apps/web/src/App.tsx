import { lazy, Suspense } from 'react';
import { useRoute } from './router';
import { FxAudio } from './fx/FxAudio';
import { HomePage } from './pages/HomePage';
import { PlayPage } from './pages/PlayPage';
import { BattlePage } from './pages/BattlePage';

// Pages off the main play path load on demand.
const MapLabPage = lazy(() => import('./pages/MapLabPage').then((m) => ({ default: m.MapLabPage })));
const EditorPage = lazy(() => import('./pages/EditorPage').then((m) => ({ default: m.EditorPage })));
const ReviewPage = lazy(() => import('./pages/ReviewPage').then((m) => ({ default: m.ReviewPage })));
const DyoPage = lazy(() => import('./pages/DyoPage').then((m) => ({ default: m.DyoPage })));
const CampaignPage = lazy(() => import('./pages/CampaignPage').then((m) => ({ default: m.CampaignPage })));
const ScenarioEditorPage = lazy(() => import('./pages/ScenarioEditorPage').then((m) => ({ default: m.ScenarioEditorPage })));

export function App() {
  return (
    <>
      <FxAudio />
      <Suspense fallback={<div className="page loading dim">Loading…</div>}>
        <Page />
      </Suspense>
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
  if (page === 'scenario-editor') return <ScenarioEditorPage />;
  return <HomePage />;
}
