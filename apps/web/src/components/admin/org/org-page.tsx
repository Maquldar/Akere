'use client';

import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RequireAccess } from '@/components/shell/require-access';
import { can } from '@/lib/permissions';
import { DepartmentsTab } from './departments-tab';
import { LegalEntitiesTab } from './legal-entities-tab';
import { LocationsTab } from './locations-tab';
import { PositionsTab } from './positions-tab';

const TABS = ['entities', 'structure', 'positions', 'locations'] as const;
type Tab = (typeof TABS)[number];

export function OrgPage() {
  const t = useTranslations('admin.org');
  const search = useSearchParams();
  const current = (TABS as readonly string[]).includes(search.get('tab') ?? '') ? (search.get('tab') as Tab) : 'entities';

  return (
    <RequireAccess allow={(a) => can(a, 'org.manage')}>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <Tabs value={current} onValueChange={(v) => {
          // Shallow URL update (Next syncs useSearchParams with history.replaceState): no server round trip.
          window.history.replaceState(null, '', `?tab=${v}`);
        }}>
        <TabsList aria-label={t('title')}>
          {TABS.map((tab) => (
            <TabsTrigger key={tab} value={tab}>
              {t(`tabs.${tab}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="entities">
          <LegalEntitiesTab />
        </TabsContent>
        <TabsContent value="structure">
          <DepartmentsTab />
        </TabsContent>
        <TabsContent value="positions">
          <PositionsTab />
        </TabsContent>
        <TabsContent value="locations">
          <LocationsTab />
        </TabsContent>
      </Tabs>
    </RequireAccess>
  );
}
