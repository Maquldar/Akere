'use client';

import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RequireAccess } from '@/components/shell/require-access';
import { usePathname, useRouter } from '@/i18n/navigation';
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
  const router = useRouter();
  const pathname = usePathname();
  const current = (TABS as readonly string[]).includes(search.get('tab') ?? '') ? (search.get('tab') as Tab) : 'entities';

  return (
    <RequireAccess allow={(a) => can(a, 'org.manage')}>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <Tabs value={current} onValueChange={(v) => router.replace({ pathname, query: { tab: v } }, { scroll: false })}>
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
