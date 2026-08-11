/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export type TUserNameSource = {
  display_name?: string | null;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  legacy_display_name?: string | null;
};

const cleanNamePart = (value?: string | null) => value?.trim() ?? "";

/**
 * Returns the only user-facing name used by Plane: first name followed by
 * last name. `display_name` remains a fallback for pre-migration and partial
 * API responses, but is no longer an independently editable identity.
 */
export const getUserFullName = (user?: TUserNameSource | null): string => {
  if (!user) return "";

  const fullName = [cleanNamePart(user.first_name), cleanNamePart(user.last_name)].filter(Boolean).join(" ");
  return fullName || cleanNamePart(user.display_name) || cleanNamePart(user.email);
};

export const getUserSearchText = (user?: TUserNameSource | null): string => {
  if (!user) return "";

  return [
    getUserFullName(user),
    cleanNamePart(user.first_name),
    cleanNamePart(user.last_name),
    cleanNamePart(user.legacy_display_name),
    cleanNamePart(user.email),
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
};

export const getDuplicateUserNames = (users: (TUserNameSource | null | undefined)[]): Set<string> => {
  const counts = new Map<string, number>();

  users.forEach((user) => {
    const normalizedName = getUserFullName(user).toLocaleLowerCase();
    if (normalizedName) counts.set(normalizedName, (counts.get(normalizedName) ?? 0) + 1);
  });

  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name));
};

export const getUserNameWithEmail = (user: TUserNameSource | null | undefined, duplicateNames: Set<string>): string => {
  const name = getUserFullName(user);
  const email = cleanNamePart(user?.email);
  return name && email && duplicateNames.has(name.toLocaleLowerCase()) ? `${name} (${email})` : name;
};
