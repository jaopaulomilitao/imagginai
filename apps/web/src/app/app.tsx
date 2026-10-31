import { useEffect, useState } from 'react';
import { Route, Routes } from 'react-router';

import { zoneStorage, type StoredUserConsent } from '../shared/storage/dexie-db';
import type { Zone } from '../shared/types/zone';
import type { ZoneTheme } from '../zone/config/constants';
import { toggleTheme } from '../zone/systems/theme-controller';
import { ConsentModal } from './components/consent-modal';
import { DashboardPage } from './pages/dashboard-page';
import { HomePage } from './pages/home-page';
import { LoginPage } from './pages/login-page';
import { NotFoundPage } from './pages/not-found-page';
import { ZoneDetailPage } from './pages/zone-detail-page';
import { deleteAllUserDataRemote, flushPendingTelemetryAggregates } from './services/api-client';
import { buildZoneHandoffUrl } from './services/pack-customizer';
import { getActiveSession, signOutSession } from './services/supabase-client';

export function App() {
  const [themeId, setThemeId] = useState<ZoneTheme>('light-glass');
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [consent, setConsent] = useState<StoredUserConsent | null>(null);
  const [consentModalOpen, setConsentModalOpen] = useState(false);
  const [pendingZoneToEnter, setPendingZoneToEnter] = useState<Zone | null>(null);

  useEffect(() => {
    let active = true;
    const init = async () => {
      const [session, storedConsent] = await Promise.all([
        getActiveSession(),
        zoneStorage.loadConsent(),
      ]);
      if (!active) return;
      if (session?.user) {
        setUserEmail(session.user.email ?? 'Anônimo (Supabase)');
      }
      if (storedConsent) {
        setConsent(storedConsent);
        if (storedConsent.research && session?.user) {
          void flushPendingTelemetryAggregates();
        }
      }
    };
    void init();
    return () => {
      active = false;
    };
  }, []);

  const handleToggleTheme = () => {
    setThemeId((prev) => toggleTheme(prev));
  };

  const handleSignOut = () => {
    void signOutSession().finally(() => {
      setUserEmail(null);
    });
  };

  const navigateToZoneRuntime = async (zone: Zone) => {
    // garante que a zona e o study pack estejam no dexie antes do handoff para o webxr
    await zoneStorage.saveZone(zone);
    const pack = await zoneStorage.loadStudyPack(zone.id);
    if (pack) {
      await zoneStorage.saveStudyPack(zone.id, pack);
    }
    window.location.assign(buildZoneHandoffUrl(zone.id, zone.environment));
  };

  const handleRequestEnterZone = (zone: Zone) => {
    // bloqueia a primeira entrada na zona até que o consentimento lgpd (seção 3.9) seja salvo
    if (!consent) {
      setPendingZoneToEnter(zone);
      setConsentModalOpen(true);
      return;
    }
    void navigateToZoneRuntime(zone);
  };

  const handleSaveConsent = async (input: { telemetryLocal: boolean; research: boolean }) => {
    const saved = await zoneStorage.saveConsent(input);
    setConsent(saved);
    setConsentModalOpen(false);
    if (pendingZoneToEnter) {
      const target = pendingZoneToEnter;
      setPendingZoneToEnter(null);
      await navigateToZoneRuntime(target);
    }
  };

  const handleDeleteAllData = async () => {
    if (userEmail) {
      try {
        await deleteAllUserDataRemote();
      } catch {
        // prossegue com a limpeza integral local caso o servidor esteja offline
      }
    }
    await zoneStorage.clearAllLocalData();
    setConsent(null);
    setPendingZoneToEnter(null);
  };

  return (
    <>
      <Routes>
        <Route
          path="/"
          element={
            <HomePage
              themeId={themeId}
              onToggleTheme={handleToggleTheme}
              userEmail={userEmail}
              onOpenConsent={() => setConsentModalOpen(true)}
              onSignOut={handleSignOut}
              onRequestEnterZone={handleRequestEnterZone}
            />
          }
        />
        <Route
          path="/login"
          element={<LoginPage themeId={themeId} onAuthSuccess={(email) => setUserEmail(email)} />}
        />
        <Route
          path="/zones/:zoneId"
          element={
            <ZoneDetailPage
              themeId={themeId}
              onToggleTheme={handleToggleTheme}
              userEmail={userEmail}
              onOpenConsent={() => setConsentModalOpen(true)}
              onSignOut={handleSignOut}
              onRequestEnterZone={handleRequestEnterZone}
            />
          }
        />
        <Route
          path="/dashboard"
          element={
            <DashboardPage
              themeId={themeId}
              onToggleTheme={handleToggleTheme}
              userEmail={userEmail}
              onOpenConsent={() => setConsentModalOpen(true)}
              onSignOut={handleSignOut}
              onRequestEnterZone={handleRequestEnterZone}
              onDeleteAllData={handleDeleteAllData}
            />
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>

      <ConsentModal
        open={consentModalOpen}
        initialConsent={consent}
        onSave={handleSaveConsent}
        onDeleteAllData={handleDeleteAllData}
        onClose={() => {
          setConsentModalOpen(false);
          setPendingZoneToEnter(null);
        }}
      />
    </>
  );
}
