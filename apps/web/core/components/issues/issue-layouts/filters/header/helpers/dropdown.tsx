/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { Fragment, useState } from "react";
import { createPortal } from "react-dom";
import type { Placement } from "@popperjs/core";
import { usePopper } from "react-popper";
// headless ui
import { Popover, Transition } from "@headlessui/react";
// ui
import { Button } from "@plane/propel/button";

type Props = {
  children: React.ReactNode;
  icon?: React.ReactElement;
  miniIcon?: React.ReactNode;
  title?: string;
  placement?: Placement;
  disabled?: boolean;
  tabIndex?: number;
  menuButton?: React.ReactNode;
  isFiltersApplied?: boolean;
};

export function FiltersDropdown(props: Props) {
  const {
    children,
    miniIcon,
    icon,
    title = "Dropdown",
    placement,
    disabled = false,
    tabIndex,
    menuButton,
    isFiltersApplied = false,
  } = props;

  const [referenceElement, setReferenceElement] = useState<HTMLButtonElement | HTMLDivElement | null>(null);
  const [popperElement, setPopperElement] = useState<HTMLDivElement | null>(null);

  const { styles, attributes } = usePopper(referenceElement, popperElement, {
    placement: placement ?? "auto",
  });

  return (
    <Popover as="div">
      {({ open }) => (
        <>
          <Popover.Button as={React.Fragment}>
            {menuButton ? (
              <button type="button" ref={setReferenceElement}>
                {menuButton}
              </button>
            ) : (
              <div ref={setReferenceElement}>
                <div className="hidden @4xl:flex">
                  <Button
                    disabled={disabled}
                    variant="secondary"
                    prependIcon={icon}
                    tabIndex={tabIndex}
                    className="relative"
                    size="lg"
                  >
                    <>
                      <div className={`${open ? "text-primary" : "text-secondary"}`}>
                        <span>{title}</span>
                      </div>
                      {isFiltersApplied && (
                        <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-accent-primary" />
                      )}
                    </>
                  </Button>
                </div>
                <div className="flex @4xl:hidden">
                  <Button
                    disabled={disabled}
                    ref={setReferenceElement}
                    variant="secondary"
                    tabIndex={tabIndex}
                    size="lg"
                  >
                    {miniIcon || title}
                  </Button>
                </div>
              </div>
            )}
          </Popover.Button>
          {typeof document !== "undefined" &&
            createPortal(
              <Transition
                as={Fragment}
                enter="transition ease-out duration-200"
                enterFrom="opacity-0 translate-y-1"
                enterTo="opacity-100 translate-y-0"
                leave="transition ease-in duration-150"
                leaveFrom="opacity-100 translate-y-0"
                leaveTo="opacity-0 translate-y-1"
              >
                {/** translate-y-0 is a hack to create new stacking context. Required for safari  */}
                <Popover.Panel className="fixed z-50 translate-y-0" data-prevent-outside-click>
                  <div
                    className="gts-glass-popover-surface my-1 overflow-hidden rounded-sm border border-subtle bg-surface-1 shadow-raised-100"
                    ref={setPopperElement}
                    style={styles.popper}
                    {...attributes.popper}
                  >
                    <div className="flex max-h-[min(30rem,calc(100vh-5rem))] w-[18.75rem] flex-col overflow-hidden lg:max-h-[min(37.5rem,calc(100vh-5rem))]">
                      {children}
                    </div>
                  </div>
                </Popover.Panel>
              </Transition>,
              document.body
            )}
        </>
      )}
    </Popover>
  );
}
