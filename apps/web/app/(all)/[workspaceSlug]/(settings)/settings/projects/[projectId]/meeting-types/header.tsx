import { observer } from "mobx-react";
import { PROJECT_SETTINGS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Breadcrumbs } from "@plane/ui";
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";
import { SettingsPageHeader } from "@/components/settings/page-header";
import { PROJECT_SETTINGS_ICONS } from "@/components/settings/project/sidebar/item-icon";

export const MeetingTypesProjectSettingsHeader = observer(function MeetingTypesProjectSettingsHeader() {
  const { t } = useTranslation();
  const details = PROJECT_SETTINGS.meeting_types;
  const Icon = PROJECT_SETTINGS_ICONS.meeting_types;
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
