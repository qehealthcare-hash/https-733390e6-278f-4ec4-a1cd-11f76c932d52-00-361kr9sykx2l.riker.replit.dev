"use client";

/**
 * Accessible type-to-search single select (combobox).
 *
 * Replaces long native <select> dropdowns where the option list is large
 * enough that scrolling is painful (e.g. patient / caretaker pickers). The
 * user types to filter and clicks a match — mirroring the free-text "find"
 * boxes on the billing and payout screens.
 *
 * Purely presentational: it owns no business logic, only the open/query UI
 * state. The parent supplies the option list and receives the selected id.
 */

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent
} from "react";

export interface SearchableSelectOption {
  id: string;
  label: string;
  /** Optional extra text (phone, code) folded into the search haystack. */
  hint?: string;
}

export interface SearchableSelectProps {
  value: string;
  onChange: (id: string) => void;
  options: SearchableSelectOption[];
  /** Label rendered for the empty / "show everything" choice. */
  allLabel?: string;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  /** Cap the number of rendered matches to keep the popover light. */
  maxResults?: number;
}

function foldText(value: string | undefined): string {
  return String(value || "").trim().toLowerCase();
}

export function SearchableSelect({
  value,
  onChange,
  options,
  allLabel = "All",
  placeholder = "Type to search…",
  id,
  disabled = false,
  maxResults = 50
}: SearchableSelectProps) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const listId = `${inputId}-listbox`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const selectedLabel = useMemo(
    function () {
      if (!value) return "";
      const match = options.find(function (o) {
        return o.id === value;
      });
      return match ? match.label : value;
    },
    [value, options]
  );

  const matches = useMemo(
    function () {
      const needle = foldText(query);
      const all: SearchableSelectOption[] = [{ id: "", label: allLabel }];
      const pool = needle
        ? options.filter(function (o) {
            return (
              foldText(o.label).indexOf(needle) >= 0 ||
              foldText(o.id).indexOf(needle) >= 0 ||
              foldText(o.hint).indexOf(needle) >= 0
            );
          })
        : options;
      return all.concat(pool.slice(0, Math.max(0, maxResults)));
    },
    [query, options, allLabel, maxResults]
  );

  useEffect(
    function () {
      if (!open) return;
      function onPointerDown(event: MouseEvent) {
        if (
          containerRef.current &&
          !containerRef.current.contains(event.target as Node)
        ) {
          setOpen(false);
          setQuery("");
        }
      }
      document.addEventListener("mousedown", onPointerDown);
      return function () {
        document.removeEventListener("mousedown", onPointerDown);
      };
    },
    [open]
  );

  useEffect(
    function () {
      setActiveIndex(0);
    },
    [query, open]
  );

  function commit(option: SearchableSelectOption) {
    onChange(option.id);
    setOpen(false);
    setQuery("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActiveIndex(function (i) {
        return Math.min(i + 1, matches.length - 1);
      });
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(function (i) {
        return Math.max(i - 1, 0);
      });
    } else if (event.key === "Enter") {
      if (open && matches[activeIndex]) {
        event.preventDefault();
        commit(matches[activeIndex]);
      }
    } else if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
        setQuery("");
      }
    }
  }

  const displayValue = open ? query : selectedLabel;

  return (
    <div
      ref={containerRef}
      className="searchable-select"
      style={{ position: "relative" }}
    >
      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          disabled={disabled}
          value={displayValue}
          placeholder={value ? selectedLabel : placeholder}
          onFocus={function () {
            setOpen(true);
          }}
          onChange={function (event) {
            setQuery(event.target.value);
            if (!open) setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          style={{ width: "100%", paddingRight: value ? 28 : undefined }}
        />
        {value ? (
          <button
            type="button"
            aria-label="Clear selection"
            title="Clear"
            disabled={disabled}
            onClick={function () {
              onChange("");
              setQuery("");
              setOpen(false);
            }}
            style={{
              position: "absolute",
              right: 6,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: "#64748b",
              fontSize: 16,
              lineHeight: 1,
              padding: 2
            }}
          >
            ×
          </button>
        ) : null}
      </div>
      {open ? (
        <ul
          id={listId}
          role="listbox"
          style={{
            position: "absolute",
            zIndex: 30,
            top: "calc(100% + 2px)",
            left: 0,
            right: 0,
            maxHeight: 260,
            overflowY: "auto",
            margin: 0,
            padding: 4,
            listStyle: "none",
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            boxShadow: "0 12px 24px rgba(15, 23, 42, 0.12)"
          }}
        >
          {matches.length === 0 ? (
            <li
              className="mini-muted"
              style={{ padding: "8px 10px", fontSize: 13 }}
            >
              No matches
            </li>
          ) : (
            matches.map(function (option, index) {
              const isSelected = option.id === value;
              const isActive = index === activeIndex;
              return (
                <li
                  key={option.id || "__all__"}
                  role="option"
                  aria-selected={isSelected}
                  onMouseDown={function (event) {
                    event.preventDefault();
                    commit(option);
                  }}
                  onMouseEnter={function () {
                    setActiveIndex(index);
                  }}
                  style={{
                    padding: "7px 10px",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: isSelected ? 600 : 400,
                    color: option.id ? "#0f172a" : "#475569",
                    background: isActive ? "#eff6ff" : "transparent"
                  }}
                >
                  {option.label}
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}
