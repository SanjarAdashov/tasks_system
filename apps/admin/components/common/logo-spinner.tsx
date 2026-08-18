/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import GtsSystemLoader from "@/app/assets/images/gts-system-loader.webm?url";

export function LogoSpinner() {
  return (
    <div role="status" aria-label="GTS Task System is loading" className="flex items-center justify-center">
      <video
        aria-hidden="true"
        autoPlay
        disablePictureInPicture
        loop
        muted
        playsInline
        preload="auto"
        src={GtsSystemLoader}
        className="pointer-events-none size-24 rounded-xl object-cover sm:size-28"
      />
      <span className="sr-only">GTS Task System is loading</span>
    </div>
  );
}
