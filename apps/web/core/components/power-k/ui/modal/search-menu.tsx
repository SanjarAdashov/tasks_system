/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
// plane imports
import { WORKSPACE_DEFAULT_SEARCH_RESULT } from "@plane/constants";
import type { IWorkspaceSearchResults } from "@plane/types";
import { cn } from "@plane/utils";
// hooks
import { usePowerK } from "@/hooks/store/use-power-k";
import useDebounce from "@/hooks/use-debounce";
import { WorkspaceService } from "@/services/workspace.service";
// local imports
import type { TPowerKContext, TPowerKPageType } from "../../core/types";
import { PowerKModalNoSearchResultsCommand } from "./no-results-command";
import { PowerKModalSearchResults } from "./search-results";
// services init
const workspaceService = new WorkspaceService();

type Props = {
  activePage: TPowerKPageType | null;
  context: TPowerKContext;
  isWorkspaceLevel: boolean;
  searchDescription: boolean;
  searchTerm: string;
  updateSearchTerm: (value: string) => void;
  handleSearchMenuClose?: () => void;
};

export function PowerKModalSearchMenu(props: Props) {
  const {
    activePage,
    context,
    isWorkspaceLevel,
    searchDescription,
    searchTerm,
    updateSearchTerm,
    handleSearchMenuClose,
  } = props;
  // states
  const [resultsCount, setResultsCount] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<IWorkspaceSearchResults>(WORKSPACE_DEFAULT_SEARCH_RESULT);
  const debouncedSearchTerm = useDebounce(searchTerm, 500);
  // navigation
  const { workspaceSlug, projectId } = useParams();
  // store hooks
  const { togglePowerKModal } = usePowerK();

  useEffect(() => {
    if (activePage || !workspaceSlug) return;
    let cancelled = false;
    const query = debouncedSearchTerm.trim();
    setResults(WORKSPACE_DEFAULT_SEARCH_RESULT);
    setResultsCount(0);

    if (!query) {
      setIsSearching(false);
      return;
    }
    setIsSearching(true);

    const fetchResults = async () => {
      try {
        const searchResults = await workspaceService.searchWorkspace(workspaceSlug.toString(), {
          ...(projectId ? { project_id: projectId.toString() } : {}),
          search: query,
          workspace_search: !projectId ? true : isWorkspaceLevel,
          search_description: searchDescription,
        });
        if (cancelled) return;
        setResults(searchResults);
        setResultsCount(Object.values(searchResults.results).reduce((count, items) => count + items.length, 0));
      } catch {
        if (cancelled) return;
        setResults(WORKSPACE_DEFAULT_SEARCH_RESULT);
        setResultsCount(0);
      } finally {
        if (!cancelled) setIsSearching(false);
      }
    };
    void fetchResults();

    return () => {
      cancelled = true;
    };
  }, [debouncedSearchTerm, isWorkspaceLevel, searchDescription, projectId, workspaceSlug, activePage]);

  if (activePage) return null;

  const hasCurrentQuery = searchTerm.trim() !== "" && searchTerm.trim() === debouncedSearchTerm.trim();

  const handleClosePalette = () => {
    handleSearchMenuClose?.();
    togglePowerKModal(false);
  };

  return (
    <>
      {searchTerm.trim() !== "" && (
        <div className="mt-4 flex items-center justify-between gap-2 px-4">
          <h5
            className={cn("text-11 text-primary", {
              "animate-pulse": isSearching,
            })}
          >
            Search results for{" "}
            <span className="font-medium">
              {'"'}
              {searchTerm}
              {'"'}
            </span>{" "}
            in {isWorkspaceLevel ? "workspace" : "project"}:
          </h5>
        </div>
      )}

      {/* Show empty state only when not loading and no results */}
      {!isSearching && resultsCount === 0 && hasCurrentQuery && (
        <PowerKModalNoSearchResultsCommand
          context={context}
          searchTerm={searchTerm}
          updateSearchTerm={updateSearchTerm}
        />
      )}

      {!isSearching && hasCurrentQuery && (
        <PowerKModalSearchResults closePalette={handleClosePalette} results={results} />
      )}
    </>
  );
}
