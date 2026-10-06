'use client';

import { useTranslations } from 'next-intl';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RequireAccess } from '@/components/shell/require-access';
import { useTimeRequests } from '@/lib/api/hooks/time';
import { can } from '@/lib/permissions';
import { ManagedRequestsTab } from './managed-requests-tab';
import { MarksTab } from './marks-tab';
import { useTabParam } from './shared';
import { T13Tab } from './t13-tab';
import { TodayTab } from './today-tab';

const TABS = ['today', 'marks', 'requests', 't13'] as const;

function TimesheetInner() {
  const t = useTranslations('time.timesheet');
  const [tab, setTab] = useTabParam(TABS, 'today');
  const pending = useTimeRequests({ scope: 'managed', status: 'PENDING', page: 1, pageSize: 1 }, { refetchInterval: 60_000 });
  return (
    <div className="mx-auto w-full max-w-[1500px]">
      <h1 className="sr-only">{t('title')}</h1>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label={t('title')}>
          <TabsTrigger value="today">{t('tabToday')}</TabsTrigger>
          <TabsTrigger value="marks">{t('tabMarks')}</TabsTrigger>
          <TabsTrigger value="requests" count={pending.data?.total}>
            {t('tabRequests')}
          </TabsTrigger>
          <TabsTrigger value="t13">{t('tabT13')}</TabsTrigger>
        </TabsList>
        <TabsContent value="today">
          <TodayTab />
        </TabsContent>
        <TabsContent value="marks">
          <MarksTab />
        </TabsContent>
        <TabsContent value="requests">
          <ManagedRequestsTab />
        </TabsContent>
        <TabsContent value="t13">
          <T13Tab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function TimesheetPage() {
  return (
    <RequireAccess allow={(a) => can(a, 'time.manage')}>
      <TimesheetInner />
    </RequireAccess>
  );
}
