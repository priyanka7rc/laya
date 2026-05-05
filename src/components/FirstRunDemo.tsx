"use client";

import { useEffect, useMemo, useState } from "react";
import { trackEvent } from "@/lib/analytics";
import {
  FIRST_RUN_DEMO_CONFIG,
  FirstRunDemoPage,
  type FirstRunDemoConfig,
} from "@/lib/firstRunDemoConfig";

interface FirstRunDemoProps {
  page: FirstRunDemoPage;
  isOpen: boolean;
  onComplete: () => void;
  onSkip: () => void;
}

export function DemoInputCard({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-border bg-muted/40 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
        Sample input
      </p>
      <p className="text-sm text-foreground leading-relaxed">{text}</p>
    </div>
  );
}

export function DemoTaskList({
  items,
  interactiveIndex,
  checked,
  onToggle,
}: {
  items: string[];
  interactiveIndex?: number;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <ul className="space-y-2">
      {items.map((item, index) => {
        const isInteractive = interactiveIndex === index;
        return (
          <li key={item} className="flex items-center gap-2 text-sm text-foreground">
            {isInteractive ? (
              <button
                type="button"
                onClick={onToggle}
                className={`w-4 h-4 rounded border transition-colors ${
                  checked
                    ? "bg-primary border-primary"
                    : "border-muted-foreground/40 bg-background"
                }`}
                aria-label={`Toggle ${item}`}
              />
            ) : (
              <span className="w-1.5 h-1.5 rounded-full bg-primary/80" />
            )}
            <span className={isInteractive && checked ? "line-through text-muted-foreground" : ""}>
              {item}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function DemoOutputCard({
  title = "Sample output",
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
        {title}
      </p>
      {children}
    </div>
  );
}

export function DemoListCard({
  name,
  items,
  interactiveItemIndex,
  checked,
  onToggle,
}: {
  name: string;
  items: string[];
  interactiveItemIndex?: number;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      <p className="text-sm font-medium text-foreground mb-2">{name}</p>
      <DemoTaskList
        items={items}
        interactiveIndex={interactiveItemIndex}
        checked={checked}
        onToggle={onToggle}
      />
    </div>
  );
}

function renderOutput(
  config: FirstRunDemoConfig,
  listItemChecked: boolean,
  onToggleListItem: () => void
) {
  if (config.listOutput) {
    return (
      <DemoListCard
        name={`List: ${config.listOutput.name}`}
        items={config.listOutput.items}
        interactiveItemIndex={config.listOutput.interactiveItemIndex}
        checked={listItemChecked}
        onToggle={onToggleListItem}
      />
    );
  }

  if (config.groupedOutput) {
    return (
      <DemoOutputCard>
        <div className="space-y-3">
          {config.groupedOutput.map((group) => (
            <div key={group.title}>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                {group.title}
              </p>
              <DemoTaskList items={group.items} checked={false} onToggle={() => {}} />
            </div>
          ))}
        </div>
      </DemoOutputCard>
    );
  }

  if (config.taskOutputItems?.length) {
    return (
      <DemoOutputCard>
        <DemoTaskList items={config.taskOutputItems} checked={false} onToggle={() => {}} />
      </DemoOutputCard>
    );
  }

  return null;
}

export function FirstRunDemo({ page, isOpen, onComplete, onSkip }: FirstRunDemoProps) {
  const config = useMemo(() => FIRST_RUN_DEMO_CONFIG[page], [page]);
  const [listItemChecked, setListItemChecked] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setListItemChecked(false);
    trackEvent("first_run_demo_viewed", { page });
  }, [isOpen, page]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-scrim">
      <div
        className="absolute inset-0"
        onClick={() => {
          trackEvent("first_run_demo_skipped", { page });
          onSkip();
        }}
        aria-hidden
      />
      <div className="relative w-full sm:max-w-md max-h-[88vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl border border-border bg-card p-4 sm:p-5 shadow-2xl">
        <div className="w-10 h-1 rounded-full bg-muted mx-auto mb-3 sm:hidden" />
        <div className="mb-4">
          <h2 className="text-xl font-semibold text-foreground">{config.title}</h2>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{config.description}</p>
        </div>

        <div className="space-y-3">
          {config.inputText ? <DemoInputCard text={config.inputText} /> : null}
          {renderOutput(config, listItemChecked, () => setListItemChecked((v) => !v))}
        </div>

        <div className="flex flex-col-reverse sm:flex-row gap-2 mt-5">
          <button
            type="button"
            onClick={() => {
              trackEvent("first_run_demo_skipped", { page });
              onSkip();
            }}
            className="h-11 px-4 rounded-xl border border-border text-foreground text-sm font-medium hover:bg-muted transition-colors"
          >
            {config.secondaryLabel}
          </button>
          <button
            type="button"
            onClick={() => {
              trackEvent("first_run_demo_completed", { page });
              onComplete();
            }}
            className="h-11 flex-1 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            {config.ctaLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
