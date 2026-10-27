
import React from "react";
import { DatePicker } from "./DatePicker";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";

interface CalendarHeaderProps {
  currentDate: Date;
  viewMode: "week" | "day";
  onDateChange: (date: Date) => void;
  onViewModeChange: (mode: "week" | "day") => void;
  monthViewOpen?: boolean;
  onToggleMonthView?: () => void;
}

export default function CalendarHeader({ currentDate, viewMode, onDateChange, onViewModeChange, monthViewOpen, onToggleMonthView }: CalendarHeaderProps) {
  const handlePrev = () => {
    const newDate = new Date(currentDate);
    if (viewMode === "week") {
      newDate.setDate(newDate.getDate() - 7);
    } else {
      newDate.setDate(newDate.getDate() - 1);
    }
    onDateChange(newDate);
  };

  const handleNext = () => {
    const newDate = new Date(currentDate);
    if (viewMode === "week") {
      newDate.setDate(newDate.getDate() + 7);
    } else {
      newDate.setDate(newDate.getDate() + 1);
    }
    onDateChange(newDate);
  };

  const handleToday = () => {
    onDateChange(new Date());
  };

  const formatDate = (date: Date) => {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };

  return (
    <div className="ui-card flex flex-col gap-2 p-3 md:flex-row md:items-center md:justify-between md:p-4">
      <div className="flex w-full items-center gap-2 md:w-auto">
        <div className={`grid flex-1 ${onToggleMonthView ? "grid-cols-3" : "grid-cols-2"} rounded-lg bg-gray-100 p-1 md:flex md:w-auto`}>
          <button
            onClick={() => onViewModeChange("week")}
            className={`min-h-10 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${viewMode === "week" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
          >
            Week
          </button>
          <button
            onClick={() => onViewModeChange("day")}
            className={`min-h-10 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${viewMode === "day" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
          >
            Day
          </button>
          {onToggleMonthView && (
            <button
              onClick={onToggleMonthView}
              className={`min-h-10 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${monthViewOpen ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                }`}
            >
              Month
            </button>
          )}
        </div>
        <button type="button" onClick={handleToday} className="ui-btn ui-btn-ghost min-h-11 !px-3 md:hidden">Today</button>
      </div>

      <div className="grid w-full grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2 md:flex md:w-auto">
        <button type="button" aria-label={viewMode === "week" ? "Previous week" : "Previous day"} onClick={handlePrev} className="ui-btn ui-btn-ghost min-h-11 min-w-11 !px-2">
          <CaretLeft size={20} aria-hidden="true" />
        </button>

        <button
          onClick={handleToday}
          className="hidden rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 whitespace-nowrap md:block"
        >
          Today
        </button>

        <div className="min-w-0 md:min-w-[170px]">
          <DatePicker
            alignRight={true}
            value={formatDate(currentDate)}
            className="min-h-11 !min-w-0"
            onChange={(val) => {
              if (val) {
                const parts = val.split("-");
                if (parts.length === 3) {
                  onDateChange(new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
                }
              }
            }}
          />
        </div>

        <button type="button" aria-label={viewMode === "week" ? "Next week" : "Next day"} onClick={handleNext} className="ui-btn ui-btn-ghost min-h-11 min-w-11 !px-2">
          <CaretRight size={20} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
