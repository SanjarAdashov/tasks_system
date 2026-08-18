import { observer } from "mobx-react";
import { WORKSPACE_SETTINGS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Breadcrumbs } from "@plane/ui";
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";
import { SettingsPageHeader } from "@/components/settings/page-header";
import { WORKSPACE_SETTINGS_ICONS } from "@/components/settings/workspace/sidebar/item-icon";

export const CalendarWorkspaceSettingsHeader = observer(function CalendarWorkspaceSettingsHeader() {
  const { t } = useTranslation();
  const details = WORKSPACE_SETTINGS.calendar;
  const Icon = WORKSPACE_SETTINGS_ICONS.calendar;
  return (
    <SettingsPageHeader
      leftItem={
        <Breadcrumbs>
          <Breadcrumbs.Item
            component={
              <BreadcrumbLink label={t(details.i18n_label)} icon={<Icon className="size-4 text-tertiary" />} />
            }
          />
        </Breadcrumbs>
      }
    />
  );
});
