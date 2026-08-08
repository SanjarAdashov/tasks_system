/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { range } from "lodash-es";
import { Row } from "@plane/ui";
import { cn } from "@plane/utils";
import { getRandomLength } from "../utils";

export function SpreadsheetIssueRowLoader(props: { columnCount: number; showIdentifierColumn?: boolean }) {
  const { columnCount, showIdentifierColumn = true } = props;

  return (
    <tr className="border-b border-subtle bg-surface-1">
      {showIdentifierColumn && (
        <td className="sticky left-0 z-[10] h-11 w-56 max-w-56 min-w-56 border-r-[0.5px] border-subtle bg-surface-1">
          <Row className="flex items-center px-3">
            <span className="h-5 w-14 animate-pulse rounded-sm bg-layer-1" />
          </Row>
        </td>
      )}
      <td
        className={cn(
          "h-11 min-w-[28rem] border-r-[0.5px] border-subtle bg-surface-1",
          !showIdentifierColumn && "sticky left-0 z-[10]"
        )}
      >
        <Row className="flex items-center px-page-x">
          <span className={`h-5 w-${getRandomLength(["32", "52", "72"])} animate-pulse rounded-sm bg-layer-1`} />
        </Row>
      </td>
      {range(columnCount).map((colIndex) => (
        <td key={colIndex} className="h-11 w-full min-w-[8rem] border-r border-subtle">
          <div className="flex items-center justify-center gap-3 px-3">
            <span className="h-5 w-20 animate-pulse rounded-sm bg-layer-1" />
          </div>
        </td>
      ))}
    </tr>
  );
}

export function SpreadsheetLayoutLoader() {
  return (
    <div className="horizontal-scroll-enable h-full w-full overflow-y-auto">
      <table>
        <thead>
          <tr>
            <th className="h-11 w-56 max-w-56 min-w-56 animate-pulse border-r border-subtle bg-surface-2" />
            <th className="h-11 min-w-[28rem] animate-pulse border-r border-subtle bg-surface-2" />
            {range(10).map((index) => (
              <th key={index} className="h-11 w-full min-w-[8rem] animate-pulse border-r border-subtle bg-surface-2" />
            ))}
          </tr>
        </thead>
        <tbody>
          {range(16).map((rowIndex) => (
            <SpreadsheetIssueRowLoader key={rowIndex} columnCount={10} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
