export type TCustomGroupingAccess = "PERSONAL" | "PROJECT";
export type TCustomGroupingDateBucket = "EXACT" | "DAY" | "WEEK" | "MONTH";

export type TProjectCustomGrouping = {
  id: string;
  name: string;
  group_by: string;
  date_bucket: TCustomGroupingDateBucket | null;
  access: TCustomGroupingAccess;
  owned_by: string;
  owner_name: string;
  created_at: string;
  updated_at: string;
};

export type TProjectCustomGroupingPayload = Pick<TProjectCustomGrouping, "name" | "group_by" | "access"> & {
  date_bucket?: TCustomGroupingDateBucket | null;
};

export type TProjectCustomGroupingPreference = {
  active_grouping: string | null;
  collapsed_groups: Record<string, string[]>;
};
