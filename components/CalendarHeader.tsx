
import React from "react";
import { DatePicker } from "./DatePicker";

interface CalendarHeaderProps {
  currentDate: Date;
  viewMode: "week" | "day";
  onDateChange: (date: Date) => void;
  onViewModeChange: (mode: "week" | "day") => void;
}

export default function CalendarHeader({ currentDate, viewMode, onDateChange, onViewModeChange }: CalendarHeaderProps) {
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
    return date.toISOString().split("T")[0];
  };

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between">
      <div className="w-full md:w-auto">
        <div className="grid w-full grid-cols-2 rounded-lg bg-gray-100 p-1 md:flex md:w-auto">
          <button
            onClick={() => onViewModeChange("week")}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${viewMode === "week" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
          >
            Week
          </button>
          <button
            onClick={() => onViewModeChange("day")}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${viewMode === "day" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
          >
            Day
          </button>
        </div>
      </div>

      <div className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-2 md:flex md:w-auto">
        <button onClick={handlePrev} className="p-2 hover:bg-gray-100 rounded-lg text-gray-600 transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <button
          onClick={handleToday}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 whitespace-nowrap"
        >
          Today
        </button>

        <div className="col-span-3 md:col-auto md:min-w-[170px]">
          <DatePicker
            alignRight={true}
            value={formatDate(currentDate)}
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

        <button onClick={handleNext} className="p-2 hover:bg-gray-100 rounded-lg text-gray-600 transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
