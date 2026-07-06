export default function Loading() {
  return (
    <div className="mx-auto max-w-[1400px] space-y-6 py-2">
      <div className="space-y-2.5">
        <div className="ui-skeleton h-3 w-44" />
        <div className="ui-skeleton h-8 w-48" />
      </div>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        <div className="ui-skeleton h-[132px] !rounded-2xl" />
        <div className="ui-skeleton h-[132px] !rounded-2xl" />
        <div className="ui-skeleton hidden h-[132px] !rounded-2xl sm:block" />
      </div>
      <div className="ui-skeleton h-[360px] !rounded-2xl" />
    </div>
  );
}
